/** 总览 · 双视图时间线：气泡时间线找东西 / 节点宇宙感受沉淀 —— 同一份 /workbench/timeline 数据两种渲染
 *  顶部层次：视图切换器独立一行(最高优先级) · 类型筛选+时间范围并排一行 · HUD 独立浮窗右上 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, logClient, type TimelineDay, type TimelineType } from '../api'
import { useAuth } from '../auth'
import { TL_TYPES } from '../components/timeline/timeline'
import { TimelineBubbles, type SplitMode } from '../components/timeline/TimelineBubbles'
import { TimelineUniverse3d } from '../components/timeline/TimelineUniverse3d'
import { QuickNoteModal } from '../components/timeline/QuickNoteModal'
import { BattleCard } from '../components/battle/BattleCard'
import { LevelUpOverlay } from '../components/battle/LevelUpOverlay'
import { filterNodes } from '../components/timeline/timeline'
import { AvatarMenu } from '../components/framework/AvatarMenu'
import { EmptyState } from '../components/framework/EmptyState'
import { Loading } from '../components/framework/Loading'
import { RangePicker, DEFAULT_RANGE, quickToRange, type RangeState } from '../components/timeline/RangePicker'

type View = 'fish' | 'uni'

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
  const [view, setView] = useState<View>(() => (localStorage.getItem('cl_default_view') === 'universe' ? 'uni' : 'fish'))
  const [filter, setFilter] = useState<TimelineType | 'all'>('all')
  const [split, setSplit] = useState<SplitMode>('time')
  const [range, setRange] = useState<RangeState>(loadRangePref)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(false)
  /** 讨伐卡打开信号（时间线/宇宙的游戏入口点击时间戳） */
  const [gameSignal, setGameSignal] = useState(0)

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
  }
  useEffect(load, [range])
  // 记忆上次范围（仅在用户主动改过时写入，避免每次加载就覆盖）
  useEffect(() => {
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(range)) } catch { /* 忽略 */ }
  }, [range])

  // HUD 游戏化：按当前筛选折算（筛选时显示「筛选后等级」；数据来自时间轴真实沉淀）
  const hud = useMemo(() => {
    let xp = 0, gold = 0
    for (const d of days) {
      for (const it of filterNodes(d.items, filter)) { xp += it.xp || 0; gold += it.gold || 0 }
    }
    const lv = Math.max(1, Math.floor(xp / 500) + 1)
    const segMax = 500
    const seg = xp % segMax
    return { xp, gold, lv, seg, segMax }
  }, [days, filter])

  // 升级检测：只在「全部数据」的经验超过历史最高时才算真实升级。
  // 首屏加载（空数据 → 有数据）与筛选切换（xp 缩小/恢复）都只是基线同步，不播特效。
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
    } else if (hud.xp < base) {
      maxXpRef.current = hud.xp
    }
  }, [hud.xp, filter, days.length])

  const avatar = (user?.nickname?.trim() || user?.email?.slice(0, 1) || '云').slice(0, 1).toUpperCase()

  return (
    <>
      {/* 时间线视图的顶部控件（宇宙视图收起顶部栏 → 画布居中一体） */}
      {view === 'fish' && (
        <>
          <div className="tl-head">
            <div className="tl-greet"><div className="hi">时光长河</div><div className="sub">每一天都是河床上的卵石 · 气泡承载 · 宇宙沉淀 · 同一份数据两种渲染</div></div>
          </div>
          <div className="tl-bar">
            <div className="vtabs">
              <button className="vtab on" onClick={() => setView('fish')}>🌊 时光长河</button>
              <button className="vtab" onClick={() => setView('uni')}>🌌 节点宇宙</button>
            </div>
            <span className="axis-note">悬浮看详情 · 点击常驻 · 小结直显，悬浮看全文</span>
            <div className="spacer" />
            {/* 游戏入口：讨伐（任务即怪物） */}
            <button className="btn slim game-entry" onClick={() => setGameSignal(Date.now())} title="打怪 = 完成任务，掉落经验与金币">
              ⚔️ 今日讨伐 <b>游戏</b>
            </button>
          </div>
          <div className="tl-bar sub">
            <div className="fchips">
              <button className={`fchip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>全部</button>
              {TL_TYPES.map(([k, l]) => (
                <button key={k} className={`fchip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <div className="vtabs mini">
              <button className={`vtab${split === 'time' ? ' on' : ''}`} onClick={() => setSplit('time')}>按时间</button>
              <button className={`vtab${split === 'type' ? ' on' : ''}`} onClick={() => setSplit('type')}>按类型</button>
            </div>
            <RangePicker value={range} onChange={setRange} />
          </div>
        </>
      )}

      {/* ③ HUD：独立浮窗右上（不随视图/筛选消失；portal 到 body 避开 .screen 的 transform 包含块） */}
      {createPortal(
        <div className="hud">
          <span className="hud-pill" title={filter === 'all' ? '当前等级（近 30 天沉淀折算）' : '当前筛选下的等级'}>
            <b>{filter === 'all' ? `LV ${hud.lv}` : `筛选 LV ${hud.lv}`}</b>
            <span className="xpbar"><i style={{ width: `${Math.min(100, (hud.seg / hud.segMax) * 100)}%` }} /></span>
            <b>{hud.xp.toLocaleString()} XP</b></span>
          <span className="hud-pill hud-gold" title="记账折算的金币">🪙 <b>{hud.gold.toLocaleString()}</b></span>
          <AvatarMenu size="sm" align="right" badge={String(hud.lv)} />
        </div>,
        document.body,
      )}

      {/* 视图容器：加载中显动画；失败给可重试空态；无数据给引导；否则渲染双视图 */}
      {loading ? (
        <Loading label="时光沉淀加载中…" />
      ) : loadErr ? (
        <EmptyState variant="hero" icon="☁️">
          时间轴加载失败，请稍后重试
          <button className="btn slim" style={{ marginTop: 10 }} onClick={load}>重试</button>
        </EmptyState>
      ) : days.length === 0 ? (
        <EmptyState variant="hero" icon="🌱">当前时间范围内还没有任何沉淀 · 点右下角「⚡ 速记」写下第一条</EmptyState>
      ) : (
        <>
          <div className="view-slot" style={{ display: view === 'fish' ? '' : 'none' }}>
            <TimelineBubbles days={days} filter={filter} split={split} onMoved={load} active={view === 'fish'} />
          </div>
          {/* 3D 场景仅在可见时挂载（避免 display:none 下 canvas 初始化为 0×0） */}
          {view === 'uni' && (
            <div className="view-slot uni-slot">
              <TimelineUniverse3d days={days} filter={filter} avatar={avatar} onBack={() => setView('fish')} onOpenGame={() => { setView('fish'); setGameSignal(Date.now()) }} />
            </div>
          )}
        </>
      )}

      <QuickNoteModal avatar={avatar} onSaved={load} />

      {/* 升级特效：等级上涨时全屏 LEVEL UP */}
      {levelUp && <LevelUpOverlay level={hud.lv} />}

      {/* 今日讨伐：任务即怪物，打怪=完成任务（掉落与时间线同口径，击杀后刷新 HUD） */}
      <BattleCard onSlain={load} openSignal={gameSignal} />
    </>
  )
}