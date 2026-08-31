/**
 * 视图 A：云笺（气泡时间线，原鱼骨）
 * 需求（第 2 轮）：
 *  - 气泡悬浮即显详情（纯 CSS hover），点击常驻（pin）；Esc / 外部点击 / 滚动收起常驻
 *  - 每日「小结」默认隐藏文本，悬浮显示，点击常驻；无事件不显示；可一键改写
 *  - 每枚气泡带连接线接到中轴（tb-stem），时间日期清晰
 *  - 左右分区：按时间（默认，跨天交替）/ 按类型；>5 条折叠，展开后可收起（折叠按钮）
 *  - 保留拖动改期（notes/ledger/plan/checkin 真实落库）
 */
import { useEffect, useMemo, useRef, useState, useLayoutEffect, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api'
import { useToast } from '../framework/Toast'
import { timelineLayout, type TimelineLayout } from '../../lib/layout'
import { Icon } from '../framework/Icon'
import { EmptyState } from '../framework/EmptyState'
import { CAPSULE_THEMES, readTheme, listDayThemes, writeDayTheme, themeLabel, DAY_THEME_PREFIX } from '../../lib/componentTheme'
import { Capsule } from '../framework/Capsule'
import {
  SEG_LABEL, TL_COLOR, TL_DESC, TL_TYPES, dayLabel, daysAgo, filterNodes, segOf,
  type SegKey, type TimelineDay, type TimelineNode, type TimelineType,
} from './timeline'

export type SplitMode = 'time' | 'type'
const CELL_MAX = 5

const TYPE_SIDE: Record<TimelineType, 'L' | 'R'> = {
  journal: 'L', note: 'L', plan: 'R', checkin: 'R', ledger: 'R', goal: 'R',
}

const MOVABLE = new Set(['note:', 'ledger:', 'plan:', 'checkin:'])
const isMovable = (id: string) => [...MOVABLE].some((p) => id.startsWith(p))

function hashStr(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

function dailySummary(date: string, items: TimelineNode[], xp: number, overwrite?: string): string {
  if (overwrite) return overwrite
  const c = { plan: 0, checkin: 0, note: 0, ledger: 0, journal: 0, goal: 0 } as Record<TimelineType, number>
  for (const it of items) c[it.t]++
  const xpTx = xp > 0 ? ` 收获 +${xp} XP。` : ''
  const seeds = [
    () => {
      const parts: string[] = []
      if (c.plan) parts.push(`把 ${c.plan} 项计划落地`)
      if (c.checkin) parts.push(`坚持习惯打卡 ${c.checkin} 次`)
      if (c.note) parts.push(`记录下 ${c.note} 条灵感`)
      if (c.journal) parts.push(`产出 ${c.journal} 篇内容`)
      if (c.ledger) parts.push(`处理了 ${c.ledger} 笔收支`)
      if (c.goal) parts.push(`推进目标进度 ${c.goal} 项`)
      return `今日${parts.join('，')}，稳步向前。` + xpTx
    },
    () => {
      const done = c.plan + c.checkin + c.goal
      const quiet = c.note + c.journal
      if (done && quiet) return `完成 ${done} 件里程碑事项，同时留白记下 ${quiet} 条想法，张弛有度。` + xpTx
      if (done) return `一口气推进 ${done} 件重要事项，今天相当给力！` + xpTx
      return `安安静静记录了 ${quiet} 条想法，也是不错的一天。` + xpTx
    },
    () => {
      if (c.goal) return `目标又前进了一格（${c.goal} 项），长期主义看得见。` + xpTx
      if (c.checkin && c.plan) return `打卡 ${c.checkin} 次习惯、完成 ${c.plan} 项计划，节奏很稳。` + xpTx
      return `今天的每一件小事都值得被记录，辛苦啦。` + xpTx
    },
  ]
  return seeds[hashStr(date) % seeds.length]()
}

function parseMove(id: string, date: string) {
  const f = (rid: string) => ({ scope: '', id: rid, oldDate: date })
  if (id.startsWith('note:')) return { ...f(id.slice(5)), scope: 'notes' }
  if (id.startsWith('ledger:')) return { ...f(id.slice(7)), scope: 'ledger' }
  if (id.startsWith('plan:')) return { ...f(id.slice(5)), scope: 'plan' }
  if (id.startsWith('checkin:')) {
    const [cid, oldD] = id.slice(8).split(':')
    return { ...f(cid), scope: 'checkin', oldDate: oldD || date }
  }
  return null
}

export function TimelineBubbles({ days, filter, split, onMoved, active = true }: {
  days: TimelineDay[]
  filter: TimelineType | 'all'
  split: SplitMode
  onMoved?: () => void
  /** 是否可见（总览页切换视图时仍挂载但隐藏 → 悬浮日期定位需同步隐藏） */
  active?: boolean
}) {
  const toast = useToast()
  const [pinId, setPinId] = useState<string | null>(null)         // 常驻（点击）详情的气泡
  const [sumPins, setSumPins] = useState<Set<string>>(new Set())  // 常驻（点击）的小结
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [editDate, setEditDate] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [jumpDate, setJumpDate] = useState('')
  const [layout, setLayout] = useState<TimelineLayout>(timelineLayout)
  // 日期胶囊主题（组件主题系统：骨架不变 · 样式可切换）
  const [capsuleTheme, setCapsuleTheme] = useState(() => readTheme('capsule', CAPSULE_THEMES, 'glass'))
  // 日期独立主题：{ ymd: themeId }，未覆盖的日期跟随全局胶囊主题
  const [dayThemes, setDayThemes] = useState<Record<string, string>>(() => listDayThemes())
  // 当前展开「本日主题」拾色器的日期
  const [themePop, setThemePop] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const jumpRef = useRef<HTMLInputElement>(null)

  // 悬浮日期定位：随页面滚动常驻 + 可拖拽换位（点击/拖动通过位移阈值区分）
  const [jumpPos, setJumpPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = localStorage.getItem('cl_tl_jump_pos')
      if (saved) { const p = JSON.parse(saved); if (typeof p.x === 'number' && typeof p.y === 'number') return p }
    } catch { /* 忽略损坏缓存 */ }
    return null
  })
  const jumpPosRef = useRef(jumpPos)
  // 拖拽上下文：真实渲染位置（getBoundingClientRect）+ 按下点，保证拖动从“所见位置”出发，不会瞬移
  const dragRef = useRef<{ baseX: number; baseY: number; grabX: number; grabY: number } | null>(null)
  const jumpMovedRef = useRef(false)

  // 布局/主题偏好切换：设置页写入 localStorage 后即时生效；同 tab 内监听 storage 事件
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cl_tl_layout') setLayout(timelineLayout())
      if (e.key === 'cl_theme_capsule') setCapsuleTheme(readTheme('capsule', CAPSULE_THEMES, 'glass'))
      if (e.key?.startsWith(DAY_THEME_PREFIX)) setDayThemes(listDayThemes())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /** 日期快速定位：滚动到目标日期块并闪烁提示 */
  const jumpTo = (ymd: string) => {
    if (!ymd || !rootRef.current) return
    const el = rootRef.current.querySelector(`.tb-day[data-date="${ymd}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('jump-flash')
      setTimeout(() => el.classList.remove('jump-flash'), 1600)
    } else {
      toast(`时间线范围内没有 ${ymd} 的记录`)
    }
  }

  /** 一键呼出原生日期选择器（解决点击不灵敏，需多次点击的问题） */
  const openJumpPicker = () => {
    const el = jumpRef.current
    if (!el) return
    try { el.showPicker?.() } catch { el.focus() }
  }

  /** 悬浮日期定位 · 拖拽
   *  按下时读取胶囊真实渲染位置作为基准（而非可能过期的 state/缓存值），
   *  移动事件挂到 window 上跟踪：指针在胶囊外也能持续跟手，
   *  彻底避免「拖动时突然跳上跳下」的瞬移问题。位移 > 5px 判定为拖动，否则视为点击。 */
  const onJumpDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || dragRef.current) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    dragRef.current = { baseX: rect.left, baseY: rect.top, grabX: e.clientX, grabY: e.clientY }
    jumpMovedRef.current = false
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* 捕获失败不影响窗口级监听 */ }
  }
  const onJumpClick = () => {
    if (jumpMovedRef.current) return
    openJumpPicker()
  }

  useEffect(() => {
    const clampX = (x: number) => Math.min(Math.max(8, x), window.innerWidth - 176)
    const clampY = (y: number) => Math.min(Math.max(8, y), window.innerHeight - 48)
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.grabX, dy = e.clientY - d.grabY
      if (!jumpMovedRef.current && Math.hypot(dx, dy) > 5) jumpMovedRef.current = true
      if (!jumpMovedRef.current) return
      const pos = { x: clampX(d.baseX + dx), y: clampY(d.baseY + dy) }
      jumpPosRef.current = pos
      setJumpPos(pos)
    }
    const onUp = () => {
      if (dragRef.current) {
        if (jumpMovedRef.current && jumpPosRef.current) {
          localStorage.setItem('cl_tl_jump_pos', JSON.stringify(jumpPosRef.current))
        }
        dragRef.current = null
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const toggleExpand = (date: string) => setExpanded((p) => { const s = new Set(p); s.has(date) ? s.delete(date) : s.add(date); return s })
  const toggleSumPin = (date: string) => setSumPins((p) => { const s = new Set(p); s.has(date) ? s.delete(date) : s.add(date); return s })

  /** 为某日期设置独立主题（null = 恢复跟随全局），并同步 localStorage */
  const applyDayTheme = (ymd: string, id: string | null) => {
    writeDayTheme(ymd, id)
    setDayThemes((p) => {
      const next = { ...p }
      if (id && CAPSULE_THEMES.some((x) => x.id === id)) next[ymd] = id
      else delete next[ymd]
      return next
    })
    setThemePop(null)
    toast(id ? `本日主题：${themeLabel(id)}` : '本日恢复跟随全局主题')
  }

  // 本日主题拾色器：外部点击 / Esc / 滚动关闭
  useEffect(() => {
    if (!themePop) return
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setThemePop(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setThemePop(null) }
    const onScroll = () => setThemePop(null)
    document.addEventListener('mousedown', close)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [themePop])

  const streakDates = useMemo(() => {
    const withCheckin = [...new Set(days.filter((d) => d.items.some((i) => i.t === 'checkin')).map((d) => d.date))].sort()
    const out = new Set<string>()
    let start = 0
    const diff = (a: string, b: string) => daysAgo(b) - daysAgo(a)
    for (let i = 1; i <= withCheckin.length; i++) {
      const cont = i < withCheckin.length && diff(withCheckin[i], withCheckin[i - 1]) === 1
      if (!cont) {
        if (i - start >= 3) for (let k = start; k < i; k++) out.add(withCheckin[k])
        start = i
      }
    }
    return out
  }, [days])

  const groups = useMemo(() => {
    const out: { key: SegKey; days: TimelineDay[] }[] = []
    let key: SegKey | null = null
    for (const d of days) {
      const k = segOf(d.date)
      if (k !== key) { out.push({ key: k, days: [] }); key = k }
      out[out.length - 1].days.push(d)
    }
    return out
  }, [days])

  /** 关闭所有常驻（详情 / 小结） */
  const clearPins = () => { setPinId(null); setSumPins(new Set()) }

  useEffect(() => {
    if (!pinId && sumPins.size === 0) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) clearPins()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearPins() }
    const onScroll = () => clearPins()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [pinId, sumPins])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = root.querySelectorAll<HTMLElement>('.tb-row')
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('in')
          io.unobserve(en.target)
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [days, filter, split, expanded, sumPins])

  async function moveNode(ev: DragEvent<HTMLDivElement>, targetDate: string) {
    const raw = ev.dataTransfer.getData('text/plain')
    if (!raw) return
    let data: { id: string; date: string }
    try { data = JSON.parse(raw) } catch { return }
    const p = parseMove(data.id, data.date)
    if (!p || !p.id) return
    if (p.oldDate === targetDate) { toast('目标与当前是同一日期'); return }
    try {
      if (p.scope === 'notes') await api.put(`/workbench/notes/${p.id}`, { date: targetDate })
      else if (p.scope === 'ledger') await api.put(`/workbench/ledger/${p.id}`, { date: targetDate })
      else if (p.scope === 'plan') await api.put(`/workbench/plan/${p.id}`, { doneAt: `${targetDate}T00:00:00.000Z` })
      else if (p.scope === 'checkin') {
        const list = await api.get<{ items: { id: string; log: string }[] }>('/workbench/checkin')
        const c = list.items.find((x) => x.id === p.id)
        if (!c) { toast('找不到该习惯记录', 'err'); return }
        const log = JSON.parse(c.log || '{}') as Record<string, boolean>
        delete log[p.oldDate]; log[targetDate] = true
        await api.put(`/workbench/checkin/${p.id}`, { log })
      }
      toast(`已移动到 ${targetDate}`)
      onMoved?.()
    } catch (e: any) {
      toast(e?.message || '移动失败', 'err')
    }
  }

  const saveSummary = (date: string) => {
    const v = editText.trim()
    if (v) localStorage.setItem(`cl_summ_${date}`, v)
    else localStorage.removeItem(`cl_summ_${date}`)
    setEditDate(null)
    toast(v ? '今日小结已改写' : '已恢复自动生成的今日小结')
  }

  /** 全局奇偶游标（按时间分区）：跨天连续计步 → 左右对称 */
  let parity = 0

  const body = groups.map((g) => {
    const rows = g.days.map((day) => {
      const items = filterNodes(day.items, filter)
      if (!items.length) return null
      const dateKey = day.date
      const summed = dailySummary(dateKey, day.items, day.xp, localStorage.getItem(`cl_summ_${dateKey}`) || undefined)
      const dl = dayLabel(dateKey)
      const isStreak = streakDates.has(dateKey)
      const folded = items.length > CELL_MAX && !expanded.has(dateKey)
      const show = folded ? items.slice(0, CELL_MAX) : items
      const sumPinned = sumPins.has(dateKey)

      const bubbleEl = (it: TimelineNode, i: number) => (
        <div
          className={`tb-row ${layout === 'list' ? 'L' : split === 'type' ? TYPE_SIDE[it.t] : parity++ % 2 === 0 ? 'L' : 'R'}`}
          key={it.id}
          style={{ transitionDelay: `${(i % CELL_MAX) * 70}ms` }}
        >
          <div
            className={`tb-bubble t-${it.t}${pinId === it.id ? ' pinned' : ''}${isMovable(it.id) ? ' movable' : ''}`}
            data-t={it.t}
            style={{ ['--abg' as string]: TL_COLOR[it.t] }}
            draggable={isMovable(it.id)}
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', JSON.stringify({ id: it.id, date: dateKey }))
              e.dataTransfer.effectAllowed = 'move'
              e.currentTarget.classList.add('dragging')
            }}
            onDragEnd={(e) => e.currentTarget.classList.remove('dragging')}
            onClick={(e) => { e.stopPropagation(); setPinId((cur) => (cur === it.id ? null : it.id)) }}
            title={isMovable(it.id) ? '悬浮看详情 · 点击常驻 · 按住拖动到其他日期' : '悬浮看详情 · 点击常驻'}
          >
            <span className="tb-dot" />
            <span className="tb-title">{it.title}</span>
            {it.xp ? <span className="tb-xp">+{it.xp} XP</span> : it.gold ? <span className="tb-xp gold">+{it.gold} 金币</span> : null}
            {isMovable(it.id) && <span className="tb-grip">⋮⋮</span>}
            <span className="tb-detail">
              <span className="td-title">{it.title}</span>
              <span className="td-sub">{it.sub || TL_DESC[it.t]}</span>
              <span className="mt">{TL_TYPES.find(([k]) => k === it.t)?.[1]} · {TL_DESC[it.t]}<span className="dot-sep" />{dayLabel(dateKey).d}{it.tags?.length ? <span className="cat">#{it.tags.join(' #')}</span> : null}</span>
            </span>
          </div>
          {/* 连接线：接到中轴（L 靠中轴在右，R 靠中轴在左） */}
          <span className="tb-stem" aria-hidden="true" />
        </div>
      )

      const dayEl = (
        <div
          className={`tb-day${dragOver === dateKey ? ' drop' : ''}${themePop === dateKey ? ' theme-open' : ''}`}
          key={dateKey}
          data-date={dateKey}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOver !== dateKey) setDragOver(dateKey) }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver((d) => (d === dateKey ? null : d)) }}
          onDrop={(e) => { e.preventDefault(); setDragOver(null); moveNode(e, dateKey) }}
        >
          {/* 当日小结：默认只显示日期，悬浮/点击展开一句话总结；data-theme 决定本日胶囊主题 */}
          <div className={`tb-summary${isStreak ? ' streak' : ''}${sumPinned ? ' pinned' : ''}${themePop === dateKey ? ' theme-open' : ''}`} data-theme={dayThemes[dateKey] ?? capsuleTheme}>
            <div
              className="tb-sum-date"
              onClick={(e) => { e.stopPropagation(); toggleSumPin(dateKey) }}
              title="悬浮看小结 · 点击常驻"
            >
              <span className="tb-sum-dot" />
              <b>{dl.d}</b>
              <em>{dl.f || dateKey.slice(5).replace('-', '.')}</em>
              {isStreak && <span className="tb-streak-tag">🔥 连续</span>}
              {sumPinned && <span className="tb-pin-tag">已常驻</span>}
              {/* 本日独立主题按钮 */}
              <button
                className="tb-sum-theme"
                title="设置本日独立主题"
                aria-label="设置本日独立主题"
                onClick={(e) => { e.stopPropagation(); setThemePop((cur) => (cur === dateKey ? null : dateKey)) }}
              >
                <Icon name="palette" size={13} />
              </button>
              <button
                className="tb-sum-edit"
                title="改写今日小结"
                aria-label="改写今日小结"
                onClick={(e) => { e.stopPropagation(); setEditText(summed); setEditDate(dateKey) }}
              >
                <IconPen />
              </button>
            </div>
            {/* 本日主题拾色器 */}
            {themePop === dateKey && (
              <div className="tb-sum-theme-pop">
                <div className="tb-ttp-grid">
                  {CAPSULE_THEMES.map((t) => {
                    const active = (dayThemes[dateKey] ?? capsuleTheme) === t.id
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={`tb-ttp-btn${active ? ' on' : ''}`}
                        onClick={(e) => { e.stopPropagation(); applyDayTheme(dateKey, active ? null : t.id) }}
                        title={t.label}
                      >
                        <span className="tb-ttp-swatch" style={{ background: t.swatch }} />
                        <span className="tb-ttp-label">{t.label}</span>
                      </button>
                    )
                  })}
                </div>
                {dayThemes[dateKey] && (
                  <button
                    className="tb-ttp-reset"
                    type="button"
                    onClick={(e) => { e.stopPropagation(); applyDayTheme(dateKey, null) }}
                  >
                    恢复跟随全局
                  </button>
                )}
              </div>
            )}
            {editDate === dateKey ? (
              <div className="tb-sum-edit-row">
                <input
                  type="text" value={editText} autoFocus maxLength={80}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveSummary(dateKey); if (e.key === 'Escape') setEditDate(null) }}
                  onBlur={() => saveSummary(dateKey)}
                />
                <button className="btn slim" onMouseDown={(e) => { e.preventDefault(); saveSummary(dateKey) }}>保存</button>
              </div>
            ) : (
              <p className="tb-sum-tx">
                <span className="tb-sum-s">{summed}</span>
                {day.xp > 0 && <b className="tb-sum-xp">+{day.xp} XP</b>}
                <span className="tb-open-all" onClick={(e) => { e.stopPropagation(); toggleExpand(dateKey) }}>
                  {folded ? `展开当日 ${items.length} 条 ↓` : items.length > CELL_MAX ? '收起 ↑' : ''}
                </span>
              </p>
            )}
          </div>

          <div className={`tb-bubbles${isStreak ? ' is-streak' : ''}`}>
            {show.map(bubbleEl)}
            {/* 折叠 / 展开按钮：挂在日期汇总处，显式可收 */}
            {items.length > CELL_MAX && (
              <div className={`tb-row ${layout === 'list' ? 'L' : split === 'type' ? 'R' : parity++ % 2 === 0 ? 'L' : 'R'}`}>
                <button className="tb-more" type="button" onClick={() => toggleExpand(dateKey)}>
                  {folded ? `☰ 当日 ${items.length} 条 · 展开全部` : '▲ 收起全部'}
                </button>
                <span className="tb-stem" aria-hidden="true" />
              </div>
            )}
          </div>
        </div>
      )
      return dayEl
    })
    if (!rows.some(Boolean)) return null
    return (
      <div className="tb-seg" key={g.key}>
        <div className="tb-seg-label">{SEG_LABEL[g.key]}</div>
        {rows}
      </div>
    )
  })
  const hasBody = body.some(Boolean)

  if (!hasBody) {
    return (
      <EmptyState variant="hero" icon="🌊">当前筛选下暂无记录 · 点右下角「⚡ 速记」写下第一条</EmptyState>
    )
  }
  return (
    <div className="tb" ref={rootRef} data-style={layout}>
      {layout === 'river' ? <RiverSpine /> : layout === 'axis' ? <div className="tb-spine" aria-hidden="true" /> : null}
      {/* 悬浮日期定位：随页面滚动常驻（portal 到 body），可拖拽换位；非可见时隐藏 */}
      {active && createPortal(
        <>
          <Capsule
            className="tb-jump"
            theme={capsuleTheme}
            icon="cal"
            value={jumpDate || '选择日期'}
            extra={<span className="cap-grip">⠿</span>}
            title="拖拽可移动位置 · 点击打开日期选择"
            style={jumpPos ? { left: jumpPos.x, top: jumpPos.y, right: 'auto' } : undefined}
            onClick={onJumpClick}
            onPointerDown={onJumpDown}
          />
          <input
            ref={jumpRef}
            className="tb-jump-native"
            type="date"
            value={jumpDate}
            onChange={(e) => { setJumpDate(e.target.value); jumpTo(e.target.value) }}
            aria-label="跳转到日期"
            tabIndex={-1}
          />
        </>,
        document.body,
      )}
      {body}
    </div>
  )
}

function IconPen() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  )
}

/* ============================================================
   时光长河：蜿蜒河流 + 小人物一直向上行走（不屈的精神）
   ============================================================ */

/** 生成自下而上的蜿蜒河道路径：
 *  弯弯曲曲，但轴心始终垂直居中——首尾收在中轴（sin(πt) 包络归零），
 *  摆动由对称的主波 + 次波叠加（左右摆动量正负相抵，整体不歪） */
function buildRiverPath(w: number, h: number): string {
  if (w <= 0 || h <= 0) return ''
  const amp = Math.min(72, Math.max(34, w * 0.08))
  const steps = Math.max(48, Math.floor(h / 24))
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const y = h - h * t
    // 包络：首尾归中；蜿蜒：主波（2 整周期）+ 次波（细节弯曲），左右对称
    const envelope = Math.sin(t * Math.PI)
    const meander = Math.sin(t * Math.PI * 4) * 0.74 + Math.sin(t * Math.PI * 9 + 0.6) * 0.26
    const x = w / 2 + amp * envelope * meander
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return pts.join(' ')
}

function RiverSpine() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const reduced = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false,
    [],
  )
  const d = useMemo(() => buildRiverPath(size.w, size.h), [size])
  // 行走速度 ≈ 26px/s：河越长走得越久，始终「一直往上」
  const dur = size.h > 0 ? Math.max(14, Math.round(size.h / 26)) : 20

  return (
    <div className="river-spine" ref={ref} aria-hidden="true">
      {size.w > 0 && size.h > 0 && d && (
        <svg className="river-svg" width={size.w} height={size.h}>
          <defs>
            <linearGradient id="riverBandGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#5ab2ff" stopOpacity="0.06" />
              <stop offset="55%" stopColor="#5ab2ff" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#8ec9ff" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="riverStreamGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#5ab2ff" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#8ec9ff" stopOpacity="0.75" />
            </linearGradient>
          </defs>
          {/* 河面（宽 · 半透明） */}
          <path d={d} stroke="url(#riverBandGrad)" strokeWidth={30} fill="none" strokeLinecap="round" />
          {/* 水流（细 · 流动波光） */}
          <path d={d} stroke="url(#riverStreamGrad)" strokeWidth={3.5} fill="none" strokeLinecap="round"
            className={reduced ? '' : 'river-stream'} />
          {/* 小人物：沿河一直向上行走 */}
          <g className={reduced ? '' : 'river-walker'}>
            <text fontSize={19} textAnchor="middle" dominantBaseline="middle">🚶</text>
            {!reduced && (
              <animateMotion dur={`${dur}s`} repeatCount="indefinite" rotate="0" calcMode="linear">
                <mpath href="#river-path" />
              </animateMotion>
            )}
          </g>
          {/* 路径本体（供 mpath 引用；不可见） */}
          <path id="river-path" d={d} fill="none" stroke="none" />
        </svg>
      )}
    </div>
  )
}
