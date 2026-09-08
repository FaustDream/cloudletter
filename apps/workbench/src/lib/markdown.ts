/**
 * 全站共享 Markdown 渲染出口（阅读视图 / 导出 HTML 共用同一套规则）：
 * - markdown-it（html:false 防注入）+ linkify + breaks，与旧 MarkdownView 行为一致
 * - ```math / ```latex 围栏 → KaTeX 静态公式（displayMode，导出文件也无需 JS）
 * - ```mermaid 围栏 → 占位 <div class="md-mermaid">：阅读端懒加载 mermaid 水合，
 *   导出 HTML 附 CDN 脚本渲染（见 lib/exporters.ts）
 */
import MarkdownIt from 'markdown-it'
import katex from 'katex'

export const md: MarkdownIt = new MarkdownIt({ html: false, linkify: true, breaks: true })

// RenderRule 定义在 @types/markdown-it 的 namespace 内：用实例类型索引取型，规避 default import 的 TS2702
const defaultFence: NonNullable<MarkdownIt['renderer']['rules']['fence']> =
  md.renderer.rules.fence ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const lang = (token.info || '').trim().toLowerCase()
  if (lang === 'math' || lang === 'latex' || lang === 'tex') {
    try {
      return `<div class="md-katex">${katex.renderToString(token.content, { throwOnError: false, displayMode: true })}</div>`
    } catch {
      return `<pre><code class="language-text">${md.utils.escapeHtml(token.content)}</code></pre>`
    }
  }
  if (lang === 'mermaid') {
    return `<div class="md-mermaid"><pre>${md.utils.escapeHtml(token.content)}</pre></div>`
  }
  return defaultFence(tokens, idx, options, env, self)
}

/** Markdown → HTML（阅读视图与导出统一出口；空内容返回空串） */
export function renderMarkdown(src: string): string {
  const s = (src || '').trim()
  if (!s) return ''
  return md.render(s)
}

/** 是否包含数学公式围栏（导出 HTML 决定是否附 KaTeX 样式） */
export function hasMathFence(src: string): boolean {
  return /```+\s*(math|latex|tex)\b/i.test(src || '')
}

/** 是否包含 mermaid 围栏（导出 HTML 决定是否附渲染脚本） */
export function hasMermaidFence(src: string): boolean {
  return /```+\s*mermaid\b/i.test(src || '')
}
