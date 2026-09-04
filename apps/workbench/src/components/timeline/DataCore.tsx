/**
 * 大屏四 · 个人数据核心 / 数据指挥中心（需求文档 §8）
 * 核心问题：「我的数据现在运行得怎么样？」
 * - 中心核心：当前等级 / XP / 六类数据总量
 * - 数据环：总量(外围) · 完成情况(进度弧) · 近期活跃(脉冲环)
 * - 实时数据流：近端真实事件顺次浮现（数据锚定，非虚构）
 * - 数据脉冲：六类各以 TL_COLOR 语义呈现（与节点宇宙 / 数字城市同源同色）
 * 全部数值来自真实数据（/workbench/dashboard + /workbench/timeline）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardStats, TimelineDay, TimelineNode, TimelineType } from '../../api'
import { TL_COLOR, TL_TYPES } from './timeline'

interface Props {
  days: TimelineDay[]
  dash: DashboardStats | null
  filter: TimelineType | 'all'
  onOpenDetail: (node: TimelineNode) => void
}

/** 数字滚动（count-up） */
function useCountUp(target: number, dur = 600): number {
  const [v, setV] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      setV(Math.round(from + (target - from) * e))
      if (p < 1) raf = requestAnimationFrame(step)
      else fromRef.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, dur])
  return v
}

/** 六个统计环：数据总量 / 完成情况 / 月度财务 / 习惯活力（全部真实计算） */
function statOf(dash: DashboardStats | null, key: TimelineType): { value: number; label: string; sub: string; pct?: number } {
  const fallback = (v: number, label: string) => ({ value: v, label, sub: '' })
  if (!dash) return fallback(0, '—')
  switch (key) {
    case 'journal':
      return { value: dash.totals.journal, label: '日志', sub: `${dash.posts.total} 篇含草稿 · ${Math.round(dash.chars / 1000)}k 字` }
    case 'note':
      return { value: dash.totals.note, label: '灵感', sub: `速记 / 灵感碎片` }
    case 'plan':
      return { value: dash.plan.done, label: '计划', sub: `已完成 / ${dash.plan.total}`, pct: dash.plan.total ? Math.round((dash.plan.done / dash.plan.total) * 100) : 0 }
    case 'checkin':
      return { value: dash.checkin.today, label: '习惯', sub: `今日 ${dash.checkin.today} · 最长 ${dash.checkin.maxStreak} 连`, pct: dash.checkin.total ? Math.round((dash.checkin.today / dash.checkin.total) * 100) : 0 }
    case 'ledger':
      return { value: dash.totals.ledger, label: '记账', sub: `本月 收 +¥${dash.ledger.monthIncome.toFixed(0)} / 支 -¥${dash.ledger.monthExpense.toFixed(0)}` }
    case 'goal':
      return { value: dash.totals.goal, label: '目标', sub: `平均进度 ${dash.goal.pct}%`, pct: dash.goal.pct }
  }
}

/** 中心 XP 显示 */
function useCoreXp(days: TimelineDay[]) {
  return useMemo(() => {
    let xp = 0, gold = 0
    for (const d of days) { xp += d.xp; gold += d.gold }
    const lv = Math.max(1, Math.floor(xp / 500) + 1)
    return { xp, gold, lv, seg: xp % 500 }
  }, [days])
}

