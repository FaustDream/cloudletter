import { describe, it, expect } from 'vitest'
import { todayYMD } from './date'

/** 本地日期工具（全站统一口径）：按本地时区拼接，杜绝 UTC 把东八区 0-8 点记到昨天 */
describe('todayYMD', () => {
  it('本地 23:59 仍属当天', () => {
    expect(todayYMD(new Date(2026, 7, 29, 23, 59, 0))).toBe('2026-08-29')
  })

  it('月/日补零', () => {
    expect(todayYMD(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01')
    expect(todayYMD(new Date(2026, 2, 5, 12, 0, 0))).toBe('2026-03-05')
  })
})
