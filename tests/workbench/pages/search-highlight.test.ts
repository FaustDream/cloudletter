import { describe, it, expect } from 'vitest'
import { highlight } from '@workbench/pages/SearchPage'

/** 检索高亮（最小功能）：命中包 <mark>、未命中部分与 HTML 特殊字符一律转义 */
describe('highlight', () => {
  it('命中词包裹 <mark>，其余转义输出', () => {
    expect(highlight('hello world', 'world')).toBe('hello <mark>world</mark>')
  })

  it('HTML 字符一律转义（含命中片段本身）', () => {
    expect(highlight('<img src=x onerror=alert(1)>', 'img')).toBe('&lt;<mark>img</mark> src=x onerror=alert(1)&gt;')
  })

  it('空关键词返回完整转义文本（杜绝未转义直出）', () => {
    expect(highlight('<b>bold</b>', '')).toBe('&lt;b&gt;bold&lt;/b&gt;')
    expect(highlight('a "b" c', '')).toBe('a &quot;b&quot; c')
  })

  it('大小写不敏感命中，保留原文大小写', () => {
    expect(highlight('Foo Bar', 'foo')).toBe('<mark>Foo</mark> Bar')
  })

  it('多处命中全部标记', () => {
    expect(highlight('aXbXc', 'x')).toBe('a<mark>X</mark>b<mark>X</mark>c')
  })
})
