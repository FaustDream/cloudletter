/**
 * 文章导出（Markdown / 自包含 HTML / 打印·PDF）：
 * - Markdown：原文下载，零转换
 * - HTML：renderMarkdown（含 math/mermaid 围栏规则）+ 独立排版样式 + 封面/分类/标签元信息，
 *   单文件即可在外部浏览器打开；math 附 KaTeX CDN 样式、mermaid 附 CDN 渲染脚本
 * - 打印·PDF：同一 HTML 经隐藏 iframe 唤起浏览器打印（另存为 PDF），不动当前页面
 */
import { renderMarkdown, hasMathFence, hasMermaidFence } from './markdown'

export interface ExportMeta {
  title: string
  summary?: string
  category?: string
  tags?: string[]
  cover?: string
  /** 展示日期（ISO 或任意字符串） */
  date?: string
}

/** 文件名安全化：去路径分隔/控制符，空标题回退 */
export function sanitizeFilename(name: string): string {
  const s = (name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim()
  return (s || '无标题').slice(0, 80)
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 导出 Markdown：正文原样下载 */
export function exportMarkdownFile(meta: ExportMeta, markdown: string): void {
  downloadBlob(`${sanitizeFilename(meta.title)}.md`, new Blob([markdown || ''], { type: 'text/markdown;charset=utf-8' }))
}

/** 导出用正文 HTML（阅读端同源渲染） */
function bodyHtml(markdown: string): string {
  return renderMarkdown(markdown)
}

/** 独立 HTML 文档：排版样式内联，可选附 KaTeX / mermaid CDN 资源 */
export function buildPostHtml(meta: ExportMeta, markdown: string): string {
  const esc = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const tags = (meta.tags ?? []).filter(Boolean)
  const date = meta.date ? esc(meta.date.slice(0, 10)) : ''
  const katexCss = hasMathFence(markdown)
    ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">'
    : ''
  const mermaidScript = hasMermaidFence(markdown)
    ? `<script type="module">
         import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
         mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
         await mermaid.run({ querySelector: '.md-mermaid pre' });
       </script>`
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)}</title>
${katexCss}
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef1f6; color: #1f2430;
    font-family: -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    line-height: 1.75; }
  .paper { max-width: 800px; margin: 32px auto 48px; background: #fff; border-radius: 14px;
    box-shadow: 0 6px 24px rgba(40,60,100,.08); padding: 56px 64px; }
  h1.doc-title { font-size: 32px; line-height: 1.3; margin: 0 0 10px; }
  .doc-meta { color: #6b7280; font-size: 13px; margin-bottom: 8px; }
  .doc-meta .sep { margin: 0 8px; opacity: .5; }
  .doc-tag { display: inline-block; background: #eef2ff; color: #4f6ef2; border-radius: 999px;
    padding: 1px 10px; font-size: 12px; margin-right: 6px; }
  .doc-cover { width: 100%; border-radius: 10px; margin: 18px 0 6px; }
  h1, h2, h3, h4 { line-height: 1.35; margin: 1.4em 0 .6em; }
  h1 { font-size: 26px; } h2 { font-size: 22px; } h3 { font-size: 18px; }
  p { margin: .8em 0; }
  blockquote { margin: 1em 0; padding: 10px 18px; border-left: 4px solid #c9d6f5;
    background: #f6f8fd; border-radius: 0 10px 10px 0; color: #3c4658; }
  code { background: #f1f3f8; border-radius: 5px; padding: 2px 6px; font-size: .9em;
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
  pre { background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 16px 18px;
    overflow: auto; line-height: 1.6; }
  pre code { background: transparent; color: inherit; padding: 0; }
  img { max-width: 100%; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #dfe3ec; padding: 7px 12px; }
  th { background: #f6f8fd; }
  hr { border: none; border-top: 1px solid #e3e7f0; margin: 2em 0; }
  a { color: #3f6ae0; }
  .md-katex { overflow-x: auto; padding: 4px 0; }
  .md-mermaid { text-align: center; margin: 1.2em 0; }
  .md-mermaid pre { background: #f6f8fd; color: #1f2430; display: inline-block; text-align: left; }
  @media print {
    body { background: #fff; }
    .paper { box-shadow: none; margin: 0; max-width: none; padding: 12mm 8mm; border-radius: 0; }
    .cl-embed-player, iframe { display: none; }
  }
  @media (max-width: 720px) { .paper { margin: 0; border-radius: 0; padding: 28px 20px; } }
</style>
</head>
<body>
<article class="paper">
  <h1 class="doc-title">${esc(meta.title)}</h1>
  <div class="doc-meta">
    ${meta.category ? `<span>${esc(meta.category)}</span><span class="sep">·</span>` : ''}${date ? `<span>${date}</span>` : ''}
    ${tags.length ? `<div style="margin-top:6px">${tags.map((t) => `<span class="doc-tag">#${esc(t)}</span>`).join('')}</div>` : ''}
  </div>
  ${meta.cover ? `<img class="doc-cover" src="${esc(meta.cover)}" alt="cover">` : ''}
  <div class="doc-body">
${bodyHtml(markdown)}
  </div>
</article>
${mermaidScript}
</body>
</html>`
}

/** 导出 HTML 文件 */
export function exportHtmlFile(meta: ExportMeta, markdown: string): void {
  const html = buildPostHtml(meta, markdown)
  downloadBlob(`${sanitizeFilename(meta.title)}.html`, new Blob([html], { type: 'text/html;charset=utf-8' }))
}

/** 打印 / 另存为 PDF：隐藏 iframe 加载同一 HTML 后唤起系统打印 */
export function printPost(meta: ExportMeta, markdown: string): void {
  const old = document.querySelectorAll('iframe.cl-print-frame')
  old.forEach((n) => n.remove())
  const iframe = document.createElement('iframe')
  iframe.className = 'cl-print-frame'
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;'
  iframe.srcdoc = buildPostHtml(meta, markdown)
  iframe.onload = () => {
    const win = iframe.contentWindow
    if (!win) return
    const cleanup = () => setTimeout(() => iframe.remove(), 800)
    try {
      win.addEventListener('afterprint', cleanup)
      win.focus()
      win.print()
      setTimeout(cleanup, 120_000) // 打印弹窗被忽略时的兜底清理
    } catch (e) {
      iframe.remove()
      throw e
    }
  }
  document.body.appendChild(iframe)
}
