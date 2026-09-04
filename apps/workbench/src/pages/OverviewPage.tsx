/** 总览 · 数据可视化大屏体系（需求文档）：同一份真实数据的四种独立世界观
 *  时光长河(fish) 观察「时间」 / 节点宇宙(uni) 观察「关系」 / 数字城市(city) 观察「状态」 / 数据核心(core) 观察「运行」
 *  顶层：世界切换导航（淡入过渡）· 类型/时间筛选 · HUD 独立浮窗右上 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, logClient, type DashboardStats, type TimelineDay, type TimelineNode, type TimelineType } from '../api'
import { useAuth } from '../auth'
import { TL_TYPES } from '../components/timeline/timeline'
import { TimelineBubbles, type SplitMode } from '../components/timeline/TimelineBubbles'
import { TimelineUniverse3d } from '../components/timeline/TimelineUniverse3d'
import { TimelineCity } from '../components/timeline/TimelineCity'
import { DataCore } from '../components/timeline/DataCore'
import { TimelineDetailDrawer } from '../components/timeline/TimelineDetailDrawer'
import { BattleCard } from '../components/battle/BattleCard'
import { LevelUpOverlay } from '../components/battle/LevelUpOverlay'
import { filterNodes } from '../components/timeline/timeline'
import { AvatarMenu } from '../components/framework/AvatarMenu'
import { EmptyState } from '../components/framework/EmptyState'
import { Loading } from '../components/framework/Loading'
import { RangePicker, DEFAULT_RANGE, quickToRange, type RangeState } from '../components/timeline/RangePicker'
import { addDays, todayYMD } from '../lib/date'

/** 四种独立世界观 */
type View = 'fish' | 'uni' | 'city' | 'core'

const WORLDS: Array<{ id: View; icon: string; label: string; tip: string }> = [
  { id: 'fish', icon: '◉', label: '时光', tip: '观察「时间」：什么时间发生了什么' },
  { id: 'uni', icon: '◎', label: '神经', tip: '观察「关系」：数据之间如何连接' },
  { id: 'city', icon: '◇', label: '城市', tip: '观察「状态」：数字世界整体运行' },
  { id: 'core', icon: '△', label: '核心', tip: '观察「运行」：当前整体指标' },
]

/** 时间缩放档位（需求 §5.4）：当天 / 近7天 / 近30天 / 本月 / 近一年 */
const SCALES: Array<{ id: string; label: string; to: RangeState }> = [
  { id: 'day', label: '当天', to: { mode: 'custom', quick: 7, from: todayYMD(), to: todayYMD() } },
  { id: 'week', label: '近7天', to: { ...quickToRange(7), mode: 'quick', quick: 7 } },
  { id: 'month', label: '近30天', to: { ...quickToRange(30), mode: 'quick', quick: 30 } },
  { id: 'cur-month', label: '本月', to: { mode: 'custom', quick: 30, from: todayYMD().slice(0, 7) + '-01', to: todayYMD() } },
  { id: 'year', label: '近一年', to: { ...quickToRange(365), mode: 'quick', quick: 365 } },
]
function scaleIdOf(r: RangeState): string {
  for (const s of SCALES) {
    if (s.to.mode === r.mode && s.to.from === r.from && s.to.to === r.to) return s.id
  }
  return ''
}

const RANGE_KEY = 'cl_tl_range'

function loadRangePref(): RangeState {
  try {
    const raw = localStorage.getItem(RANGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as RangeState
      if (p && (p.mode === 'quick' || p.mode === 'custom')) {
        if (p.mode === 'custom' && p.from && p.to) return { ...DEFAULT_RANGE, mode: 'custom', from: p.from, to: p.to }
        const q = Number(p.quick) || 30
        return { ...quickToRange(q), mode: 'quick', quick: q }
      }
    }
  } catch { /* 忽略损坏偏好 */ }
  return DEFAULT_RANGE
}

