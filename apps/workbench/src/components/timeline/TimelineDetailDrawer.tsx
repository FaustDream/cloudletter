/**
 * 时间流 · 节点完整详情（统一的详情查看入口）：
 * 按节点 id 前缀路由到数据源，拉取全部内容与关联数据（而非时间轴裁剪后的摘要）：
 *   post: → /posts/:id；note:/plan:/ledger:/goals:/checkin:/worktask: → /workbench/:scope 列表内定位
 * checkin/goal 节点 id 带日期后缀（checkin:<id>:<date>），定位时 strip。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type CheckinItem, type GoalItem, type LedgerEntry, type NoteItem, type PlanItem, type PostDetail, type TimelineNode, type WorkTask } from '../../api'
import { Drawer } from '../framework/Drawer'
import { MarkdownView } from '../framework/MarkdownView'
import { EmptyState } from '../framework/EmptyState'
import { Loading } from '../framework/Loading'
import { TL_COLOR, TL_TYPES, dayLabel } from './timeline'
import { parseLog } from '../../lib/checkin'
import { Icon } from '../framework/Icon'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TL_TYPES.map(([k, l]) => [k, l]))

/** 各节点类型（按 id 前缀）对应的编辑管理页 */
const EDIT_TO: Record<string, string> = {
  post: '/posts',
  note: '/notes',
  plan: '/goals-home?tab=plan',
  worktask: '/workplan',
  checkin: '/goals-home?tab=checkin',
  ledger: '/ledger',
  goal: '/goals-home?tab=goal',
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tld-meta-row">
      <span className="tld-meta-k">{label}</span>
      <span className="tld-meta-v">{children}</span>
    </div>
  )
}

