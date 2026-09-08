import { errMsg } from '../../lib/errors'
/**
 * 今日讨伐卡（游戏化 · 任务融合）：把未完成计划映射成怪物（P0=首领 / P1=精英怪 / P2=小怪）。
 * 打怪 = 完成任务（POST /battle/attack 真实落库），掉落 XP/金币与时间线同口径。
 *
 * 悬浮窗交互（修复「一点击就下拉到页面底部」）：
 *  - 由「今日讨伐·游戏」入口触发 → 以「浮动窗」弹出，窗口右下角区域浮层。
 *  - 浮动模式：鼠标移出窗口 / 点击窗口外 → 自动收起；窗口可拖拽移动。
 *  - 点「进入游戏」→ 固定窗口（钉住），除非主动点 × 关闭，否则一直保留。
 *  - 关闭后保留左下角小气泡作为常驻入口。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { todayYMD } from '../../lib/date'
import { celebrate, praise } from '../../lib/celebrate'
import { useToast } from '../framework/Toast'

interface Monster {
  id: string
  name: string
  tier: 'P0' | 'P1' | 'P2'
  tierLabel: string
  emoji: string
  hp: number
  xp: number
  gold: number
  dueDate: string
  crisis: boolean
}

const WIN_W = 340

function defaultPos(): { x: number; y: number } {
  try {
    const saved = localStorage.getItem('cl_battle_pos')
    if (saved) {
      const p = JSON.parse(saved)
      if (typeof p.x === 'number' && typeof p.y === 'number') return p
    }
  } catch { /* 忽略损坏缓存 */ }
  const w = typeof window !== 'undefined' ? window.innerWidth : 1440
  const h = typeof window !== 'undefined' ? window.innerHeight : 900
  return { x: Math.max(16, w - WIN_W - 28), y: Math.max(64, Math.round(h * 0.18)) }
}

