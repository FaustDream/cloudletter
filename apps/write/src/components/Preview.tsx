/**
 * 预览渲染：Markdown → Block[]（序列化器）→ 富块卡片 + markdown-it 正文
 * 与前台 §5.2 渲染语义一致：接口卡片 / 参数表 / 提示框 / 双链 / 代码块
 */
import { useMemo } from 'react'
import MarkdownIt from 'markdown-it'
import { parse, type Block } from '../lib/serializer'

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

/** 行内双链 [[目标|显示]] → 样式化 span */
function renderWikilinks(html: string): string {
  return html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
    return `<span class="wikilink" title="${target}">${label || target}</span>`
  })
}

const METHOD_COLOR: Record<string, string> = {
  GET: 'var(--ok)',
  POST: 'var(--warn)',
  PUT: '#a98bff',
  PATCH: '#5ad1ff',
  DELETE: 'var(--bad)',
}

export function ApiCard({ block }: { block: Extract<Block, { t: 'api' }> }) {
  return (
    <div className="api-card">
      <div className="api-head">
        <span className="api-method" style={{ color: METHOD_COLOR[block.method] ?? 'var(--neon)' }}>
          {block.method}
        </span>
        <code className="api-path">{block.path}</code>
      </div>
      {block.summary && <div className="api-summary">{block.summary}</div>}
      {block.params.length > 0 && (
        <table className="param-table">
          <thead>
            <tr>
              <th>参数</th>
              <th>位置</th>
              <th>类型</th>
              <th>必填</th>
              <th>默认</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            {block.params.map((p, i) => (
              <tr key={i}>
                <td className="mono">{p.name}</td>
                <td>{p.in ?? '—'}</td>
                <td className="mono">{p.type}</td>
                <td>{p.required ? <span className="req">是</span> : '否'}</td>
                <td className="mono">{p.default ?? '—'}</td>
                <td>{p.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {block.responses.map((r, i) => (
        <div key={i} className="api-resp">
          <div className="api-resp-head">
            <span className={`status-badge ${r.status < 400 ? 'ok' : 'bad'}`}>{r.status}</span>
            <span>{r.desc}</span>
          </div>
          {r.body && (
            <pre className="api-body">
              <code>{r.body}</code>
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

export function ParamsCard({ block }: { block: Extract<Block, { t: 'params' }> }) {
  return (
    <table className="param-table standalone">
      <thead>
        <tr>
          <th>参数</th>
          <th>类型</th>
          <th>必填</th>
          <th>默认</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        {block.params.map((p, i) => (
          <tr key={i}>
            <td className="mono">{p.name}</td>
            <td className="mono">{p.type}</td>
            <td>{p.required ? <span className="req">是</span> : '否'}</td>
            <td className="mono">{p.default ?? '—'}</td>
            <td>{p.desc}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const CALLOUT_META: Record<string, { icon: string; label: string }> = {
  note: { icon: 'ℹ', label: '说明' },
  tip: { icon: '✦', label: '技巧' },
  warning: { icon: '⚠', label: '注意' },
  danger: { icon: '⛔', label: '危险' },
}

function Callout({ block }: { block: Extract<Block, { t: 'callout' }> }) {
  const meta = CALLOUT_META[block.kind]
  return (
    <div className={`callout ${block.kind}`}>
      <div className="callout-head">
        <span className="callout-icon">{meta.icon}</span>
        {meta.label}
      </div>
      <div dangerouslySetInnerHTML={{ __html: renderWikilinks(md.render(block.text)) }} />
    </div>
  )
}

function CodeCard({ block }: { block: Extract<Block, { t: 'code' }> }) {
  const marks = new Set(block.marks ?? [])
  const copy = () => navigator.clipboard?.writeText(block.lines.join('\n'))
  return (
    <div className="code-card">
      <div className="code-titlebar">
        <span className="traffic">
          <i /> <i /> <i />
        </span>
        <span className="code-title">{block.title ?? block.lang}</span>
        <button className="code-copy" onClick={copy}>
          复制
        </button>
      </div>
      <pre className="code-body">
        <code>
          {block.lines.map((l, i) => (
            <div key={i} className={`code-line ${marks.has(i + 1) ? 'marked' : ''}`}>
              {l === '' ? ' ' : l}
            </div>
          ))}
        </code>
      </pre>
    </div>
  )
}

export function Preview({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parse(markdown), [markdown])
  return (
    <div className="preview">
      {blocks
        .filter((b) => b.t !== 'frontmatter')
        .map((b, i) => {
          switch (b.t) {
            case 'api':
              return <ApiCard key={i} block={b} />
            case 'params':
              return <ParamsCard key={i} block={b} />
            case 'callout':
              return <Callout key={i} block={b} />
            case 'code':
              return <CodeCard key={i} block={b} />
            case 'text':
              return (
                <div
                  key={i}
                  className="md-text"
                  dangerouslySetInnerHTML={{ __html: renderWikilinks(md.render(b.md)) }}
                />
              )
            default:
              return null
          }
        })}
    </div>
  )
}
