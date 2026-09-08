/** 全站检索：文章（含草稿）+ 工作台数据 + 分类/标签 聚合检索，全宽搜索 + 分面 + 最近搜索 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Category, type Tag } from '../api'
import { Icon } from '../components/framework/Icon'
import { EmptyState } from '../components/framework/EmptyState'
import { readLayoutTheme, SEARCH_CARD_THEMES } from '../lib/componentTheme'

interface ArticleHit { slug: string; title: string; excerpt: string; category: string | null; tags: string[]; publishedAt: string | null; draft: boolean }
interface WbHit { scope: string; id: string; label: string; value: string; date?: string }
/** 工作台五类模块行（搜索用统一的最小结构；后端返回字段在运行时保证存在，from unknown 断言收窄） */
interface WbRow {
  id: string
  text: string
  note: string
  name: string
  cat: string
  amount: number
  unit: string
  title: string
  body: string
  date?: string
  createdAt?: string
}

const RECENT_KEY = 'cl_recent_searches'
const SUGGESTIONS = ['Markdown', '项目复盘', '云笺集', 'Fuwari', '计划']

/** 中文分词近似：关键词 + 全部滑动双字 + 单字，让"读书"能命中"读完"类内容 */
function buildTerms(kw: string): string[] {
  const terms = new Set<string>([kw.toLowerCase()])
  const str = kw.replace(/\s+/g, '')
  if (/[\u4e00-\u9fff]/.test(str)) {
    for (let i = 0; i < str.length; i++) {
      if (i + 1 < str.length) terms.add(str.slice(i, i + 2))
      terms.add(str[i])
    }
  }
  return [...terms]
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!))

/** 在原文上定位命中、按转义后的文本拼 <mark>：空词/未命中都返回完整转义文本（杜绝未转义进 innerHTML） */
export function highlight(text: string, q: string): string {
  const lower = text.toLowerCase()
  const ql = q.trim().toLowerCase()
  if (!ql) return escapeHtml(text)
  let out = ''
  let from = 0
  let idx = lower.indexOf(ql)
  while (idx >= 0) {
    out += escapeHtml(text.slice(from, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + ql.length)) + '</mark>'
    from = idx + ql.length
    idx = lower.indexOf(ql, from)
  }
  out += escapeHtml(text.slice(from))
  return out
}

const SCOPE_LABEL: Record<string, string> = {
  plan: '今日计划', checkin: '习惯', ledger: '记账', goals: '长期目标', notes: '灵感',
}
const SCOPE_PATH: Record<string, string> = {
  plan: '/plan', checkin: '/checkin', ledger: '/ledger', goals: '/goals', notes: '/notes',
}

