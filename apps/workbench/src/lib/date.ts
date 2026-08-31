/** 本地日期工具（全站统一口径）：一律用本地时区，修复 UTC 导致东八区 0-8 点记到昨天的问题 */
export function todayYMD(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** YYYY-MM-DD → 本地 Date（0 点），避免 new Date('YYYY-MM-DD') 按 UTC 解析跨日 */
export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** Date → YYYY-MM-DD（本地时区） */
export function dateToYMD(d: Date): string {
  return todayYMD(d)
}

/** 日期加减（按天） */
export function addDays(ymd: string, n: number): string {
  const d = ymdToDate(ymd)
  d.setDate(d.getDate() + n)
  return todayYMD(d)
}

/** 生成当月日历矩阵：第一行从周日开始补前月空白，返回 { ym: 'YYYY-MM', cells: Array<{ ymd, inMonth }> } */
export interface CalCell { ymd: string; inMonth: boolean; day: number }
export interface CalMatrix { ym: string; cells: CalCell[] }

export function monthMatrix(year: number, month: number): CalMatrix {
  // month: 0-11
  const first = new Date(year, month, 1)
  const startPad = first.getDay() // 0=周日
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const ym = `${year}-${String(month + 1).padStart(2, '0')}`
  const cells: CalCell[] = []
  for (let i = 0; i < startPad; i++) {
    const d = new Date(year, month, i - startPad + 1)
    cells.push({ ymd: todayYMD(d), inMonth: false, day: d.getDate() })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ ymd: `${ym}-${String(day).padStart(2, '0')}`, inMonth: true, day })
  }
  const tail = cells.length % 7
  if (tail !== 0) {
    for (let i = 0; i < 7 - tail; i++) {
      const d = new Date(year, month + 1, i + 1)
      cells.push({ ymd: todayYMD(d), inMonth: false, day: d.getDate() })
    }
  }
  return { ym, cells }
}

/** 校验 YYYY-MM-DD 格式 */
export function isYMD(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v)
}