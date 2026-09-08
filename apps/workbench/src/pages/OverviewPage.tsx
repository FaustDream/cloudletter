/** 总览 · 数据可视化大屏体系（需求文档）：同一份真实数据的四种独立世界观
 *  时光长河(fish) 观察「时间」 / 节点宇宙(uni) 观察「关系」 / 数字城市(city) 观察「状态」 / 数据核心(core) 观察「运行」
 *  顶层：世界切换导航（淡入过渡）· 类型/时间筛选 · HUD 独立浮窗右上 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, logClient, type DashboardStats, type TimelineDay, type TimelineNode, type TimelineType } from '../api'
import { useAuth } from '../auth'
import { filterNodes } from '../components/timeline/timeline'
import { TypeFilter } from '../components/timeline/TypeFilter'
import { TimelineBubbles, type SplitMode } from '../components/timeline/TimelineBubbles'
import { TimelineUniverse3d } from '../components/timeline/TimelineUniverse3d'
import { TimelineCity } from '../components/timeline/TimelineCity'
import { DataCore } from '../components/timeline/DataCore'
import { TimelineDetailDrawer } from '../components/timeline/TimelineDetailDrawer'
import { BattleCard } from '../components/battle/BattleCard'
import { LevelUpOverlay } from '../components/battle/LevelUpOverlay'
import { AvatarMenu } from '../components/framework/AvatarMenu'
import { EmptyState } from '../components/framework/EmptyState'
import { Loading } from '../components/framework/Loading'
import { RangePicker, DEFAULT_RANGE, quickStateOf, type RangeState } from '../components/timeline/RangePicker'
import { readGamePrefs, type GamePrefs } from '../lib/gamePrefs'

/** 四种独立世界观 */
type View = 'fish' | 'uni' | 'city' | 'core'

const WORLDS: Array<{ id: View; icon: string; label: string; tip: string }> = [
  { id: 'fish', icon: '◉', label: '时光', tip: '观察「时间」：什么时间发生了什么' },
  { id: 'uni', icon: '◎', label: '神经', tip: '观察「关系」：数据之间如何连接' },
  { id: 'city', icon: '◇', label: '城市', tip: '观察「状态」：数字世界整体运行' },
  { id: 'core', icon: '△', label: '核心', tip: '观察「运行」：当前整体指标' },
]

const RANGE_KEY = 'cl_tl_range'

function loadRangePref(): RangeState {
  try {
    const raw = localStorage.getItem(RANGE_KEY)
    if (raw) {
      const p = JSON.parse(raw) as RangeState
      if (p && (p.mode === 'quick' || p.mode === 'custom')) {
        if (p.mode === 'custom' && p.from && p.to) return { ...DEFAULT_RANGE, mode: 'custom', from: p.from, to: p.to }
        const q = Number(p.quick)
        if (Number.isFinite(q) && q >= 0) return quickStateOf(q)
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
  const [filter, setFilter] = useState<TimelineType[]>([])
  const [split, setSplit] = useState<SplitMode>('time')
  const [range, setRange] = useState<RangeState>(loadRangePref)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(false)
  const [gameSignal, setGameSignal] = useState(0)
  // 游戏化开关（设置 → 游戏）：讨伐 / 经验升级 默认关闭
  const [game, setGame] = useState<GamePrefs>(readGamePrefs)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'cl_game_prefs') setGame(readGamePrefs()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
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
      .catch(() => { /* dashboard 拉取失败不阻塞视图：卡片区显示 0，仅记日志 */ })
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

  // HUD 游戏化（按当前筛选折算）：等级徽标 + 升级检测（经验/金币不再展示在右上角，仅保留折算逻辑）
  const hud = useMemo(() => {
    let xp = 0
    for (const d of days) {
      for (const it of filterNodes(d.items, filter)) xp += it.xp || 0
    }
    return { xp, lv: Math.max(1, Math.floor(xp / 500) + 1) }
  }, [days, filter])

  // 升级检测（真实的经验增长才播特效）
  const maxXpRef = useRef<number | null>(null)
  const [levelUp, setLevelUp] = useState(false)
  useEffect(() => {
    if (filter.length > 0 || days.length === 0) return
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
      </div>

      {/* 筛选条（城市/核心/河流可见；宇宙沉浸式隐藏） */}
      {view !== 'uni' && (
        <div className="tl-bar sub">
          <TypeFilter selected={filter} onChange={setFilter} />
          <div className="vtabs mini">
            {view === 'fish' && (
              <button className={`vtab${split === 'time' ? ' on' : ''}`} onClick={() => setSplit('time')}>按时间</button>
            )}
            {view === 'fish' && (
              <button className={`vtab${split === 'type' ? ' on' : ''}`} onClick={() => setSplit('type')}>按类型</button>
            )}
          </div>
          {/* 时间范围（快捷档位 + 自定义起止日期，全部收进日期控件） */}
          <RangePicker value={range} onChange={setRange} />
        </div>
      )}

      {/* HUD：独立浮窗右上（portal 到 body）。经验/金币已按需求撤下，只留头像 */}
      {createPortal(
        <div className="hud">
          <AvatarMenu size="sm" align="right" badge={game.xp ? String(hud.lv) : undefined} />
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
                  <div className="sub">时间不是线，而是一条有你所有痕迹的河流 · 用右上角日期控件切换时间尺度</div>
                </div>
              </div>
              {/* 滚轮容器常驻：空态也留在河面内；滚轮只负责上下翻页，不再切换时间档位 */}
              <div className="river-scroll">
                {days.length === 0
                  ? <EmptyState variant="hero" icon="🌱">河床上还没有卵石 · 在右上角日期控件选一个更大的时间范围，回到有痕迹的日子</EmptyState>
                  : <TimelineBubbles days={days} filter={filter} split={split} onMoved={load} onOpenDetail={setDetailNode} />}
              </div>
            </>
          )}
          {view === 'uni' && days.length > 0 && (
            <TimelineUniverse3d days={days} filter={filter} avatar={avatar} battle={game.battle} onOpenGame={() => { setView('fish'); setGameSignal(Date.now()) }} />
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

      {game.xp && levelUp && <LevelUpOverlay level={hud.lv} />}
      {game.battle && <BattleCard onSlain={load} openSignal={gameSignal} />}
    </>
  )
}