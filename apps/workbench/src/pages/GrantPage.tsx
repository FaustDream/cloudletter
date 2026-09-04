/**
 * 一次性授权访问页（公开路由 /grant，不在登录 Guard 内）：
 * 邮件链接携带 token → redeem 换取访客会话 → 按授权范围渲染只读视图。
 * 有效期由服务端强制；随时可被管理员撤销；「退出访问」即清除本地会话。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { guestApi, getGuestToken, setGuestToken, SCOPE_LABELS } from '../lib/guestApi'
import { MarkdownView } from '../components/framework/MarkdownView'
import { EmptyState } from '../components/framework/EmptyState'
import { Loading } from '../components/framework/Loading'
import type { TimelineDay } from '../api'

interface GrantMeta { scopes: string[]; expiresAt: string; label: string }
interface NoteRow { id: string; title: string; body: string; type: string; mood: string; date: string; done: boolean; createdAt: string }
interface PostRow { id: string; title: string; summary: string; charCount: number; publishedAt: string | null; tags: string[] }
interface WorkRow { id: string; date: string; text: string; note: string; done: boolean; doneAt: string }
interface PlanRow { id: string; text: string; level: string; note: string; done: boolean; dueDate: string; doneAt: string }

export function GrantPage() {
  const [sp] = useSearchParams()
  const token = sp.get('token')
  const [meta, setMeta] = useState<GrantMeta | null>(null)
  const [checking, setChecking] = useState(!!getGuestToken() || !!token)
  const [err, setErr] = useState('')

  /* ── 进入：query token 优先 redeem；否则用已存会话试 meta ── */
  useEffect(() => {
    let dead = false
    ;(async () => {
      setChecking(true)
      setErr('')
      try {
        if (token) {
          const r = await guestApi.post<{ token: string; scopes: string[]; expiresAt: string; label: string }>('/grants/redeem', { token })
          if (dead) return
          setGuestToken(r.token)
          setMeta({ scopes: r.scopes, expiresAt: r.expiresAt, label: r.label })
          // 清掉地址栏里的明文 token（刷新不再依赖 query）
          window.history.replaceState({}, '', '/grant')
        } else if (getGuestToken()) {
          const r = await guestApi.get<GrantMeta>('/guest/meta')
          if (dead) return
          setMeta(r)
        } else {
          setErr('缺少授权凭证：请通过授权邮件中的链接进入。')
        }
      } catch (e: any) {
        if (dead) return
        setErr(e?.message || '授权验证失败，链接可能已失效或被撤销')
      } finally {
        if (!dead) setChecking(false)
      }
    })()
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const exit = () => { setGuestToken(null); setMeta(null); setErr('已退出授权访问。') }

  if (checking) return <div className="grant-wrap"><Loading label="正在验证授权…" /></div>

  if (err || !meta) {
    return (
      <div className="grant-wrap">
        <div className="grant-card">
          <div className="grant-brand">云笺集 · 授权访问</div>
          <EmptyState variant="hero" icon="🔑">{err || '授权访问不可用'}</EmptyState>
          <Link to="/login" className="btn slim ghost" style={{ margin: '0 auto', display: 'table' }}>前往登录</Link>
        </div>
      </div>
    )
  }

  return <GrantView meta={meta} onExit={exit} />
}

/* ================= 授权范围内的只读视图 ================= */

function GrantView({ meta, onExit }: { meta: GrantMeta; onExit: () => void }) {
  const [tab, setTab] = useState<string>(meta.scopes[0] || 'timeline')
  const exp = new Date(meta.expiresAt)
  return (
    <div className="grant-wrap">
      <div className="grant-head">
        <div>
          <b>授权访问{meta.label ? ` · ${meta.label}` : ''}</b>
          <span className="dim"> 只读 · 有效期至 {exp.toLocaleString()}</span>
        </div>
        <button className="btn slim ghost" onClick={onExit}>退出访问</button>
      </div>
      <div className="grant-tabs">
        {meta.scopes.map((s) => (
          <button key={s} className={`fchip${tab === s ? ' on' : ''}`} onClick={() => setTab(s)}>{SCOPE_LABELS[s] || s}</button>
        ))}
      </div>
      {tab === 'timeline' && meta.scopes.includes('timeline') && <GuestTimeline />}
      {tab === 'posts' && meta.scopes.includes('posts') && <GuestPosts />}
      {tab === 'notes' && meta.scopes.includes('notes') && <GuestNotes />}
      {tab === 'workplan' && meta.scopes.includes('workplan') && <GuestWorkplan />}
      {tab === 'plan' && meta.scopes.includes('plan') && <GuestPlan />}
    </div>
  )
}

function GuestTimeline() {
  const [days, setDays] = useState<TimelineDay[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')
  useEffect(() => {
    guestApi.get<{ days: TimelineDay[] }>('/guest/timeline?limit=30')
      .then((r) => { setDays(r.days); setState('ok') })
      .catch(() => setState('err'))
  }, [])
  const total = useMemo(() => days.reduce((n, d) => n + d.items.length, 0), [days])
  if (state === 'loading') return <Loading label="时间流载入中…" />
  if (state === 'err') return <EmptyState>时间流加载失败</EmptyState>
  if (!days.length) return <EmptyState>该时间范围内还没有任何沉淀</EmptyState>
  return (
    <div className="grant-list">
      {days.map((d) => (
        <div key={d.date} className="grant-day">
          <div className="grant-day-h"><b>{d.date}</b><span className="dim">{d.items.length} 条 · +{d.xp} XP</span></div>
          {d.items.map((it) => (
            <div key={it.id} className="grant-item">
              <div className="wn">{it.title}</div>
              {it.sub && <div className="wsub">{it.sub}</div>}
            </div>
          ))}
        </div>
      ))}
      <div className="dim" style={{ textAlign: 'center', fontSize: 12.5 }}>近 30 天共 {total} 条（仅授权范围内的快照视图）</div>
    </div>
  )
}

function GuestPosts() {
  const [posts, setPosts] = useState<PostRow[]>([])
  const [open, setOpen] = useState<{ title: string; rawMarkdown: string } | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')
  useEffect(() => {
    guestApi.get<{ items: PostRow[] }>('/guest/posts').then((r) => { setPosts(r.items); setState('ok') }).catch(() => setState('err'))
  }, [])
  if (state === 'loading') return <Loading label="文章载入中…" />
  if (state === 'err') return <EmptyState>文章加载失败</EmptyState>
  if (!posts.length) return <EmptyState>暂无已发布文章</EmptyState>
  if (open) {
    return (
      <div className="grant-detail">
        <button className="btn slim ghost" onClick={() => setOpen(null)}>← 返回列表</button>
        <h2>{open.title}</h2>
        <MarkdownView value={open.rawMarkdown} />
      </div>
    )
  }
  return (
    <div className="grant-list">
      {posts.map((p) => (
        <div key={p.id} className="grant-item" style={{ cursor: 'pointer' }} title="阅读全文" onClick={() => {
          guestApi.get<{ title: string; rawMarkdown: string }>(`/guest/posts/${p.id}`).then((r) => setOpen(r)).catch(() => {})
        }}>
          <div className="wn">{p.title}</div>
          {p.summary && <div className="wsub">{p.summary}</div>}
          <div className="dim" style={{ fontSize: 12 }}>{p.publishedAt?.slice(0, 10)} · {p.charCount} 字{p.tags.length ? ` · ${p.tags.map((t) => `#${t}`).join(' ')}` : ''}</div>
        </div>
      ))}
    </div>
  )
}

function GuestNotes() {
  const [items, setItems] = useState<NoteRow[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')
  useEffect(() => {
    guestApi.get<{ items: NoteRow[] }>('/guest/notes').then((r) => { setItems(r.items); setState('ok') }).catch(() => setState('err'))
  }, [])
  if (state === 'loading') return <Loading label="速记载入中…" />
  if (state === 'err') return <EmptyState>速记加载失败</EmptyState>
  if (!items.length) return <EmptyState>暂无速记</EmptyState>
  return (
    <div className="grant-list">
      {items.map((n) => (
        <div key={n.id} className="grant-item">
          <div className="wn">{n.type === 'plan' ? '📋 ' : '💡 '}{n.title || '（无标题）'}{n.done ? ' ✅' : ''}</div>
          {n.body && <MarkdownView value={n.body} empty="" />}
          <div className="dim" style={{ fontSize: 12 }}>{n.date}{n.mood ? ` · #${n.mood.split(',').join(' #')}` : ''}</div>
        </div>
      ))}
    </div>
  )
}

function GuestWorkplan() {
  const [items, setItems] = useState<WorkRow[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')
  useEffect(() => {
    guestApi.get<{ items: WorkRow[] }>('/guest/workplan').then((r) => { setItems(r.items); setState('ok') }).catch(() => setState('err'))
  }, [])
  const byDate = useMemo(() => {
    const m = new Map<string, WorkRow[]>()
    for (const t of items) {
      if (!m.has(t.date)) m.set(t.date, [])
      m.get(t.date)!.push(t)
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [items])
  if (state === 'loading') return <Loading label="工作计划载入中…" />
  if (state === 'err') return <EmptyState>工作计划加载失败</EmptyState>
  if (!items.length) return <EmptyState>暂无工作计划</EmptyState>
  return (
    <div className="grant-list">
      {byDate.map(([date, list]) => (
        <div key={date} className="grant-day">
          <div className="grant-day-h"><b>{date}</b><span className="dim">{list.filter((t) => t.done).length} / {list.length} 完成</span></div>
          {list.map((t) => (
            <div key={t.id} className={`grant-item ${t.done ? 'done' : ''}`}>
              <div className="wn">{t.done ? '✅ ' : '☐ '}{t.text}</div>
              {t.note && <div className="wsub">{t.note.replace(/[#*`>\-[\]]/g, '').slice(0, 120)}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function GuestPlan() {
  const [items, setItems] = useState<PlanRow[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')
  useEffect(() => {
    guestApi.get<{ items: PlanRow[] }>('/guest/plan').then((r) => { setItems(r.items); setState('ok') }).catch(() => setState('err'))
  }, [])
  if (state === 'loading') return <Loading label="今日计划载入中…" />
  if (state === 'err') return <EmptyState>今日计划加载失败</EmptyState>
  if (!items.length) return <EmptyState>暂无计划</EmptyState>
  return (
    <div className="grant-list">
      {items.map((p) => (
        <div key={p.id} className={`grant-item ${p.done ? 'done' : ''}`}>
          <div className="wn">{p.done ? '✅ ' : '☐ '}[{p.level}] {p.text}</div>
          {p.dueDate && <div className="dim" style={{ fontSize: 12 }}>截止 {p.dueDate}</div>}
        </div>
      ))}
    </div>
  )
}