export function OverviewPage() {
  const { user } = useAuth()
  const [days, setDays] = useState<TimelineDay[]>([])
  const [dash, setDash] = useState<DashboardStats | null>(null)
  const [view, setView] = useState<View>(() => {
    const v = localStorage.getItem('cl_default_view')
    if (v === 'universe') return 'uni'
    if (v === 'city') return 'city'
    if (v === 'core') return 'core'
    return 'fish'
  })
  const [filter, setFilter] = useState<TimelineType | 'all'>('all')
  const [split, setSplit] = useState<SplitMode>('time')
  const [range, setRange] = useState<RangeState>(loadRangePref)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(false)
  const [dashErr, setDashErr] = useState(false)
  const [gameSignal, setGameSignal] = useState(0)
  const [detailNode, setDetailNode] = useState<TimelineNode | null>(null)

  const load = () => {
    setLoading(true)
    setLoadErr(false)
    const qs = range.mode === 'custom'
      ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
      : `?limit=${range.quick}`
    api.get<{ days: TimelineDay[] }>(`/workbench/timeline${qs}`)
      .then((r) => setDays(r.days))
      .catch((e: Error) => {
        setLoadErr(true)
        logClient('error', 'timeline', '时间轴数据加载失败', { qs, err: e.message })
      })
      .finally(() => setLoading(false))
    // 数据核心/数字城市统计（真实聚合，数值面积小，随视图一起拉取）
    api.get<DashboardStats>('/workbench/dashboard')
      .then(setDash)
      .catch(() => setDashErr(true))
  }
  useEffect(load, [range])
  // 速记全局保存广播：总览页收到后刷新
  useEffect(() => {
    const onSaved = () => load()
    window.addEventListener('cl:quicknote:saved', onSaved)
    return () => window.removeEventListener('cl:quicknote:saved', onSaved)
  }, [])
  useEffect(() => {
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(range)) } catch { /* 忽略 */ }
  }, [range])

  // HUD 游戏化（按当前筛选折算）
  const hud = useMemo(() => {
    let xp = 0, gold = 0
    for (const d of days) {
      for (const it of filterNodes(d.items, filter)) { xp += it.xp || 0; gold += it.gold || 0 }
    }
    const lv = Math.max(1, Math.floor(xp / 500) + 1)
    return { xp, gold, lv, seg: xp % 500, segMax: 500 }
  }, [days, filter])

  // 升级检测（真实的经验增长才播特效）
  const maxXpRef = useRef<number | null>(null)
  const [levelUp, setLevelUp] = useState(false)
  useEffect(() => {
    if (filter !== 'all' || days.length === 0) return
    const base = maxXpRef.current
    if (base === null) { maxXpRef.current = hud.xp; return }
    if (hud.xp > base) {
      maxXpRef.current = hud.xp
      const prevLv = Math.floor(base / 500) + 1
      if (hud.lv > prevLv) {
        setLevelUp(true)
        const t = setTimeout(() => setLevelUp(false), 2400)
        return () => clearTimeout(t)
      }
    } else if (hud.xp < base) { maxXpRef.current = hud.xp }
  }, [hud.xp, filter, days.length])

  const avatar = (user?.nickname?.trim() || user?.email?.slice(0, 1) || '云').slice(0, 1).toUpperCase()
  const scaleId = scaleIdOf(range)

  // 时间缩放：滚轮在河流视图上循环档位
  const onRiverWheel = (e: React.WheelEvent) => {
    if (view !== 'fish') return
    e.preventDefault()
    const idx = SCALES.findIndex((s) => s.id === scaleId)
    const next = idx < 0 ? 1 : (e.deltaY > 0 ? idx + 1 : idx - 1 + SCALES.length) % SCALES.length
    setRange(SCALES[next].to)
  }

  return (
    <>
      {/* 第一层：世界切换导航（四种独立世界 · 悬浮） */}
      <div className="world-nav" role="tablist" aria-label="数据世界切换">
        {WORLDS.map((w) => (
          <button
            key={w.id}
            role="tab"
            aria-selected={view === w.id}
            className={`world-nav-item${view === w.id ? ' on' : ''}`}
            onClick={() => setView(w.id)}
            title={w.tip}
          >
            <span className="world-icon">{w.icon}</span>
            <span className="world-label">{w.label}</span>
          </button>
        ))}
        <span className="world-nav-tip">同一份数据 · 四种解释方式</span>
      </div>

      {/* 筛选条（城市/核心/河流可见；宇宙沉浸式隐藏） */}
      {view !== 'uni' && (
        <div className="tl-bar sub">
          <div className="fchips">
            <button className={`fchip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>全部</button>
            {TL_TYPES.map(([k, l]) => (
              <button key={k} className={`fchip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div className="vtabs mini">
            {view === 'fish' && (
              <button className={`vtab${split === 'time' ? ' on' : ''}`} onClick={() => setSplit('time')}>按时间</button>
            )}
            {view === 'fish' && (
              <button className={`vtab${split === 'type' ? ' on' : ''}`} onClick={() => setSplit('type')}>按类型</button>
            )}
          </div>
          {/* 时间缩放（河流） */}
          {view === 'fish' && (
            <div className="scale-seg" title="滚轮在画布上切换时间尺度">
              {SCALES.map((s) => (
                <button key={s.id} className={`scale-btn${scaleId === s.id ? ' on' : ''}`} onClick={() => setRange(s.to)}>{s.label}</button>
              ))}
            </div>
          )}
          <RangePicker value={range} onChange={setRange} />
        </div>
      )}

      {/* HUD：独立浮窗右上（portal 到 body） */}
      {createPortal(
        <div className="hud">
          <span className="hud-pill" title={filter === 'all' ? '当前等级（沉淀折算）' : '当前筛选下的等级'}>
            <b>{filter === 'all' ? `LV ${hud.lv}` : `筛选 LV ${hud.lv}`}</b>
            <span className="xpbar"><i style={{ width: `${Math.min(100, (hud.seg / hud.segMax) * 100)}%` }} /></span>
            <b>{hud.xp.toLocaleString()} XP</b></span>
          <span className="hud-pill hud-gold" title="记账折算的金币">🪙 <b>{hud.gold.toLocaleString()}</b></span>
          <AvatarMenu size="sm" align="right" badge={String(hud.lv)} />
        </div>,
        document.body,
      )}

      {/* 视图容器：加载中 / 错误 / 空态 / 四视图 */}
      {loading ? (
        <Loading label="数据世界构建中…" />
      ) : loadErr ? (
        <EmptyState variant="hero" icon="☁️">
          数据加载失败，请稍后重试
          <button className="btn slim" style={{ marginTop: 10 }} onClick={load}>重试</button>
        </EmptyState>
      ) : (
        <div key={view} className="view-slot fade-in">
          {view === 'fish' && (
            <>
              <div className="tl-head">
                <div className="tl-greet hero">
                  <div className="hi">时光长河</div>
                  <div className="sub">时间不是线，而是一条有你所有痕迹的河流 · 滚轮切换时间尺度</div>
                </div>
              </div>
              {days.length === 0
                ? <EmptyState variant="hero" icon="🌱">河床上还没有卵石 · 点「⚡ 速记」丢下第一颗</EmptyState>
                : <div className="river-scroll" onWheel={onRiverWheel}><TimelineBubbles days={days} filter={filter} split={split} onMoved={load} onOpenDetail={setDetailNode} active /></div>}
            </>
          )}
          {view === 'uni' && days.length > 0 && (
            <TimelineUniverse3d days={days} filter={filter} avatar={avatar} onBack={() => setView('fish')} onOpenGame={() => { setView('fish'); setGameSignal(Date.now()) }} />
          )}
          {view === 'uni' && days.length === 0 && (
            <EmptyState variant="hero" icon="🌌">宇宙中心尚无一星 · 数据连接尚未形成</EmptyState>
          )}
          {view === 'city' && (
            <TimelineCity days={days} dash={dash} filter={filter} active onOpenDetail={setDetailNode} />
          )}
          {view === 'core' && (
            <DataCore days={days} dash={dash} filter={filter} onOpenDetail={setDetailNode} />
          )}
        </div>
      )}

      {/* 时间流节点完整详情（四个世界共用） */}
      <TimelineDetailDrawer node={detailNode} onClose={() => setDetailNode(null)} />

      {levelUp && <LevelUpOverlay level={hud.lv} />}
      <BattleCard onSlain={load} openSignal={gameSignal} />
    </>
  )
}