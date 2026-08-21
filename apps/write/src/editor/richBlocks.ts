/**
 * Tiptap 富块节点扩展（§20.4 完整实现）：
 *   ApiBlock / ParamsBlock / Callout / WikiLink / RichCodeBlock(title+行高亮)
 * 与源码模式共用同一序列化契约：解析侧重写 markdown-it 渲染规则（fence/容器/行内双链），
 * 序列化侧经 tiptap-markdown 的 storage.markdown.serialize 输出 §5.2 语法。
 */
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import CodeBlock from '@tiptap/extension-code-block'
import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'

/**
 * Markdown 序列化最小接口（G1 修复：消除 `serialize(state: any, node: any)`）。
 * 与 tiptap-markdown 的 MarkdownSerializerState 结构兼容（结构类型，无需新增依赖）。
 */
interface MarkdownWriteState {
  write(s: string): void
  text(s: string, escape?: boolean): void
  ensureNewLine(): void
  closeBlock(node: { type: { name: string } }): void
  renderContent(node: unknown): void
}
interface MarkdownNodeLike {
  type: { name: string }
  attrs: Record<string, unknown>
  textContent?: string
}

/** markdown-it 渲染 Token 的最小结构（G1：避免 `MarkdownIt.Token` namespace 访问问题） */
interface MarkdownItTokenLike {
  nesting: number
}

/* ========== HTML 转义 ========== */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}

/* ========== markdown-it 渲染规则（解析入口） ========== */

const CALLOUT_KINDS = ['note', 'tip', 'warning', 'danger'] as const

/** 围栏渲染：```api/```params → 结构块占位；普通代码块 → 带 title/marks 的 pre */
function fenceRule(md: MarkdownIt): void {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const info = (token.info || '').trim()
    const content = escapeHtml(token.content.replace(/\n$/, ''))

    if (info === 'api' || info === 'params') {
      const attr = info === 'api' ? 'data-api-block' : 'data-params-block'
      return `<div ${attr}>${content}</div>\n`
    }

    const m = info.match(/^(\S*)(?:\s+(.*))?$/)
    const lang = m?.[1] ?? ''
    const meta = m?.[2] ?? ''
    const title = meta.match(/title="([^"]*)"/)?.[1] ?? ''
    const marks = meta.match(/\{([\d,\s]+)\}/)?.[1]?.replace(/\s/g, '') ?? ''
    return (
      `<pre data-title="${escapeAttr(title)}" data-marks="${escapeAttr(marks)}">` +
      `<code class="language-${escapeAttr(lang)}">${content}</code></pre>\n`
    )
  }
}

/** 行内双链 [[目标|显示]] → <span data-wikilink>（§5.2.4） */
function wikilinkRule(md: MarkdownIt): void {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const src = state.src
    const pos = state.pos
    if (src.charCodeAt(pos) !== 0x5b /* [ */ || src.charCodeAt(pos + 1) !== 0x5b) return false
    const end = src.indexOf(']]', pos + 2)
    if (end < 0) return false
    const inner = src.slice(pos + 2, end)
    const bar = inner.indexOf('|')
    const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim()
    if (!target) return false
    const label = bar >= 0 ? inner.slice(bar + 1).trim() : ''
    if (!silent) {
      const token = state.push('html_inline', '', 0)
      token.content =
        `<span data-wikilink="${escapeAttr(target)}" data-label="${escapeAttr(label)}">` +
        `${escapeHtml(label || target)}</span>`
    }
    state.pos = end + 2
    return true
  })
}

/** :::kind 容器 → <div data-callout="kind">（§5.2.3） */
function containerRules(md: MarkdownIt): void {
  for (const kind of CALLOUT_KINDS) {
    md.use(
      container as unknown as (md: MarkdownIt, name: string, opts: { render: (tokens: MarkdownItTokenLike[], idx: number) => string }) => void,
      kind,
      {
        render(tokens: MarkdownItTokenLike[], idx: number) {
          if (tokens[idx].nesting === 1) return `<div data-callout="${kind}">\n`
          return '</div>\n'
        },
      },
    )
  }
}

