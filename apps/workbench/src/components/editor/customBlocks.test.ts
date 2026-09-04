/** customBlocks 代码块语言归一单测：别名/未收录语言在解析回灌前归一到规范 id，避免 BlockNote 渲染抛错 */
import { describe, expect, it } from 'vitest'
import { canonicalCodeLanguage, normalizeCodeLanguages } from './customBlocks'

describe('canonicalCodeLanguage', () => {
  it('规范 id 原样保留', () => {
    expect(canonicalCodeLanguage('typescript')).toBe('typescript')
    expect(canonicalCodeLanguage('text')).toBe('text')
    expect(canonicalCodeLanguage('mermaid')).toBe('mermaid')
  })

  it('别名归一到规范 id', () => {
    expect(canonicalCodeLanguage('ts')).toBe('typescript')
    expect(canonicalCodeLanguage('js')).toBe('javascript')
    expect(canonicalCodeLanguage('py')).toBe('python')
    expect(canonicalCodeLanguage('c++')).toBe('cpp')
    expect(canonicalCodeLanguage('shell')).toBe('bash')
    expect(canonicalCodeLanguage('latex')).toBe('math')
  })

  it('大小写不敏感', () => {
    expect(canonicalCodeLanguage('TS')).toBe('typescript')
    expect(canonicalCodeLanguage(' TypeScript ')).toBe('typescript')
  })

  it('未收录语言降级为 text（避免渲染崩溃）', () => {
    expect(canonicalCodeLanguage('dockerfile')).toBe('text')
    expect(canonicalCodeLanguage('')).toBe('text')
  })
})

describe('normalizeCodeLanguages', () => {
  it('递归归一含嵌套块的代码块语言', () => {
    const blocks = [
      { type: 'paragraph', content: 'hi' },
      { type: 'bulletListItem', content: [
        { type: 'codeBlock', props: { language: 'ts' }, content: 'const x = 1' },
      ]},
      { type: 'codeBlock', props: { language: 'typescript' }, content: 'const y = 2' },
    ]
    const out = normalizeCodeLanguages(blocks)
    expect((out[1].content[0] as any).props.language).toBe('typescript')
    expect((out[2] as any).props.language).toBe('typescript')
  })

  it('空/非块输入不报错', () => {
    expect(() => normalizeCodeLanguages([])).not.toThrow()
    expect(() => normalizeCodeLanguages([{ type: 'paragraph', content: '' }])).not.toThrow()
  })
})