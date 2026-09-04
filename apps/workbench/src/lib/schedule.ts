/**
 * 工作时间（schedule）设置与时段判定：
 * - 配置存服务端 SiteSetting 的 schedule 分组（workStart/workEnd/workdays）
 * - isWorkTime(now, schedule)：工作日 且 时间落在 [workStart, workEnd) → 工作时间，否则个人时间
 * - 跨午夜（如 22:00~06:00）按「start > end」自动识别
 */
import { api } from '../api'

export interface Schedule {
  workStart: string // 'HH:mm'
  workEnd: string // 'HH:mm'
  workdays: number[] // 0=周日 … 6=周六（默认 [1,2,3,4,5]）
}

export const DEFAULT_SCHEDULE: Schedule = { workStart: '09:00', workEnd: '18:00', workdays: [1, 2, 3, 4, 5] }

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** 服务端原始分组 → 规范 Schedule（非法字段回退默认） */
export function normalizeSchedule(raw: unknown): Schedule {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const s = typeof r.workStart === 'string' && TIME_RE.test(r.workStart) ? r.workStart : DEFAULT_SCHEDULE.workStart
  const e = typeof r.workEnd === 'string' && TIME_RE.test(r.workEnd) ? r.workEnd : DEFAULT_SCHEDULE.workEnd
  let days = Array.isArray(r.workdays) ? r.workdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : []
  days = [...new Set(days)].sort((a, b) => a - b)
  if (!days.length) days = [...DEFAULT_SCHEDULE.workdays]
  return { workStart: s, workEnd: e, workdays: days }
}

export async function fetchSchedule(): Promise<Schedule> {
  try {
    const s = await api.get<Record<string, unknown>>('/settings')
    return normalizeSchedule(s.schedule)
  } catch {
    return { ...DEFAULT_SCHEDULE }
  }
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export interface WorkTimeState {
  working: boolean
  /** 工作时间：距下班；个人时间：距上班（分钟）；null = 今天不是工作日 */
  minutesUntilEdge: number | null
  workday: boolean
}

export function isWorkTime(now: Date, sch: Schedule): WorkTimeState {
  const day = now.getDay()
  const workday = sch.workdays.includes(day)
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = toMin(sch.workStart)
  const end = toMin(sch.workEnd)
  if (!workday) return { working: false, minutesUntilEdge: null, workday: false }
  if (start <= end) {
    // 常规区间（如 09:00~18:00）
    if (cur >= start && cur < end) return { working: true, minutesUntilEdge: end - cur, workday: true }
    return { working: false, minutesUntilEdge: cur < start ? start - cur : null, workday: true }
  }
  // 跨午夜区间（如 22:00~06:00）
  if (cur >= start) return { working: true, minutesUntilEdge: 24 * 60 - cur + end, workday: true }
  if (cur < end) return { working: true, minutesUntilEdge: end - cur, workday: true }
  return { working: false, minutesUntilEdge: null, workday: true }
}

export const fmtMinutes = (m: number): string => {
  if (m <= 0) return '不足 1 分钟'
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h === 0) return `${mm} 分钟`
  if (mm === 0) return `${h} 小时`
  return `${h} 小时 ${mm} 分`
}
