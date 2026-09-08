/** 双视图时间轴共享类型与视觉规范（鱼骨 + 节点宇宙，同一份数据两种渲染） */

export type TimelineType = 'journal' | 'note' | 'plan' | 'checkin' | 'ledger' | 'goal' | 'focus'

export interface TimelineNode {
  id: string
  t: TimelineType
  title: string
  sub: string
  date: string
  xp?: number
  gold?: number
  tags?: string[]
}

export interface TimelineDay {
  date: string
  xp: number
  gold: number
  items: TimelineNode[]
}

/** 7 类型：标签 + 色值（统一规范：无紫，青替目标色） */
export const TL_TYPES: Array<[TimelineType, string]> = [
  ['journal', '日志'],
  ['note', '灵感'],
  ['plan', '计划'],
  ['checkin', '习惯'],
  ['ledger', '记账'],
  ['goal', '目标'],
  ['focus', '专注'],
]
export const TL_COLOR: Record<TimelineType, string> = {
  journal: '#185FA5',
  note: '#D97706',
  plan: '#EA580C',
  checkin: '#059669',
  ledger: '#DC2626',
  goal: '#0E7490',
  focus: '#475569',
}
export const TL_DESC: Record<TimelineType, string> = {
  journal: '文章 / 长日志',
  note: '灵感 / 碎片',
  plan: '计划完成',
  checkin: '习惯打卡',
  ledger: '一笔账',
  goal: '目标进度',
  focus: '番茄专注',
}

/** 按类型过滤节点：空数组 = 全部，数组内为「或」关系（多选） */
export function filterNodes(items: TimelineNode[], t: TimelineType[]): TimelineNode[] {
  if (t.length === 0) return items
  return items.filter((i) => t.includes(i.t))
}

/** YYYY-MM-DD → 距今天数（今天=0） */
export function daysAgo(date: string): number {
  const t = new Date()
  t.setHours(0, 0, 0, 0)
  const d = new Date(date + 'T00:00:00')
  return Math.round((t.getTime() - d.getTime()) / 86400000)
}

/** 鱼骨分段：今天 / 最近一周 / 更早 —— 视觉上聚成两段 */
export type SegKey = 'today' | 'week' | 'rest'
export const segOf = (date: string): SegKey => {
  const a = daysAgo(date)
  return a <= 0 ? 'today' : a <= 6 ? 'week' : 'rest'
}
export const SEG_LABEL: Record<SegKey, string> = { today: '今天', week: '最近一周', rest: '更早' }

/** YYYY-MM-DD → 「今天 / 昨天 / 8月28日 · 周五」 */
export function dayLabel(date: string): { d: string; f: string } {
  const today = new Date()
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const t = ymd(today)
  if (date === t) return { d: '今天', f: '' }
  const y = new Date(t)
  y.setDate(y.getDate() - 1)
  if (date === ymd(y)) return { d: '昨天', f: '' }
  const dt = new Date(date + 'T00:00:00')
  const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  // 日期格式可配置（设置·偏好）：cn = 8月28日，iso = 2026-08-28
  const fmt = localStorage.getItem('cl_date_fmt') || 'cn'
  const base = fmt === 'iso' ? date : `${dt.getMonth() + 1}月${dt.getDate()}日`
  const ago = daysAgo(date)
  const mark = ago <= 7 ? w[dt.getDay()] : ago <= 14 ? '上周' : '更早'
  return { d: base, f: mark }
}