import { describe, it, expect } from 'vitest'
import { lineDiff } from './RevisionPanel'

/** 版本对比（最小功能）：基于 LCS 的行级 diff，old 视角 del / new 视角 add */
describe('lineDiff', () => {
  it('新增行标记 add（保序）', () => {
    expect(lineDiff('a\nb', 'a\nb\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'same', text: 'b' },
      { type: 'add', text: 'c' },
    ])
  })

  it('删除行标记 del（保序）', () => {
    expect(lineDiff('a\nb\nc', 'a\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'same', text: 'c' },
    ])
  })

  it('完全相同全 same', () => {
    expect(lineDiff('x\ny', 'x\ny').every((d) => d.type === 'same')).toBe(true)
  })

  it('全文替换输出 del + add', () => {
    expect(lineDiff('old', 'new')).toEqual([
      { type: 'del', text: 'old' },
      { type: 'add', text: 'new' },
    ])
  })

  it('空 old 文本按一个空行处理：del 空行 + 全部 add', () => {
    expect(lineDiff('', 'a\nb')).toEqual([
      { type: 'del', text: '' },
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ])
  })
})
