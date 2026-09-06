/**
 * 大屏三 · 个人数字城市（需求文档 §7）
 * 核心问题：「我的整个数字世界现在是什么状态？」—— 城市 = 状态，不做神经连接
 * 固定的数据 → 城市元素映射（全部来自真实数据，不虚构城市指标）：
 *   目标 → 中心地标（自转进度环）      计划 → 施工地 + 建成塔（完成亮灯）
 *   日志 → 街区楼宇（窗口灯火 ∝ 字数）   灵感 → 信息塔（信号脉冲）
 *   习惯 → 能源中心（电芯叠层 ∝ 连续天数） 记账 → 资源库（金垛 ∝ 金额）
 * 交互：拖拽平移 / 滚轮缩放 / 区域点击 → 右侧真实数据面板 → 详情抽屉。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DashboardStats, TimelineDay, TimelineNode, TimelineType } from '../../api'
import { TL_COLOR, TL_TYPES, filterNodes } from './timeline'

interface Props {
  days: TimelineDay[]
  dash: DashboardStats | null
  filter: TimelineType | 'all'
  active: boolean
  onOpenDetail: (node: TimelineNode) => void
}

/** 确定性伪随机（同一输入产出同城，避免每次刷新城市变样） */
function prand(n: number): number {
  const x = Math.sin(n * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

interface ZoneDef {
  key: TimelineType
  label: string
  sub: string
  pos: { x: number; y: number } // 百分比
  icon: string
  accent: string
}

const ZONES: ZoneDef[] = [
  { key: 'goal', label: '目标中心', sub: '城市核心地标 · 进度恒照', icon: '🏛', pos: { x: 50, y: 14 }, accent: TL_COLOR.goal },
  { key: 'plan', label: '计划区', sub: '施工与建成 · 完成即亮灯', icon: '🏗', pos: { x: 18, y: 32 }, accent: TL_COLOR.plan },
  { key: 'note', label: '灵感区', sub: '信息塔 · 脉冲信号', icon: '📡', pos: { x: 82, y: 32 }, accent: TL_COLOR.note },
  { key: 'journal', label: '日志区', sub: '街区楼宇 · 灯火通明', icon: '🏘', pos: { x: 14, y: 68 }, accent: TL_COLOR.journal },
  { key: 'checkin', label: '习惯区', sub: '能源中心 · 连续供能', icon: '🔋', pos: { x: 86, y: 68 }, accent: TL_COLOR.checkin },
  { key: 'ledger', label: '资源区', sub: '资源库 · 金垛累积', icon: '💰', pos: { x: 50, y: 88 }, accent: TL_COLOR.ledger },
]

export function TimelineCity({ days, dash, filter, active, onOpenDetail }: Props) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zone, setZone] = useState<TimelineType | null>(null)
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  /** 近 7 天活跃度（决定城市灯火/脉冲强度） */
  const activity = useMemo(() => {
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    from.setDate(from.getDate() - 6)
    const acc: Record<string, number> = {}
    for (const d of days) {
      if (d.date < from.toISOString().slice(0, 10)) continue
      for (const n of d.items) acc[n.t] = (acc[n.t] || 0) + 1
    }
    return acc
  }, [days])

  // 城市数据 → 建筑生成（真实数量，封顶聚合并标注 ×N）
  interface ZoneData { n: number; pct: number; done: number; chars: number; streak: number; income: number }
  const city: Record<TimelineType, ZoneData> = useMemo(() => {
    const totals = dash?.totals ?? ({} as Partial<Record<string, number>>)
    return {
      goal: { n: totals.goal ?? 0, pct: dash?.goal.pct ?? 0, done: 0, chars: 0, streak: 0, income: 0 },
      plan: { n: totals.plan ?? 0, done: dash?.plan.done ?? 0, pct: 0, chars: 0, streak: 0, income: 0 },
      journal: { n: totals.journal ?? 0, chars: dash?.chars ?? 0, pct: 0, done: 0, streak: 0, income: 0 },
      note: { n: totals.note ?? 0, pct: 0, done: 0, chars: 0, streak: 0, income: 0 },
      checkin: { n: totals.checkin ?? 0, streak: dash?.checkin.maxStreak ?? 0, pct: 0, done: 0, chars: 0, income: 0 },
      ledger: { n: totals.ledger ?? 0, income: dash?.ledger.income ?? 0, pct: 0, done: 0, chars: 0, streak: 0 },
      focus: { n: totals.focus ?? 0, pct: 0, done: 0, chars: 0, streak: 0, income: 0 },
    }
  }, [dash])

  const zoneItems = (k: TimelineType): TimelineNode[] =>
    days.flatMap((d) => filterNodes(d.items, filter === 'all' ? k : filter)).slice(0, 9)

  const total = Object.values(city).reduce((a, z) => a + (z.n || 0), 0)

  // 拖拽平移 / 滚轮缩放（仅城市视图激活时）
  useEffect(() => {
    if (!active) return
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setZoom((z) => Math.min(2.2, Math.max(0.6, z + (e.deltaY < 0 ? 0.12 : -0.12))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [active])

  return (
    <div
      className={`city-stage${active ? '' : ' idle'}`}
      ref={stageRef}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button, .zone-panel')) return
        dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false }
      }}
      onMouseMove={(e) => {
        const d = dragRef.current
        if (!d) return
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
        setPan({ x: d.px + dx, y: d.py + dy })
      }}
      onMouseUp={() => { dragRef.current = null }}
      onMouseLeave={() => { dragRef.current = null }}
    >
      {/* 第一层：背景空间 */}
      <div className="city-bg" />
      <div className="city-grid" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />

      {/* 第二层：城市本体（可缩放平移） */}
      <div className="city-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        {/* 动画小人：工地工人挥锤 + 行人穿城（火柴人 · 纯氛围装饰） */}
        <span className="city-folk worker" aria-hidden="true">
          <svg viewBox="0 0 44 60">
            <circle cx="16" cy="8" r="4.6" />
            <line x1="16" y1="13" x2="16" y2="32" />
            <line x1="16" y1="18" x2="8" y2="25" />
            <g className="cw-hammer"><line x1="16" y1="18" x2="26" y2="12" /><line x1="26" y1="12" x2="31" y2="10" strokeWidth="4.5" /></g>
            <line x1="16" y1="32" x2="10" y2="48" />
            <line x1="16" y1="32" x2="22" y2="48" />
          </svg>
          <i className="cw-dust" />
        </span>
        <span className="city-folk walker" aria-hidden="true">
          <svg viewBox="0 0 40 60">
            <circle cx="20" cy="8" r="4.6" />
            <line x1="20" y1="13" x2="20" y2="31" />
            <g className="cw-swing a"><line x1="20" y1="17" x2="27" y2="24" /></g>
            <g className="cw-swing b"><line x1="20" y1="17" x2="13" y2="24" /></g>
            <g className="cw-swing c"><line x1="20" y1="31" x2="26" y2="47" /></g>
            <g className="cw-swing d"><line x1="20" y1="31" x2="14" y2="47" /></g>
          </svg>
        </span>

        {/* 中央核心广场 */}
        <div className="city-core" style={{ left: '50%', top: '50%' }}>
          <div className="city-core-ring r1" />
          <div className="city-core-ring r2" />
          <div className="city-core-orb">
            <b>{total}</b>
            <em>全部沉淀</em>
          </div>
        </div>

        {ZONES.map((z, zi) => {
          const d = city[z.key]
          const recent = activity[z.key] ?? 0
          const hot = recent > 0
          return (
            <button
              key={z.key}
              className={`city-zone t-${z.key}${hot ? ' hot' : ''}${filter !== 'all' && filter !== z.key ? ' muted' : ''}`}
              style={{ left: `${z.pos.x}%`, top: `${z.pos.y}%`, ['--c' as string]: z.accent }}
              onClick={() => setZone(zone === z.key ? null : z.key)}
              title={`${z.label}：${d.n} 条真实记录（近 7 天活跃 ${recent} 条）`}
            >
              <span className="zone-label"><i>{z.icon}</i><b>{z.label}</b><em>{d.n}</em></span>
              {/* 目标地标：进度光环 */}
              {z.key === 'goal' && <span className="goal-monument"><i style={{ ['--p' as string]: `${d.pct}%` }} /></span>}
              {/* 计划：施工地 vs 建成塔 */}
              {z.key === 'plan' && (
                <span className="plan-builds">
                  {[0, 1, 2, 3, 4].map((i) => i < Math.min(5, Math.max(1, d.n)) ? (
                    <i key={i} className={i < Math.min(5, d.done) ? 'built' : 'site'} style={{ height: 26 + 16 * prand(zi * 13 + i) }} />
                  ) : null)}
                </span>
              )}
              {/* 日志：楼宇窗口灯火（∝ 字数/数量） */}
              {z.key === 'journal' && (
                <span className="journal-blocks">
                  {[0, 1, 2, 3].map((i) => (
                    <i key={i} style={{ height: 34 + 18 * Math.min(2, d.n + i) }}>
                      {Array.from({ length: 3 }, (_, w) => <u key={w} className={hot || i % 2 === 0 ? 'on' : ''} />)}
                    </i>
                  ))}
                </span>
              )}
              {/* 灵感：信息塔脉冲 */}
              {z.key === 'note' && <span className={`note-tower${hot ? ' pulse' : ''}`}><i /><i /><i /></span>}
              {/* 习惯：能源电芯（∝ 连续天数） */}
              {z.key === 'checkin' && (
                <span className="energy-cells">
                  {Array.from({ length: Math.min(6, Math.max(1, Math.ceil(d.streak / 5))) }, (_, i) => <i key={i} className={i < Math.min(6, Math.ceil(d.streak / 5)) ? 'on' : ''} />)}
                  <em>{d.streak} 连</em>
                </span>
              )}
              {/* 记账：资源金垛（∝ 收入金额） */}
              {z.key === 'ledger' && (
                <span className="coin-vault">
                  {[0, 1, 2].map((i) => <i key={i} style={{ height: 18 + 10 * Math.min(3, i + Math.round(d.income / 5000)) }} />)}
                  <em>¥{(d.income / 1000).toFixed(1)}k</em>
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 第三层：城市信息 */}
      <div className="city-hud">
        <span>数字城市 · 6 区域</span>
        <em>{new Date().toLocaleTimeString('zh-CN', { hour12: false })}</em>
      </div>

      {/* 第四层：操作 */}
      <div className="city-ops">
        <button className="btn slim ghost" title="放大" onClick={() => setZoom((z) => Math.min(2.2, z + 0.2))}>＋</button>
        <button className="btn slim ghost" title="缩小" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}>－</button>
        <button className="btn slim ghost" title="重置视角" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setZone(null) }}>重置</button>
      </div>

      {/* 区域详情面板（真实数据） */}
      {zone && (
        <div className="zone-panel">
          <div className="zone-panel-h">
            <b>{ZONES.find((z) => z.key === zone)?.icon} {ZONES.find((z) => z.key === zone)?.label}</b>
            <button onClick={() => setZone(null)}>✕</button>
          </div>
          <div className="zone-panel-sub">{ZONES.find((z) => z.key === zone)?.sub}</div>
          <div className="zone-panel-list">
            {zoneItems(zone).length === 0 && <span className="zone-empty">该区域暂无记录 · 数据产生后会在此点亮</span>}
            {zoneItems(zone).map((n) => (
              <button key={n.id} className="zone-item" onClick={() => onOpenDetail(n)} style={{ ['--c' as string]: TL_COLOR[n.t] }}>
                <i className="zone-item-dot" />
                <span><b>{n.title}</b><em>{n.date}{n.xp ? ` · +${n.xp} XP` : ''}</em></span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 辅助层注释：城市已就绪 */}
    </div>
  )
}