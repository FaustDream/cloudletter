/**
 * 番茄专注偏好（设置·偏好 → 番茄专注 写入，实时生效）
 * 计时引擎使用成熟开源方案 react-timer-hook（截止时间戳驱动，切后台不漂移）
 */

export interface PomodoroPrefs {
  /** 每轮专注时长（分钟） */
  focus: number
  /** 短休息（分钟） */
  short: number
  /** 长休息（分钟） */
  long: number
  /** 每 N 轮专注后进入长休息 */
  every: number
  /** 自动衔接：专注结束自动开始休息，休息结束自动开始专注 */
  auto: boolean
  /** 完成提示音 / 浏览器通知 */
  sound: boolean
  /** 每日目标（番茄数） */
  dailyGoal: number
}

const KEYS = {
  focus: 'cl_pomodoro_focus',
  short: 'cl_pomodoro_short',
  long: 'cl_pomodoro_long',
  every: 'cl_pomodoro_every',
  auto: 'cl_pomodoro_auto',
  sound: 'cl_pomodoro_sound',
  dailyGoal: 'cl_pomodoro_daily_goal',
} as const

const DEFAULTS: PomodoroPrefs = { focus: 25, short: 5, long: 15, every: 4, auto: true, sound: true, dailyGoal: 8 }

function num(v: string | null, d: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : d
}

/** 读取番茄偏好（非法值回退默认） */
export function readPomodoroPrefs(): PomodoroPrefs {
  try {
    return {
      focus: num(localStorage.getItem(KEYS.focus), DEFAULTS.focus),
      short: num(localStorage.getItem(KEYS.short), DEFAULTS.short),
      long: num(localStorage.getItem(KEYS.long), DEFAULTS.long),
      every: num(localStorage.getItem(KEYS.every), DEFAULTS.every),
      auto: localStorage.getItem(KEYS.auto) ? localStorage.getItem(KEYS.auto) === '1' : DEFAULTS.auto,
      sound: localStorage.getItem(KEYS.sound) ? localStorage.getItem(KEYS.sound) === '1' : DEFAULTS.sound,
      dailyGoal: num(localStorage.getItem(KEYS.dailyGoal), DEFAULTS.dailyGoal),
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export type PomodoroKey = keyof PomodoroPrefs

/** 写入单条番茄偏好 */
export function writePomodoroPref(key: PomodoroKey, value: number | boolean): void {
  localStorage.setItem(KEYS[key], typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
}

/** 完成提示音（WebAudio 双音，避免引入音频资源） */
export function playChime(): void {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const play = (freq: number, at: number) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + at + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.6)
      o.connect(g); g.connect(ctx.destination)
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.65)
    }
    play(880, 0); play(1174, 0.18)
  } catch { /* 音频不可用时静默 */ }
}