export function SearchPage() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [articles, setArticles] = useState<ArticleHit[]>([])
  const [wbHits, setWbHits] = useState<WbHit[]>([])
  const [catHits, setCatHits] = useState<Category[]>([])
  const [tagHits, setTagHits] = useState<Tag[]>([])
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const [sp] = useSearchParams()
  // 检索结果卡片主题（骨架不变 · 样式抽离）
  const [cardTheme, setCardTheme] = useState(() => readLayoutTheme('searchCard', SEARCH_CARD_THEMES, 'plain'))
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cl_theme_layout_searchCard') setCardTheme(readLayoutTheme('searchCard', SEARCH_CARD_THEMES, 'plain'))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // URL 带 ?q= 时自动搜索（如从别处深链跳转）
  useEffect(() => {
    const urlQ = sp.get('q')
    if (urlQ && urlQ.trim()) {
      setQ(urlQ)
      void doSearch(urlQ)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const doSearch = useCallback(async (keyword: string) => {
    const kw = keyword.trim()
    if (!kw) return
    const terms = buildTerms(kw)
    const hitText = (text: string) => {
      const t = text.toLowerCase()
      return terms.some((term) => t.includes(term))
    }
    setBusy(true)
    setArticles([]); setWbHits([]); setCatHits([]); setTagHits([])
    try {
      // 文章（含草稿）
      const a = await api.get<{ items: ArticleHit[] }>(`/search?q=${encodeURIComponent(kw)}&includeDraft=1`)
        .catch(() => ({ items: [] as ArticleHit[] }))
      // 工作台数据
      const scopes = ['plan', 'checkin', 'ledger', 'goals', 'notes'] as const
      const wb: WbHit[] = []
      await Promise.all(scopes.map(async (s) => {
        try {
          const r = await api.get<{ items: Array<Record<string, unknown>> }>(`/workbench/${s}`)
          for (const raw of r.items ?? []) {
            const it = raw as unknown as WbRow
            const textParts: string[] = []
            if (s === 'plan') textParts.push(it.text, it.note)
            else if (s === 'checkin') textParts.push(it.name)
            else if (s === 'ledger') textParts.push(it.cat, it.note)
            else if (s === 'goals') textParts.push(it.name, it.unit)
            else if (s === 'notes') textParts.push(it.title, it.body)
            if (hitText(textParts.join(' '))) {
              wb.push({
                scope: s, id: it.id,
                label: s === 'plan' ? it.text : s === 'checkin' ? it.name : s === 'ledger' ? `${it.cat} ${it.note}` : s === 'goals' ? it.name : it.title,
                value: s === 'ledger' ? `¥${it.amount}` : String(it.note ?? it.body ?? '').slice(0, 60),
                date: it.date || it.createdAt?.slice(0, 10),
              })
            }
          }
        } catch { /* 单模块检索失败不阻断整体搜索，静默降级为空结果 */ }
      }))
      // 分类 / 标签
      const cats = await api.get<{ items: Category[] }>('/categories').catch(() => ({ items: [] }))
      const tags = await api.get<{ items: Tag[] }>('/tags').catch(() => ({ items: [] }))
      setArticles(a.items ?? [])
      setWbHits(wb.slice(0, 12))
      setCatHits(cats.items.filter((c) => hitText(c.name)).slice(0, 4))
      setTagHits(tags.items.filter((t) => hitText(t.name)).slice(0, 8))
      // 记录最近搜索
      setRecent((prev) => {
        const next = [kw, ...prev.filter((r) => r !== kw)].slice(0, 8)
        try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* 隐私模式/存满：仅本次不记录，不影响搜索 */ }
        return next
      })
    } finally {
      setBusy(false)
      setSearched(true)
    }
  }, [])

  const total = useMemo(() => articles.length + wbHits.length + catHits.length + tagHits.length, [articles, wbHits, catHits, tagHits])

  return (
    <>
      {/* 第一视觉区：标题 + 全宽搜索 + 说明 + 快捷入口 */}
      <div className="shead">
        <div className="shead-h">
          <h2>全站检索</h2>
          <p>检索文章（含草稿）、今日计划、习惯、记账、目标、灵感、分类与标签</p>
          <span className="kbd-hint"><kbd>Enter</kbd> 搜索</span>
        </div>
        <div className="sbox">
          <Icon name="search" size={18} />
          <input
            ref={inputRef}
            type="search"
            placeholder="搜索你的全部个人内容与数据…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(q) }}
          />
          <button className="btn slim" onClick={() => doSearch(q)} disabled={busy}>{busy ? '搜索中…' : '搜索'}</button>
        </div>
        <div className="squick">
          <span className="sq-label">试试搜索：</span>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => { setQ(s); doSearch(s) }}>{s}</button>
          ))}
          {recent.length > 0 && (
            <span className="sq-recent">
              <span className="sq-label">最近：</span>
              {recent.map((r) => (
                <button key={r} className="chip dim" onClick={() => { setQ(r); doSearch(r) }}>{r}</button>
              ))}
            </span>
          )}
        </div>
      </div>

      {/* 空状态 / 结果 */}
      {!searched ? (
        <div className="sempty">
          <Icon name="search" size={30} />
          <div className="se-t">输入关键词，检索你的全部个人内容</div>
          <div className="se-s">试试搜索：Markdown / 项目复盘 / 2026 年计划 · 支持分类、标签与工作台数据</div>
        </div>
      ) : busy ? (
        <EmptyState style={{ marginTop: 16 }}>检索中…</EmptyState>
      ) : total === 0 ? (
        <EmptyState style={{ marginTop: 16 }}>未找到与「{q}」相关的内容</EmptyState>
      ) : (
        <div className="sresult" data-search={cardTheme}>
          <div className="smeta">
            <b>{total}</b> 条结果（含草稿与工作台数据）
          </div>

          {articles.length > 0 && (
            <>
              <div className="sec-title">文章</div>
              <div className="post-list">
                {articles.slice(0, 8).map((h) => (
                  <div key={h.slug} className="post" onClick={() => nav('/posts')}>
                    <div className="pv" style={{ background: h.draft ? 'var(--warn)' : 'var(--ok)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="pt">
                        <span dangerouslySetInnerHTML={{ __html: highlight(h.title, q) }} />
                        {h.draft && <span className="pill warn" style={{ marginLeft: 8 }}>草稿</span>}
                      </div>
                      <div className="pd" dangerouslySetInnerHTML={{ __html: highlight(h.excerpt, q) }} />
                      <div className="pm">
                        {h.category && <span className="chip">{h.category}</span>}
                        {h.tags.map((t) => <span key={t} className="chip dim">#{t}</span>)}
                        {h.publishedAt && <span className="dt">{(h.publishedAt || '').slice(0, 10)}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {wbHits.length > 0 && (
            <>
              <div className="sec-title">工作台数据</div>
              <div className="wb-list">
                {wbHits.map((h) => (
                  <div key={`${h.scope}-${h.id}`} className="wb-item" onClick={() => nav(SCOPE_PATH[h.scope])}>
                    <span className="scope-chip" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>{SCOPE_LABEL[h.scope]}</span>
                    <div className="wtx">
                      <div className="wn" dangerouslySetInnerHTML={{ __html: highlight(h.label, q) }} />
                      {h.value && <div className="wsub">{h.value}</div>}
                    </div>
                    {h.date && <span className="wlv" style={{ color: 'var(--text-tertiary)', background: 'transparent' }}>{h.date}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {(catHits.length > 0 || tagHits.length > 0) && (
            <>
              <div className="sec-title">分类与标签</div>
              <div className="tag-cloud">
                {catHits.map((c) => (
                  <span key={c.id} className="tagpile" onClick={() => nav(`/posts?cat=${encodeURIComponent(c.name)}`)}>
                    分类：{c.name} <span className="tcount">{c._count?.posts ?? 0} 篇</span>
                  </span>
                ))}
                {tagHits.map((t) => (
                  <span key={t.id} className="tagpile" onClick={() => nav(`/posts?tag=${encodeURIComponent(t.name)}`)}>
                    # {t.name} <span className="tcount">{t._count?.posts ?? 0} 篇</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}