/** 提取 markdown-it 规则的扩展：挂在任意扩展上即可（parse.setup 对所有扩展执行） */
export const MarkdownItRichRules = Extension.create({
  name: 'markdownItRichRules',
  addStorage() {
    return {
      markdown: {
        parse: {
          setup(md: MarkdownIt) {
            fenceRule(md)
            wikilinkRule(md)
            containerRules(md)
          },
        },
      },
    }
  },
})

/* ========== 接口块（atom，§5.2.1） ========== */

export const ApiBlock = Node.create({
  name: 'apiBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { yaml: { default: '' } }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-api-block]',
        getAttrs: (el) => ({ yaml: (el as HTMLElement).textContent ?? '' }),
      },
    ]
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-api-block': '' }),
      ['pre', {}, node.attrs.yaml as string],
    ]
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriteState, node: MarkdownNodeLike) {
          const yaml = String(node.attrs.yaml ?? '')
          state.write('```api\n' + yaml.replace(/\n$/, '') + '\n```')
          state.closeBlock(node)
        },
      },
    }
  },
})

/* ========== 参数表块（atom，§5.2.2） ========== */

export const ParamsBlock = Node.create({
  name: 'paramsBlock',
  group: 'block',
  atom: true,
  addAttributes() {
    return { yaml: { default: '' } }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-params-block]',
        getAttrs: (el) => ({ yaml: (el as HTMLElement).textContent ?? '' }),
      },
    ]
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-params-block': '' }),
      ['pre', {}, node.attrs.yaml as string],
    ]
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriteState, node: MarkdownNodeLike) {
          const yaml = String(node.attrs.yaml ?? '')
          state.write('```params\n' + yaml.replace(/\n$/, '') + '\n```')
          state.closeBlock(node)
        },
      },
    }
  },
})

/* ========== 提示框（内容节点，§5.2.3） ========== */

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { kind: { default: 'note' } }
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-callout]',
        getAttrs: (el) => ({ kind: (el as HTMLElement).getAttribute('data-callout') ?? 'note' }),
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes['data-callout'] ?? 'note'
    return ['div', mergeAttributes(HTMLAttributes, { class: `callout ${kind}` }), 0]
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriteState, node: MarkdownNodeLike) {
          state.write(':::' + String(node.attrs.kind ?? 'note') + '\n')
          state.renderContent(node)
          state.ensureNewLine()
          state.write(':::')
          state.closeBlock(node)
        },
      },
    }
  },
})

/* ========== 双链（行内节点，§5.2.4） ========== */

export const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      target: { default: '' },
      label: { default: '' },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-wikilink]',
        getAttrs: (el) => {
          const e = el as HTMLElement
          return {
            target: e.getAttribute('data-wikilink') ?? '',
            label: e.getAttribute('data-label') ?? '',
          }
        },
      },
    ]
  },
  renderHTML({ node }) {
    return ['span', { 'data-wikilink': node.attrs.target, title: node.attrs.target }, node.attrs.label || node.attrs.target]
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriteState, node: MarkdownNodeLike) {
          const target = String(node.attrs.target ?? '')
          const label = node.attrs.label ? `|${String(node.attrs.label)}` : ''
          state.write(`[[${target}${label}]]`)
        },
      },
    }
  },
})

/* ========== 增强代码块：lang + title + 行高亮（§5.2.5） ========== */

export const RichCodeBlock = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-title') ?? '',
        renderHTML: (attrs) => (attrs.title ? { 'data-title': attrs.title } : {}),
      },
      marks: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-marks') ?? '',
        renderHTML: (attrs) => (attrs.marks ? { 'data-marks': attrs.marks } : {}),
      },
    }
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownWriteState, node: MarkdownNodeLike) {
          const lang = String(node.attrs.language ?? '')
          const meta: string[] = []
          if (node.attrs.title) meta.push(`title="${String(node.attrs.title)}"`)
          if (node.attrs.marks) meta.push(`{${String(node.attrs.marks)}}`)
          const metaStr = meta.length ? ' ' + meta.join(' ') : ''
          state.write('```' + lang + metaStr + '\n')
          state.text(node.textContent ?? '', false)
          state.ensureNewLine()
          state.write('```')
          state.closeBlock(node)
        },
      },
    }
  },
})

export const richBlockExtensions = [
  MarkdownItRichRules,
  ApiBlock,
  ParamsBlock,
  Callout,
  WikiLink,
  RichCodeBlock,
]
