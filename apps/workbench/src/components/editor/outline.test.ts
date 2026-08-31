import { describe, it, expect } from 'vitest'
import { extractHeadings, extractWikiLinks } from './Outline'

/** 大纲提取（最小功能）：标题层级、代码围栏过滤 */
describe('extractHeadings', () => {
  it('提取 1-4 级标题，5 级以上不算', () => {
    const md = '# 一级\n## 二级\n### 三级\n#### 四级\n##### 五级不算'
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: '一级' },
      { level: 2, text: '二级' },
      { level: 3, text: '三级' },
      { level: 4, text: '四级' },
    ])
  })

  it('跳过代码围栏内的伪标题', () => {
    expect(extractHeadings('# 真标题\n```\n# 假标题\n```\n## 第二个')).toEqual([
      { level: 1, text: '真标题' },
      { level: 2, text: '第二个' },
    ])
  })

  it('# 后必须有空格；空文档返回空数组', () => {
    expect(extractHeadings('#没有空格')).toEqual([])
    expect(extractHeadings('')).toEqual([])
  })
})

/** 双链提取（最小功能）：去重、保序、别名取目标 */
describe('extractWikiLinks', () => {
  it('提取目标并去重，保留出现顺序', () => {
    expect(extractWikiLinks('见 [[A]] 与 [[B|别名]]，再次提到 [[A]]。')).toEqual(['A', 'B'])
  })

  it('普通方括号不是双链', () => {
    expect(extractWikiLinks('普通 [文本] 不是双链')).toEqual([])
  })

  it('目标名去除首尾空白', () => {
    expect(extractWikiLinks('[[ 目标 ]]')).toEqual(['目标'])
  })
})