export function TimelineDetailDrawer({ node, onClose }: { node: TimelineNode | null; onClose: () => void }) {
  const nav = useNavigate()
  const [loading, setLoading] = useState(false)
  const [fail, setFail] = useState(false)
  /** 详情渲染所需的数据（各类型不同） */
  const [detail, setDetail] = useState<unknown>(null)

  useEffect(() => {
    setDetail(null)
    setFail(false)
    if (!node) return
    const scope = node.id.split(':')[0]
    const rawId = node.id.slice(scope.length + 1)
    // checkin/goal 节点 id 带日期后缀（checkin:<id>:<date>），统一取首段
    const id = rawId.split(':')[0]
    setLoading(true)
    const jobs: Record<string, Promise<unknown>> = {
      post: api.get<PostDetail>(`/posts/${id}`),
      note: api.get<{ items: NoteItem[] }>('/workbench/notes').then((r) => r.items.find((x) => x.id === id) ?? null),
      plan: api.get<{ items: PlanItem[] }>('/workbench/plan').then((r) => r.items.find((x) => x.id === id) ?? null),
      ledger: api.get<{ items: LedgerEntry[] }>('/workbench/ledger').then((r) => r.items.find((x) => x.id === id) ?? null),
      checkin: api.get<{ items: CheckinItem[] }>('/workbench/checkin').then((r) => r.items.find((x) => x.id === id) ?? null),
      goal: api.get<{ items: GoalItem[] }>('/workbench/goals').then((r) => r.items.find((x) => x.id === id) ?? null),
      worktask: api.get<{ items: WorkTask[] }>('/workbench/worktask').then((r) => r.items.find((x) => x.id === id) ?? null),
    }
    const job = jobs[scope]
    if (!job) { setLoading(false); setFail(true); return }
    job
      .then((d) => setDetail(d))
      .catch(() => setFail(true))
      .finally(() => setLoading(false))
  }, [node])

  if (!node) return null
  const color = TL_COLOR[node.t]
  const dl = dayLabel(node.date)

  const body = () => {
    if (loading) return <Loading label="载入完整详情…" />
    if (fail || !detail) return <EmptyState>详情加载失败，源数据可能已被删除</EmptyState>
    switch (node.id.split(':')[0]) {
      case 'post': {
        const p = detail as PostDetail
        return (
          <>
            <Meta label="状态">{p.status === 'published' ? '已发布' : '草稿'}{p.publishedAt ? ` · ${p.publishedAt.slice(0, 16).replace('T', ' ')}` : ''}</Meta>
            <Meta label="字数">{(p.rawMarkdown || '').length} 字</Meta>
            {p.tags?.length > 0 && <Meta label="标签">{p.tags.map((t) => `#${t}`).join(' ')}</Meta>}
            {p.summary && <Meta label="摘要">{p.summary}</Meta>}
            <div className="tld-body"><MarkdownView value={p.rawMarkdown} /></div>
          </>
        )
      }
      case 'note': {
        const n = detail as NoteItem
        return (
          <>
            <Meta label="类型">灵感（速记）</Meta>
            <Meta label="记录日期">{n.date}</Meta>
            <Meta label="创建时间">{(n.createdAt || '').slice(0, 16).replace('T', ' ')}</Meta>
            {n.tags.length > 0 && <Meta label="标签">{n.tags.map((t) => `#${t}`).join(' ')}</Meta>}
            <div className="tld-body"><MarkdownView value={n.body} empty="（这条速记没有正文）" /></div>
          </>
        )
      }
      case 'plan': {
        const p = detail as PlanItem
        return (
          <>
            <Meta label="优先级">{p.level}</Meta>
            <Meta label="截止">{p.dueDate || '无'}</Meta>
            <Meta label="状态">{p.done ? `已完成${p.doneAt ? ` · ${p.doneAt.slice(0, 16).replace('T', ' ')}` : ''}` : '未完成'}</Meta>
            <Meta label="创建时间">{(p.createdAt || '').slice(0, 16).replace('T', ' ')}</Meta>
            <div className="tld-body"><MarkdownView value={p.note} empty="（该计划没有详情备注）" /></div>
          </>
        )
      }
      case 'worktask': {
        const w = detail as WorkTask
        return (
          <>
            <Meta label="归属日期">{w.date}（{WEEK(new Date(w.date + 'T00:00:00').getDay())}）</Meta>
            <Meta label="状态">{w.done ? `已完成${w.doneAt ? ` · ${w.doneAt.slice(0, 16).replace('T', ' ')}` : ''}` : '未完成'}</Meta>
            <Meta label="创建时间">{(w.createdAt || '').slice(0, 16).replace('T', ' ')}</Meta>
            <div className="tld-body"><MarkdownView value={w.note} empty="（该任务没有详情备注）" /></div>
          </>
        )
      }
      case 'ledger': {
        const l = detail as LedgerEntry
        return (
          <>
            <Meta label="类型">{l.kind === 'income' ? '收入' : '支出'}</Meta>
            <Meta label="金额">{l.kind === 'income' ? '+' : '-'}¥{Math.abs(l.amount).toFixed(2)}</Meta>
            <Meta label="分类">{l.cat}</Meta>
            <Meta label="日期">{l.date}</Meta>
            <div className="tld-body"><MarkdownView value={l.note} empty="（该笔账没有备注）" /></div>
          </>
        )
      }
      case 'checkin': {
        const c = detail as CheckinItem
        const log = parseLog(c.log)
        const days = Object.keys(log).filter((k) => log[k]).sort((a, b) => b.localeCompare(a))
        return (
          <>
            <Meta label="习惯">{c.emoji} {c.name}</Meta>
            <Meta label="连续打卡">{c.streak || 0} 天</Meta>
            <Meta label="累计打卡">{days.length} 天</Meta>
            <Meta label="最近打卡">{days.slice(0, 10).join(' · ') || '无'}</Meta>
          </>
        )
      }
      case 'goal': {
        const g = detail as GoalItem
        const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0
        return (
          <>
            <Meta label="目标">{g.emoji} {g.name}</Meta>
            <Meta label="进度">{g.current} / {g.target}{g.unit ? ' ' + g.unit : ''} · {pct}%</Meta>
            <div className="gbar" style={{ margin: '10px 0 14px' }}>
              <i style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--accent), var(--info))' }} />
            </div>
            <div className="tld-body"><MarkdownView value={g.desc} empty="（该目标没有描述）" /></div>
          </>
        )
      }
      default:
        return <EmptyState>暂不支持该类型的完整详情</EmptyState>
    }
  }

  const editTo = EDIT_TO[node.id.split(':')[0]]

  return (
    <Drawer
      width={620}
      title={
        <span className="qn-drawer-title">
          <span className="qn-type" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>{TYPE_LABEL[node.t] || node.t}</span>
          {node.title}
        </span>
      }
      hint={`${dl.d}${dl.f ? ' · ' + dl.f : ''} · ${node.date}`}
      onClose={onClose}
      footer={
        editTo && (
          <button className="btn" onClick={() => nav(editTo)}><Icon name="pen" size={15} /> 前往编辑 / 管理</button>
        )
      }
    >
      {body()}
    </Drawer>
  )
}

const WEEK = (d: number) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d]
