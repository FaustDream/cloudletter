/**
 * 日常（目标之外的第二入口）：番茄专注 + 今日回顾。
 * - 番茄专注：计时引擎使用成熟开源方案 react-timer-hook（截止时间戳驱动，无手写 setInterval），
 *   工作/短休息/长休息完整循环，时长与自动衔接等全部可在设置·偏好 → 番茄专注中配置
 * - 番茄完成 → 自动写入一条灵感笔记（mood=习惯）→ 时间线与习惯映射直接可见
 * - 今日回顾 → 聚合今天的时间线/计划/记账数据，支持自动生成草稿与多种模板；
 *   已保存回顾可直接回显、随时改写（mood=日志）→ 时间线可见
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTimer } from 'react-timer-hook'
import { api, type NoteItem, type TimelineDay, type WorkTask } from '../api'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { WorkTimeBanner } from '../components/framework/WorkTimeBanner'
import { todayYMD } from '../lib/date'
import { fetchSchedule, isWorkTime, type Schedule } from '../lib/schedule'
import { celebrate, praise } from '../lib/celebrate'
import { readPomodoroPrefs, playChime, type PomodoroPrefs } from '../lib/pomodoro'
import { readLayoutTheme, DAILY_CARD_THEMES, POMODORO_THEMES } from '../lib/componentTheme'
import { Icon } from '../components/framework/Icon'

type Phase = 'focus' | 'short' | 'long'

/** 今日回顾模板（可选引导） */
const REVIEW_TEMPLATES: { id: string; label: string; body: string }[] = [
  { id: 'steps', label: '复盘三步', body: '事实：\n感受：\n下一步：' },
  { id: 'gratitude', label: '三件好事', body: '今天值得感恩的三件小事：\n1.\n2.\n3.' },
  { id: 'anchor', label: '明日锚点', body: '明天最重要的一件事：\n时间块规划：' },
]

