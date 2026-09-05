import { describe, it, expect } from 'vitest'
import { todayYMD, ymdToDate, addDays, monthMatrix, isYMD } from '@workbench/lib/date'

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

describe('日期加减 / 解析 / 校验', () => {
  it('addDays 跨月跨年', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('ymdToDate 本地 0 点解析（不按 UTC 跨日）', () => {
    const d = ymdToDate('2026-08-31')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7)
    expect(d.getDate()).toBe(31)
  })

  it('isYMD 校验格式', () => {
    expect(isYMD('2026-08-31')).toBe(true)
    expect(isYMD('2026-8-1')).toBe(false)
    expect(isYMD('abc')).toBe(false)
    expect(isYMD('')).toBe(false)
  })
})

describe('monthMatrix（月历矩阵）', () => {
  it('2026-08：31 天 + 7 的整数倍单元格', () => {
    const m = monthMatrix(2026, 7) // 0 基：8 月
    expect(m.ym).toBe('2026-08')
    const inMonth = m.cells.filter((c) => c.inMonth)
    expect(inMonth.length).toBe(31)
    expect(m.cells.length % 7).toBe(0)
    expect(inMonth[0].ymd).toBe('2026-08-01')
    expect(inMonth[30].ymd).toBe('2026-08-31')
  })

  it('跨月补位日期属于相邻月份', () => {
    const m = monthMatrix(2026, 7)
    const pad = m.cells.filter((c) => !c.inMonth)
    for (const c of pad) {
      expect(c.ymd > '2026-08-31' || c.ymd < '2026-08-01').toBe(true)
    }
  })
})