export function DataCore({ days, dash, filter, onOpenDetail }: Props) {
  const core = useCoreXp(days)
  /** 实时数据流：把最近事件按时间倒序逐条浮现（真实事件） */
  const [shown, setShown] = useState<number>(0)
  const events = useMemo(() => {
    const all = days.flatMap((d) => d.items).filter((i) => filter === 'all' || i.t === filter)
    const list = [...all].sort((a, b) => (b.ts || b.date).localeCompare(a.ts || a.date) || b.date.localeCompare(a.date))
    return list.slice(0, 24)
  }, [days, filter])
  useEffect(() => {
    setShown(0)
    if (events.length === 0) return
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= events.length) { clearInterval(timer); return n }
        return n + 1
      })
    }, 1100)
    return () => clearInterval(timer)
  }, [events.length])

  const xp = useCountUp(core.xp)
  const seg = useCountUp(Math.min(100, (core.seg / 500) * 100) * 5) // 进度条亮度

  const visible = events.slice(0, shown)

  return (
    <div className="core-world">
      {/* 背景空间层 */}
      <div className="core-bg" />
      <div className="core-hud-labels">
        <span>PERSONAL DATA CORE</span>
        <em>个人数据核心 · 运行中</em>
      </div>

      {/* 中央核心 */}
      <div className="core-center">
        <div className="core-orbit o1" />
        <div className="core-orbit o2" />
        <div className="core-orb">
          <div className="core-lv">LV {core.lv}</div>
          <div className="core-xp">{xp.toLocaleString()} XP</div>
          <div className="core-xpbar"><i style={{ width: `${(core.seg / 500) * 100}%`, opacity: Math.min(1, 0.35 + seg / 100) }} /></div>
        </div>
        <div className="core-caption">◎ PERSONAL DATA CORE</div>
        <div className="core-totals">
          {TL_TYPES.map(([k]) => (
            <span key={k} style={{ color: TL_COLOR[k] }}><i style={{ background: TL_COLOR[k] }} />{TL_TYPES.find(([kk]) => kk === k)![1]}&nbsp;{(dash?.totals[k] ?? 0).toLocaleString()}</span>
          ))}
        </div>
      </div>

      {/* 数据环（六类统计） */}
      <div className="core-ring-wrap">
        {TL_TYPES.map(([k, label]) => {
          const s = statOf(dash, k)
          return (
            <button key={k} className={`core-stat t-${k}`} style={{ ['--c' as string]: TL_COLOR[k] }}
              onClick={() => {
                // 打开该类型最近一条真实记录（在 events 里取同类型最新）
                const head = events.find((e) => e.t === k)
                if (head) onOpenDetail(head)
              }}
              title={filter === 'all' || filter === k ? `查看最近「${label}」记录` : '当前筛选未包含该类型'}>
              <span className="core-stat-ring" style={{ ['--p' as string]: `${s.pct ?? 0}%` }}>
                <b>{s.value.toLocaleString()}</b>
              </span>
              <em>{label}</em>
            </button>
          )
        })}
      </div>

      {/* 中央完成弧（整体完成度 = 计划+工作任务完成 / 总量） */}
      <div className="core-arc" style={{ ['--p' as string]: `${dash && dash.plan.total + dash.worktask.total > 0 ? Math.round(((dash.plan.done + dash.worktask.done) / (dash.plan.total + dash.worktask.total)) * 100) : 0}%` }}>
        <span className="core-arc-label">完成率</span>
      </div>

      {/* 实时数据流（真实事件顺次浮现） */}
      <div className="core-stream">
        <div className="core-stream-head">◉ 实时数据流</div>
        <div className="core-stream-body">
          {visible.length === 0 && <span className="core-stream-empty">等待数据脉冲…（数据同步中）</span>}
          {visible.map((n) => (
            <button key={n.id + n.date} className="stream-row" style={{ ['--c' as string]: TL_COLOR[n.t] }}
              onClick={() => onOpenDetail(n)}>
              <i className="stream-dot" />
              <span className="stream-time">{n.ts ? n.ts.slice(11, 19) : (n.date.slice(5) + ' 00:00')}</span>
              <b className="stream-type">{TL_TYPES.find(([kk]) => kk === n.t)?.[1]}</b>
              <em>{n.title}</em>
              {n.xp ? <span className="stream-xp">+{n.xp} XP</span> : null}
            </button>
          ))}
        </div>
      </div>

      {/* 底部：服务器时间（真实） */}
      <Clock />
    </div>
  )
}

/** 真实时间：每秒更新的服务器侧本地时间（大屏氛围辅助层） */
function Clock() {
  const [t, setT] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <div className="core-clock">
      {t.getFullYear()}-{pad(t.getMonth() + 1)}-{pad(t.getDate())} {pad(t.getHours())}:{pad(t.getMinutes())}:{pad(t.getSeconds())}
    </div>
  )
}