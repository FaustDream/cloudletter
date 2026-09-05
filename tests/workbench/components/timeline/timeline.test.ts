/**
 * 时间轴视觉规范纯函数单测（最小功能）：
 * - filterNodes 类型过滤；daysAgo 距今天数；segOf 分段（今天/最近一周/更早）
 * - dayLabel 依赖 localStorage（node 环境用 stub）：今天/昨天/中文日期/iso 格式
 * 全部用相对当天计算的日期，避免跨日硬编码。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { filterNodes, daysAgo, segOf, dayLabel, SEG_LABEL, type TimelineNode } from '@workbench/components/timeline/timeline'

/** 本地时区 YYYY-MM-DD */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function shiftDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return ymd(d)
}

const node = (t: TimelineNode['t'], id: string = t): TimelineNode => ({
  id, t, title: t, sub: '', date: '2026-08-30',
})

describe('filterNodes', () => {
  const items = [node('journal', 'a'), node('note', 'b'), node('journal', 'c')]

  it("all 返回原数组；指定类型只留该类型", () => {
    expect(filterNodes(items, 'all')).toEqual(items)
    expect(filterNodes(items, 'journal').map((n) => n.id)).toEqual(['a', 'c'])
  })
})

describe('daysAgo / segOf', () => {
  it('今天 = 0 → today 分段', () => {
    expect(daysAgo(shiftDays(0))).toBe(0)
    expect(SEG_LABEL[segOf(shiftDays(0))]).toBe('今天')
  })

  it('昨天 = 1 → 最近一周；三天前 → 最近一周', () => {
    expect(daysAgo(shiftDays(-1))).toBe(1)
    expect(SEG_LABEL[segOf(shiftDays(-3))]).toBe('最近一周')
  })

  it('七天前及更早 → 更早', () => {
    expect(daysAgo(shiftDays(-7))).toBe(7)
    expect(SEG_LABEL[segOf(shiftDays(-7))]).toBe('更早')
    expect(SEG_LABEL[segOf('2000-01-01')]).toBe('更早')
  })
})

describe('dayLabel', () => {
  beforeEach(() => {
    ;(globalThis as any).localStorage = { getItem: (_k: string) => null }
  })

  it('今天 / 昨天', () => {
    expect(dayLabel(shiftDays(0)).d).toBe('今天')
    expect(dayLabel(shiftDays(-1)).d).toBe('昨天')
  })

  it('8-14 天前：cn 格式「M月D日」+ 上周标记；iso 格式按设置原样输出', () => {
    const date = shiftDays(-10)
    const dt = new Date(date + 'T00:00:00')
    expect(dayLabel(date).d).toBe(`${dt.getMonth() + 1}月${dt.getDate()}日`)
    expect(dayLabel(date).f).toBe('上周')

    ;(globalThis as any).localStorage = { getItem: (_k: string) => 'iso' }
    expect(dayLabel(date).d).toBe(date)
  })
})
