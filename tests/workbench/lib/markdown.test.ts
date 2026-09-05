/** lib/markdown 渲染规则单测：math / mermaid 围栏 → 专用结构，其余走默认渲染 */
import { describe, expect, it } from 'vitest'
import { renderMarkdown, hasMathFence, hasMermaidFence } from '@workbench/lib/markdown'

describe('renderMarkdown', () => {
  it('空内容返回空串', () => {
    expect(renderMarkdown('')).toBe('')
    expect(renderMarkdown('   ')).toBe('')
  })

  it('math 围栏渲染为 KaTeX 公式块', () => {
    const html = renderMarkdown('```math\nE = mc^2\n```')
    expect(html).toContain('md-katex')
    expect(html).toContain('katex')
  })

  it('latex 别名同样识别为公式', () => {
    expect(hasMathFence('```latex\nx^2\n```')).toBe(true)
    expect(hasMathFence('```math\nx\n```')).toBe(true)
    expect(hasMathFence('```ts\nconst x = 1\n```')).toBe(false)
  })

  it('mermaid 围栏渲染为占位结构（阅读端水合）', () => {
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```')
    expect(html).toContain('md-mermaid')
    expect(html).toContain('graph TD; A--&gt;B;')
    expect(hasMermaidFence('```mermaid\ngraph TD\n```')).toBe(true)
    expect(hasMermaidFence('```ts\nx\n```')).toBe(false)
  })

  it('普通代码块不受影响', () => {
    const html = renderMarkdown('```ts\nconst a = 1\n```')
    expect(html).toContain('<pre>')
    expect(html).not.toContain('md-mermaid')
    expect(html).not.toContain('md-katex')
  })

  it('html 注入保持关闭（html:false）', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
  })
})
