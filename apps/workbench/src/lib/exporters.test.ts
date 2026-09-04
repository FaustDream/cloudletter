/** 导出模块单测：文件名安全化 / HTML 文档结构 / math·mermaid 资源按需注入 */
import { describe, expect, it } from 'vitest'
import { buildPostHtml, sanitizeFilename } from './exporters'

const META = {
  title: '通用 UI 设计规范 v1.0',
  category: '设计',
  tags: ['设计', '规范'],
  date: '2026-09-03T10:00:00.000Z',
}

describe('sanitizeFilename', () => {
  it('去除非法字符并回退空标题', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
    expect(sanitizeFilename('')).toBe('无标题')
    expect(sanitizeFilename('  多 空格  ')).toBe('多 空格')
  })
})

describe('buildPostHtml', () => {
  it('包含标题、元信息与正文渲染结果', () => {
    const html = buildPostHtml(META, '# 一、设计哲学\n\n正文段落')
    expect(html).toContain('<title>通用 UI 设计规范 v1.0</title>')
    expect(html).toContain('doc-title')
    expect(html).toContain('#设计')
    expect(html).toContain('2026-09-03')
    expect(html).toContain('<h1>一、设计哲学</h1>')
    expect(html).not.toContain('katex.min.css')
    expect(html).not.toContain('mermaid.esm.min.mjs')
  })

  it('含 math 围栏时注入 KaTeX CDN 样式', () => {
    const html = buildPostHtml(META, '```math\nE=mc^2\n```')
    expect(html).toContain('katex.min.css')
    expect(html).toContain('md-katex')
  })

  it('含 mermaid 围栏时注入 CDN 渲染脚本', () => {
    const html = buildPostHtml(META, '```mermaid\ngraph TD; A-->B;\n```')
    expect(html).toContain('mermaid.esm.min.mjs')
    expect(html).toContain('md-mermaid')
  })

  it('封面存在时输出封面图', () => {
    const html = buildPostHtml({ ...META, cover: 'https://example.com/a.jpg' }, '正文')
    expect(html).toContain('doc-cover')
    expect(html).toContain('https://example.com/a.jpg')
  })
})
