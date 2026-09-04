/** 习惯打卡共享工具：log JSON 解析与连续天数（CheckinPage / 时间流详情共用） */
import { todayYMD } from './date'

/** {"YYYY-MM-DD": true} 逐日打卡记录解析（损坏容错） */
export function parseLog(log: string): Record<string, boolean> {
  try { return JSON.parse(log || '{}') as Record<string, boolean> } catch { return {} }
}

/** 自今天往前的连续打卡天数 */
export function computeStreak(log: string): number {
  const map = parseLog(log)
  let n = 0
  const d = new Date()
  while (true) {
    const k = todayYMD(d)
    if (map[k]) { n++; d.setDate(d.getDate() - 1) } else break
  }
  return n
}
