/** 本地日期工具（全站统一口径）：一律用本地时区，修复 UTC 导致东八区 0-8 点记到昨天的问题 */
export function todayYMD(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
