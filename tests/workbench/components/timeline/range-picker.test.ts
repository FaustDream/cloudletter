import { describe, it, expect } from 'vitest'
import { quickToRange, rangeLabel, DEFAULT_RANGE } from '@workbench/components/timeline/RangePicker'

describe('时间范围选择器纯函数', () => {
  it('quickToRange：返回合法 YYYY-MM-DD 且 from ≤ to', () => {
    const { from, to } = quickToRange(30)
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(from <= to).toBe(true)
  })

  it('quickToRange 区间长度 = N-1 天', () => {
    const { from, to } = quickToRange(7)
    const spanDays = Math.round((Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
      - Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))) / 864e5)
    expect(spanDays).toBe(6)
  })

  it('rangeLabel：快捷与自定义文案', () => {
    expect(rangeLabel({ mode: 'quick', quick: 30, from: '', to: '' })).toBe('近 30 天')
    expect(rangeLabel({ mode: 'custom', quick: 30, from: '2026-08-01', to: '2026-08-31' })).toBe('08-01 ~ 08-31')
  })

  it('DEFAULT_RANGE 为近 30 天', () => {
    expect(DEFAULT_RANGE.mode).toBe('quick')
    expect(DEFAULT_RANGE.quick).toBe(30)
  })
})