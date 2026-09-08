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
  // 回溯上限一年：打卡连续性不存在跨年断档的合法场景
  for (let i = 0; i < 366; i++) {
    if (!map[todayYMD(d)]) break
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}
