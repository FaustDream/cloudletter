/**
 * 粘贴自动识别（§5.3 R5）单元测试
 */
import { describe, expect, test } from 'vitest'
import { detectPasted } from './paste-detect'

describe('R5 接口片段 → api 块', () => {
  test('含 method/path 的片段被包裹为 ```api', () => {
    const out = detectPasted('method: GET\npath: /api/v1/users\nsummary: 用户列表')
    expect(out).toBe('```api\nmethod: GET\npath: /api/v1/users\nsummary: 用户列表\n```')
  })

  test('含 responses 的完整片段', () => {
    const out = detectPasted('method: POST\npath: /api/login\nresponses:\n  - status: 200\n    desc: ok')
    expect(out).toMatch(/^```api\n/)
    expect(out).toContain('responses:')
  })

  test('普通文本不含接口字段 → 不改写', () => {
    expect(detectPasted('只是一段普通文字，method 这个词不在行首。')).toBeNull()
  })
})

describe('R5 参数表格 → params 块', () => {
  test('中文表头 Markdown 表格', () => {
    const table = [
      '| 参数 | 类型 | 必填 | 默认 | 说明 |',
      '| --- | --- | --- | --- | --- |',
      '| page | number | 否 | 1 | 页码 |',
      '| size | number | 否 | 20 | 每页条数 |',
    ].join('\n')
    const out = detectPasted(table)
    expect(out).toMatch(/^```params\n/)
    expect(out).toContain('- name: page')
    expect(out).toContain('  type: number')
    expect(out).toContain('  required: false')
    expect(out).toContain('  default: "1"')
    expect(out).toContain('  desc: 页码')
    expect(out).toContain('- name: size')
  })

  test('英文表头 + required 大小写', () => {
    const table = ['| name | type | required | desc |', '| --- | --- | --- | --- |', '| id | string | Yes | 用户ID |'].join('\n')
    const out = detectPasted(table)
    expect(out).toContain('- name: id')
    expect(out).toContain('  required: true')
  })

  test('与参数无关的表格 → 不改写', () => {
    const table = ['| 月份 | 销量 |', '| --- | --- |', '| 1月 | 100 |'].join('\n')
    expect(detectPasted(table)).toBeNull()
  })
})

describe('R5 GFM 警告 → callout', () => {
  test('> [!NOTE] 转 :::note', () => {
    const out = detectPasted('> [!NOTE]\n> 这是提示内容')
    expect(out).toBe(':::note\n这是提示内容\n:::')
  })

  test('> [!WARNING] 转 :::warning', () => {
    const out = detectPasted('> [!WARNING]\n> 注意危险')
    expect(out).toBe(':::warning\n注意危险\n:::')
  })

  test('> [!CAUTION] 映射为 warning', () => {
    const out = detectPasted('> [!CAUTION]\n> 谨慎操作')
    expect(out).toContain(':::warning')
  })
})

describe('其他', () => {
  test('普通 Markdown 不被改写', () => {
    expect(detectPasted('## 标题\n\n正文 **加粗**')).toBeNull()
  })

  test('空文本返回 null', () => {
    expect(detectPasted('   \n  ')).toBeNull()
  })
})
