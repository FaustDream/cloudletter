/**
 * Markdown 只读渲染（详情侧栏 / 访客视图统一出口）：
 * - 共享渲染层 lib/markdown.ts（markdown-it + math/mermaid 围栏规则）
 * - mermaid 占位块在挂载后懒加载 mermaid 水合为 SVG；空内容给占位文案。
 */
import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '../../lib/markdown'
import 'katex/dist/katex.min.css'

export function MarkdownView({ value, empty = '（暂无内容）' }: { value: string; empty?: string }) {
  const html = useMemo(() => renderMarkdown(value), [value])
  const rootRef = useRef<HTMLDivElement>(null)

  // mermaid 水合：把 <div class="md-mermaid"><pre>源码</pre></div> 替换为渲染后的 SVG
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.md-mermaid > pre'))
    if (nodes.length === 0) return
    let cancelled = false
    void (async () => {
      try {
        const { default: mermaid } = await import('mermaid')
        if (cancelled) return
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
        })
        for (let i = 0; i < nodes.length; i++) {
          const pre = nodes[i]
          const src = pre.textContent ?? ''
          const holder = document.createElement('div')
          holder.className = 'md-mermaid-svg'
          try {
            const { svg } = await mermaid.render(`mdview-mmd-${Date.now()}-${i}`, src)
            holder.innerHTML = svg
          } catch (e) {
            holder.classList.add('md-mermaid-err')
            holder.textContent = '图表语法错误'
          }
          pre.replaceWith(holder)
        }
      } catch (e) {
        console.error('[MarkdownView] mermaid 加载失败', e)
      }
    })()
    return () => { cancelled = true }
  }, [html])

  if (!html) return <div className="mdview empty">{empty}</div>
  return <div className="mdview" ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
}
