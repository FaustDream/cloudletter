/**
 * 本地日期工具单测（最小功能）：ymdLocal 按本地时区取日期并补零；startOfToday 归零时分秒。
 */
import { describe, it, expect } from 'vitest'
import { ymdLocal, startOfToday } from '@server/util-date'

describe('ymdLocal', () => {
  it('本地时区取日期：23:59 仍属当天（不用 UTC）', () => {
    expect(ymdLocal(new Date(2026, 7, 29, 23, 59, 59))).toBe('2026-08-29')
  })

  it('月/日补零', () => {
    expect(ymdLocal(new Date(2026, 2, 5, 12, 0, 0))).toBe('2026-03-05')
    expect(ymdLocal(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01')
  })
})

describe('startOfToday', () => {
  it('返回当天本地零点', () => {
    const d = startOfToday()
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
    expect(d.getMilliseconds()).toBe(0)
  })
})