export function BattleCard({ onSlain, openSignal }: { onSlain?: () => void; /** 打开信号（时间戳）：变化时以浮动模式弹出 */ openSignal?: number }) {
  const nav = useNavigate()
  const toast = useToast()
  const [monsters, setMonsters] = useState<Monster[] | null>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pos, setPos] = useState(defaultPos)
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(pos)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const leaveTimer = useRef<number | null>(null)

  const load = useCallback(() => {
    api.get<{ monsters: Monster[] }>('/battle/today')
      .then((r) => setMonsters(r.monsters))
      .catch(() => setMonsters([]))
  }, [])
  useEffect(load, [load])

  // 游戏入口信号：浮动模式弹出（不滚动页面）
  useEffect(() => {
    if (!openSignal) return
    setOpen(true)
    setPinned(false)
  }, [openSignal])

  // 浮动模式：点击窗口外部自动收起（固定模式除外）
  useEffect(() => {
    if (!open || pinned) return
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current
      const t = e.target as HTMLElement | null
      if (root && t && !root.contains(t) && !t.closest?.('.game-entry')) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, pinned])

  // 浮动模式：鼠标移出窗口（缓冲 400ms）自动收起
  const clearLeave = () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null } }
  const onLeave = () => {
    if (pinned) return
    clearLeave()
    leaveTimer.current = window.setTimeout(() => setOpen(false), 400)
  }
  useEffect(() => clearLeave, [])

  // 窗口拖拽（标题栏），拖完持久化位置
  const onHeaderDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.target instanceof HTMLButtonElement) return
    dragRef.current = { dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y }
    setDragging(true)
  }
  useEffect(() => {
    if (!dragging) return
    const move = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const x = Math.min(Math.max(8, ev.clientX - d.dx), window.innerWidth - WIN_W - 8)
      const y = Math.min(Math.max(8, ev.clientY - d.dy), window.innerHeight - 48)
      posRef.current = { x, y }
      setPos({ x, y })
    }
    const up = () => {
      setDragging(false)
      dragRef.current = null
      localStorage.setItem('cl_battle_pos', JSON.stringify(posRef.current))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
    }
  }, [dragging])

  const attack = async (m: Monster) => {
    setBusyId(m.id)
    try {
      const r = await api.post<{ slain: { name: string }; drop: { xp: number; gold: number } }>('/battle/attack', { planId: m.id })
      celebrate(window.innerWidth / 2, window.innerHeight / 2, 30)
      toast(`⚔️ 击败「${r.slain.name}」！掉落 +${r.drop.xp} XP · +${r.drop.gold} 金币 · ${praise()}`)
      setMonsters((list) => (list ?? []).filter((x) => x.id !== m.id))
      onSlain?.()
    } catch (e: unknown) {
      toast(errMsg(e, '攻击失败'), 'err')
      load()
    } finally {
      setBusyId(null)
    }
  }

  // 数据未到或没有怪物：收起为一个小气泡（不占版面）
  if (monsters === null || monsters.length === 0) {
    return (
      <button className="battle-bubble" title="游戏·讨伐：待办任务即怪物，去计划页创建后即可挑战" onClick={() => nav('/goals-home?tab=plan')}>
        🛡️ 讨伐场空空 · 去创建任务刷怪
      </button>
    )
  }

  const crisis = monsters.filter((m) => m.crisis).length
  const today = todayYMD()
  const dueLabel = (m: Monster): string => {
    if (!m.dueDate) return ''
    if (m.dueDate < today) return '已逾期'
    if (m.dueDate === today) return '今日到期'
    return m.dueDate
  }

  // 未打开：左下角小气泡常驻入口
  if (!open) {
    return (
      <button className="battle-bubble fight" onClick={() => { setOpen(true); setPinned(false) }} title="展开今日讨伐列表（悬浮窗）">
        ⚔️ 讨伐 <b>{monsters.length}</b>
        {crisis > 0 && <i className="battle-alert" />}
      </button>
    )
  }

  return createPortal(
    <div
      ref={rootRef}
      className={`battle-window${pinned ? ' pinned' : ''}`}
      style={{ left: pos.x, top: pos.y, width: WIN_W }}
      onPointerEnter={clearLeave}
      onPointerLeave={onLeave}
    >
      <div className="battle-head" onPointerDown={onHeaderDown} title={pinned ? '已固定 · 拖动可移动位置' : '浮动窗 · 拖动可移动位置'}>
        <span className="battle-grip" aria-hidden="true">⠿</span>
        <b>⚔️ 今日讨伐 · 冒险</b>
        <span className="dim">{monsters.length} 只存活{crisis > 0 ? ` · ${crisis} 只危机` : ''}</span>
        <button
          className={`battle-pin${pinned ? ' on' : ''}`}
          title={pinned ? '已固定：不会自动收起 · 点击回到浮动模式' : '进入游戏：固定窗口，不自动收起'}
          onClick={() => setPinned((p) => !p)}
        >
          {pinned ? '📌 已固定' : '📌 进入游戏'}
        </button>
        <button className="battle-fold" title="关闭窗口" onClick={() => setOpen(false)}>×</button>
      </div>
      <div className="battle-list">
        {monsters.slice(0, 8).map((m) => (
          <div key={m.id} className={`battle-mon${m.crisis ? ' crisis' : ''}`}>
            <span className="bm-emoji">{m.emoji}</span>
            <span className="bm-tx">
              <b>{m.name}</b>
              <em>{m.tierLabel} · +{m.xp} XP · +{m.gold} 金币{dueLabel(m) ? ` · ${dueLabel(m)}` : ''}</em>
            </span>
            <button className="btn slim warn" disabled={busyId === m.id} onClick={() => attack(m)}>
              {busyId === m.id ? '…' : '攻击'}
            </button>
          </div>
        ))}
        {monsters.length > 8 && (
          <button className="battle-more" onClick={() => nav('/goals-home?tab=plan')}>还有 {monsters.length - 8} 只 · 去计划页查看</button>
        )}
      </div>
      <div className="battle-foot dim">
        {pinned ? '已固定：点 × 关闭' : '浮动模式：移出窗口或点击外部自动收起 · 点「进入游戏」固定'} · 击杀即完成任务
      </div>
    </div>,
    document.body,
  )
}
