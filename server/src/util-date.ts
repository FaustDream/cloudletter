/**
 * 本地日期工具（数据写入/分组统一口径）：
 * 个人工具单机部署，服务器时区即用户时区 —— 一律用本地时区取日期，
 * 修复此前 `toISOString()`（UTC）导致东八区每天 0-8 点的数据记到昨天的问题。
 */
export function ymdLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 当天零点（本地时区） */
export function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