export function DailyPage() {
  const toast = useToast()
  const today = todayYMD()

  /* ── 偏好（设置·偏好 → 番茄专注 / 组件布局风格 写入） ── */
  const [cfg, setCfg] = useState<PomodoroPrefs>(readPomodoroPrefs)
  const [dailyCard, setDailyCard] = useState(() => readLayoutTheme('dailyCard', DAILY_CARD_THEMES, 'default'))
  const [pomoTheme, setPomoTheme] = useState(() => readLayoutTheme('pomodoro', POMODORO_THEMES, 'blue'))
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key?.startsWith('cl_pomodoro_')) setCfg(readPomodoroPrefs())
      if (e.key === 'cl_theme_layout_dailyCard') setDailyCard(readLayoutTheme('dailyCard', DAILY_CARD_THEMES, 'default'))
      if (e.key === 'cl_theme_layout_pomodoro') setPomoTheme(readLayoutTheme('pomodoro', POMODORO_THEMES, 'blue'))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  /* ── 番茄专注（引擎：react-timer-hook） ── */
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [phase, setPhase] = useState<Phase>('focus')
  const [cycle, setCycle] = useState(0) // 本会话已完成的专注轮数

  /* ── 工作时段与今日工作计划（工作时间优先展示） ── */
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [workTasks, setWorkTasks] = useState<WorkTask[]>([])
  const nowTick = useMemo(() => new Date(), []) // 进入页面时判定一次即可（横幅组件内部自行续跳）
  const working = schedule ? isWorkTime(nowTick, schedule).working : false
  const todayWorkTasks = useMemo(
    () => workTasks
      .filter((t) => t.date === today)
      .sort((a, b) => (a.done === b.done ? a.createdAt.localeCompare(b.createdAt) : a.done ? 1 : -1)),
    [workTasks, today],
  )

  const loadWork = useCallback(() => {
    fetchSchedule().then(setSchedule).catch(() => {})
    api.get<{ items: WorkTask[] }>('/workbench/worktask')
      .then((r) => setWorkTasks(r.items.filter((t) => t.date === today)))
      .catch(() => {})
  }, [today])
  useEffect(loadWork, [loadWork])

  const toggleWorkTask = async (t: WorkTask) => {
    try {
      const now = !t.done
      await api.put(`/workbench/worktask/${t.id}`, { done: now, doneAt: now ? new Date().toISOString() : '' })
      if (now) {
        celebrate(window.innerWidth / 2, window.innerHeight / 2, 26)
        toast(`✅ 完成工作计划「${t.text}」· ${praise()}`)
      }
      loadWork()
    } catch (e: any) { toast(e?.message || '操作失败', 'err') }
  }

  const loadNotes = useCallback(() => {
    api.get<{ items: NoteItem[] }>('/workbench/notes').then((r) => setNotes(r.items)).catch(() => {})
  }, [])
  useEffect(loadNotes, [loadNotes])

  const todayTomatoes = useMemo(
    () => notes.filter((n) => n.title.startsWith('🍅') && (n.date || '').slice(0, 10) === today).length,
    [notes, today],
  )
  // 今日累计专注分钟（从已写入时间线的番茄记录解析）
  const todayMin = useMemo(() => {
    let m = 0
    for (const n of notes) {
      if ((n.date || '').slice(0, 10) === today && n.title.startsWith('🍅')) {
        const mm = Number(n.title.match(/(\d+)\s*分钟/)?.[1])
        if (mm) m += mm
      }
    }
    return m
  }, [notes, today])
  // 本周番茄数（周一为一周起点）
  const weekTomatoes = useMemo(() => {
    const now = new Date()
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
    const start = monday.toISOString().slice(0, 10)
    return notes.filter((n) => n.title.startsWith('🍅') && String(n.date).slice(0, 10) >= start).length
  }, [notes])
  const dailyGoal = cfg.dailyGoal
  const goalPct = dailyGoal > 0 ? Math.min(100, Math.round((todayTomatoes / dailyGoal) * 100)) : 0

  // onExpire 在 hook 初始化时被捕获 → 用 ref 取最新状态，避免过期闭包
  const goRef = useRef({ phase, cycle, cfg })
  useEffect(() => { goRef.current = { phase, cycle, cfg } })

  const userIdleExpiry = useRef(new Date(Date.now() + cfg.focus * 60 * 1000))
  const onExpireRef = useRef<() => void>(() => {})
  const timer = useTimer({
    expiryTimestamp: userIdleExpiry.current,
    autoStart: false,
    onExpire: () => onExpireRef.current(),
  })

  const startFocus = useCallback(() => {
    const d = new Date(); d.setSeconds(d.getSeconds() + goRef.current.cfg.focus * 60)
    setPhase('focus')
    timer.restart(d, true)
  }, [timer])

  const startBreak = useCallback((kind: 'short' | 'long') => {
    const mins = kind === 'long' ? goRef.current.cfg.long : goRef.current.cfg.short
    const d = new Date(); d.setSeconds(d.getSeconds() + mins * 60)
    setPhase(kind)
    timer.restart(d, true)
  }, [timer])

  const resetFocus = useCallback(() => {
    const d = new Date(); d.setSeconds(d.getSeconds() + goRef.current.cfg.focus * 60)
    setPhase('focus')
    timer.restart(d, false)
  }, [timer])

  const recordFocus = useCallback(async (auto: boolean) => {
    try {
      await api.post('/workbench/notes', {
        title: `🍅 专注 ${goRef.current.cfg.focus} 分钟`,
        body: `${todayYMD()} 完成一轮 ${goRef.current.cfg.focus} 分钟专注（${auto ? '计时结束' : '手动收尾'}）`,
        mood: '习惯',
        date: todayYMD(),
      })
      loadNotes()
      toast(`🍅 专注完成，已记入时间线 · ${praise()}`)
    } catch (e: any) { toast(e?.message || '记录失败', 'err') }
  }, [loadNotes, toast])

  /** 完成当前专注轮：记录 + 庆祝 + 自动进入休息（或停止等待） */
  const completeFocus = useCallback(async (auto: boolean) => {
    const { cycle: c, cfg: g } = goRef.current
    const n = c + 1
    setCycle(n)
    celebrate(window.innerWidth / 2, window.innerHeight / 3, 26)
    if (g.sound) playChime()
    await recordFocus(auto)
    const isLong = n % g.every === 0
    if (g.auto) startBreak(isLong ? 'long' : 'short')
    else resetFocus()
  }, [recordFocus, startBreak, resetFocus])

  // 计时结束：专注→记录并接休息；休息→自动接专注
  useEffect(() => {
    onExpireRef.current = () => {
      const { phase: p, cfg: g } = goRef.current
      if (p === 'focus') {
        void completeFocus(true)
      } else {
        startFocus()
        if (g.sound) playChime()
      }
    }
  }, [completeFocus, startFocus])

  const totalSecs = phase === 'focus' ? cfg.focus * 60 : (phase === 'long' ? cfg.long : cfg.short) * 60
  const left = Math.max(0, timer.minutes * 60 + timer.seconds)
  const pct = totalSecs > 0 ? 1 - left / totalSecs : 0
  const mm = String(timer.minutes).padStart(2, '0')
  const ss = String(timer.seconds).padStart(2, '0')
  const isPaused = !timer.isRunning && left > 0 && left < totalSecs - 1

  const phaseLabel = phase === 'focus' ? (timer.isRunning ? '专注中…' : isPaused ? '已暂停' : '待开始')
    : phase === 'short' ? (timer.isRunning ? '短休息中…' : isPaused ? '已暂停' : '休息准备')
    : (timer.isRunning ? '长休息中…' : isPaused ? '已暂停' : '休息准备')

  /* ── 今日回顾 ── */
  const [todayData, setTodayData] = useState<TimelineDay | null>(null)
  const [review, setReview] = useState('')
  const [saved, setSaved] = useState(false)
  const [savedBody, setSavedBody] = useState('')

  useEffect(() => {
    api.get<{ days: TimelineDay[] }>('/workbench/timeline?limit=1')
      .then((r) => setTodayData(r.days[0] ?? null))
      .catch(() => {})
    // 已写过今日回顾？回显保存内容
    api.get<{ items: NoteItem[] }>('/workbench/notes')
      .then((r) => {
        const item = r.items.find((n) => (n.date || '').slice(0, 10) === today && n.mood === '日志' && n.title.startsWith('今日回顾'))
        if (item) { setSaved(true); setSavedBody(item.body || '') }
      })
      .catch(() => {})
  }, [today])

  const counts = useMemo(() => {
    const c = { 计划: 0, 习惯: 0, 灵感: 0, 记账: 0, 目标: 0, 日志: 0 } as Record<string, number>
    for (const it of todayData?.items ?? []) c[it.t === 'journal' ? '日志' : it.t === 'note' ? '灵感' : it.t === 'plan' ? '计划' : it.t === 'checkin' ? '习惯' : it.t === 'ledger' ? '记账' : '目标']++
    return c
  }, [todayData])

  const genDraft = () => {
    const parts: string[] = []
    if (counts.计划) parts.push(`推进 ${counts.计划} 项计划`)
    if (counts.习惯) parts.push(`坚持习惯打卡 ${counts.习惯} 次`)
    if (counts.灵感) parts.push(`记录 ${counts.灵感} 条灵感`)
    if (counts.记账) parts.push(`处理 ${counts.记账} 笔收支`)
    if (counts.日志) parts.push(`撰写 ${counts.日志} 篇内容`)
    if (counts.目标) parts.push(`推进 ${counts.目标} 项目标`)
    const head = parts.length ? `今天${parts.join('、')}，稳步向前。` : '今天还没有太多动静。'
    setReview(`${head}\n\n三件值得记录的小事：\n1.\n2.\n3.\n\n明天最重要的一件事：`)
    setSaved(false)
    toast('已按今日数据生成草稿，可继续修改')
  }

  const saveReview = async (body: string) => {
    const b = body.trim()
    if (!b) { toast('先写点什么再保存', 'err'); return }
    try {
      await api.post('/workbench/notes', {
        title: `今日回顾 · ${today}`,
        body: b,
        mood: '日志',
        date: today,
      })
      setSavedBody(b)
      setReview('')
      setSaved(true)
      celebrate(window.innerWidth / 2, window.innerHeight / 2, 22)
      toast('今日回顾已写入，可在时间线查看')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }

  return (
    <div className="daily-page">
      <PageHeader
        title="日常"
        subtitle="专注一轮、写下回顾 —— 沉淀自动进入时间线，与计划/习惯/记账同源联动"
        actions={<span className="dim">今天 · {today}</span>}
      />

      {/* 工作时间 / 个人时间横幅：按设置自动判定 */}
      {schedule && <WorkTimeBanner schedule={schedule} />}

      <div className="daily-grid" data-daily={dailyCard}>
        {/* 工作时间优先展示今日工作计划（个人时间则不置顶，不打扰休息） */}
        {working && todayWorkTasks.length > 0 && (
          <div className="card daily-workplan">
            <div className="focus-side-head">
              <div className="sec-title">💼 今日工作计划</div>
              <span className="focus-phase focus">{todayWorkTasks.filter((t) => t.done).length} / {todayWorkTasks.length} 完成</span>
            </div>
            <div className="wp-tasks" style={{ marginTop: 10 }}>
              {todayWorkTasks.map((t) => (
                <div key={t.id} className={`wp-task ${t.done ? 'done' : ''}`} onClick={() => toggleWorkTask(t)} title="点击切换完成状态">
                  <div className={`wchk ${t.done ? 'on' : ''}`}><Icon name="check" size={14} /></div>
                  <span className="wp-task-tx">{t.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 番茄专注：横向紧凑卡片（时间球居中 + 右侧控制区） */}
        <div className="card daily-focus" data-pomo={pomoTheme}>
          <div className="daily-focus-body">
            <div className="focus-ring" style={{ ['--pct' as string]: Math.max(0.04, pct) }}>
              <span className="focus-time">{mm}:{ss}</span>
              <span className="focus-state">{phaseLabel}</span>
            </div>
            <div className="daily-focus-side">
              <div className="focus-side-head">
                <div className="sec-title">🍅 番茄专注</div>
                <span className={`focus-phase ${phase}`}>{phase === 'focus' ? '专注' : phase === 'short' ? '短休息' : '长休息'}</span>
              </div>
              {/* 本轮循环进度：已完轮次 / 长休息节奏 */}
              <div className="focus-cycle" title={`每 ${cfg.every} 轮一次长休息`}>
                {Array.from({ length: cfg.every }).map((_, i) => (
                  <i key={i} className={i < (cycle % cfg.every) ? 'on' : ''} />
                ))}
                <em>{cycle % cfg.every} / {cfg.every}</em>
              </div>
              <div className="focus-ops">
                {phase === 'focus' ? (
                  !timer.isRunning
                    ? (isPaused
                        ? <button className="btn" onClick={() => timer.resume()}>继续专注</button>
                        : <button className="btn" onClick={startFocus} disabled={left === 0}>开始专注</button>)
                    : <button className="btn ghost" onClick={() => timer.pause()}>暂停</button>
                ) : (
                  <button className="btn ghost" onClick={startFocus}>跳过休息</button>
                )}
                {timer.isRunning && (
                  <button className="btn slim ghost" onClick={() => void completeFocus(false)}>{phase === 'focus' ? '收尾并记录' : '提前结束'}</button>
                )}
                <button className="btn slim ghost" onClick={resetFocus}>重置</button>
              </div>
              {/* 今日目标与累计统计（信息补充，不拥挤） */}
              <div className="focus-stats">
                <div className="focus-goal-row">
                  <span className="dim">今日目标</span>
                  <div className="focus-goal-bar" title={`已完成 ${todayTomatoes} / ${dailyGoal} 个番茄（${goalPct}%）`}><i style={{ width: `${goalPct}%` }} /></div>
                  <b>{goalPct}%</b>
                </div>
                <div className="focus-stat">
                  今日 <b>{todayTomatoes}</b> / {dailyGoal} 个番茄 · 累计 <b>{todayMin}</b> 分钟 · 本周 <b>{weekTomatoes}</b> 个
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 今日回顾：全宽大输入区 */}
        <div className="card daily-review">
          <div className="sec-title">📝 今日回顾</div>
          <div className="review-stats">
            {Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => (
              <span key={k} className="chip">{k} {v}</span>
            ))}
            {!todayData && <span className="dim">今天还没有任何沉淀 · 去时间线记录第一条</span>}
          </div>
          {saved ? (
            <div className="review-saved">
              <pre>{savedBody}</pre>
              <div className="review-saved-ops">
                <span className="dim" style={{ fontSize: 12 }}>已写入时间线（日志）</span>
                <button className="btn slim ghost" onClick={() => { setReview(savedBody); setSaved(false) }}>改写</button>
              </div>
            </div>
          ) : (
            <>
              <textarea
                value={review}
                onChange={(e) => setReview(e.target.value)}
                placeholder="今天做了什么 / 卡在哪里 / 明天最重要的一件事……"
                rows={10}
                maxLength={600}
              />
              <div className="review-ops">
                <button className="btn slim ghost" onClick={genDraft} title="根据今天的时间线数据生成草稿">✨ 自动草稿</button>
                {REVIEW_TEMPLATES.map((t) => (
                  <button key={t.id} className="btn slim ghost" title={`使用「${t.label}」模板`} onClick={() => { setReview((cur) => cur && !cur.startsWith('今天') ? `${cur}\n\n${t.body}` : t.body); setSaved(false) }}>{t.label}</button>
                ))}
              </div>
              <button className="btn" onClick={() => void saveReview(review)} disabled={!review.trim()}>写入时间线（日志）</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}