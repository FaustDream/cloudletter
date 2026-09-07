/**
 * 编辑器块类型扩充（BlockNote 0.54 官方扩展机制）：
 * - Callout 提示框：emoji + 色调高亮卡片；markdown 进出降级为引用块（文本零丢失）
 * - 嵌入网页：B站 / YouTube 自动转内嵌播放器，其余站点渲染链接卡；markdown 存为链接
 * - 代码块语言表（中文显示名）：math → KaTeX 实时预览、mermaid → 图表实时预览（懒加载）
 *   编辑器里仍是 ```math / ```mermaid 围栏源码，与阅读端/导出共享同一 markdown 真相源
 */
import { useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  type CodeBlockPreview,
} from '@blocknote/core'
import katex from 'katex'
import { isLocalVideoUrl, resolveVideoEmbed } from '../../lib/embedUrl'

type Editor = any
type Block = any

/* ═══════════ 代码块：math / mermaid 实时预览 ═══════════ */

const mathPreview: CodeBlockPreview = (block: Block) => {
  const dom = document.createElement('div')
  dom.className = 'code-katex-preview'
  try {
    dom.innerHTML = katex.renderToString(String(block.content ?? ''), {
      throwOnError: false,
      displayMode: true,
    })
  } catch (e) {
    dom.textContent = '公式渲染失败'
  }
  return { dom }
}

let mermaidSeq = 0
const mermaidPreview: CodeBlockPreview = (block: Block) => {
  const dom = document.createElement('div')
  dom.className = 'code-mermaid-preview'
  const holder = document.createElement('div')
  holder.className = 'code-mermaid-loading'
  holder.textContent = '图表渲染中…'
  dom.appendChild(holder)
  void (async () => {
    try {
      const { default: mermaid } = await import('mermaid')
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default',
      })
      const { svg } = await mermaid.render(`cl-mmd-${Date.now()}-${mermaidSeq++}`, String(block.content ?? ''))
      holder.innerHTML = svg
      holder.classList.remove('code-mermaid-loading')
    } catch (e: any) {
      holder.classList.add('code-mermaid-err')
      holder.textContent = e?.message ? `图表语法错误：${e.message}` : '图表语法错误'
    }
  })()
  return { dom }
}

/** 代码块语言表：中文名 + 常用别名；math/mermaid 挂实时预览 */
const SUPPORTED_LANGUAGES: Record<string, { name: string; aliases?: string[]; createPreview?: CodeBlockPreview }> = {
  text: { name: '纯文本' },
  javascript: { name: 'JavaScript', aliases: ['js', 'node'] },
  typescript: { name: 'TypeScript', aliases: ['ts'] },
  python: { name: 'Python', aliases: ['py'] },
  java: { name: 'Java' },
  c: { name: 'C' },
  cpp: { name: 'C++', aliases: ['c++'] },
  csharp: { name: 'C#', aliases: ['cs', 'c#'] },
  go: { name: 'Go', aliases: ['golang'] },
  rust: { name: 'Rust', aliases: ['rs'] },
  php: { name: 'PHP' },
  ruby: { name: 'Ruby', aliases: ['rb'] },
  swift: { name: 'Swift' },
  kotlin: { name: 'Kotlin', aliases: ['kt'] },
  sql: { name: 'SQL' },
  html: { name: 'HTML', aliases: ['xml'] },
  css: { name: 'CSS' },
  json: { name: 'JSON' },
  yaml: { name: 'YAML', aliases: ['yml'] },
  bash: { name: 'Shell', aliases: ['sh', 'shell', 'zsh'] },
  markdown: { name: 'Markdown', aliases: ['md'] },
  diff: { name: 'Diff', aliases: ['patch'] },
  math: { name: '数学公式', aliases: ['latex', 'tex', 'katex'], createPreview: mathPreview },
  mermaid: { name: '流程图', aliases: ['graph', 'diagram'], createPreview: mermaidPreview },
}

/* ═══════════ Callout 提示框 ═══════════ */

const CALLOUT_EMOJIS = ['💡', '⚠️', '✅', 'ℹ️', '🔥', '📌', '❓', '🎯']
const CALLOUT_TONES = ['blue', 'green', 'yellow', 'red', 'gray', 'purple'] as const

const CalloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: {
      emoji: { default: '💡' },
      tone: { default: 'blue', values: [...CALLOUT_TONES] },
    },
    content: 'inline',
  },
  {
    render: ({ block, editor, contentRef }) => (
      <CalloutView block={block} editor={editor} contentRef={contentRef} />
    ),
    // markdown 出口：引用块 + 加粗 emoji 前缀（重开文章时表现为引用，文本不丢）
    toExternalHTML: ({ block, contentRef }) => (
      <blockquote className="cl-callout-export">
        <p>
          <strong>{block.props.emoji} </strong>
          <span ref={contentRef} />
        </p>
      </blockquote>
    ),
  },
)

function CalloutView({ block, editor, contentRef }: {
  block: Block
  editor: Editor
  contentRef: (node: HTMLElement | null) => void
}) {
  const [picking, setPicking] = useState(false)
  const setProps = (patch: Record<string, unknown>) => editor.updateBlock(block, { props: patch })
  return (
    <div className="cl-callout" data-tone={block.props.tone}>
      <button
        className="cl-callout-emoji"
        title="点击更换图标"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setPicking((v) => !v)}
      >
        {block.props.emoji}
      </button>
      {picking && (
        <div className="cl-callout-picker" onMouseLeave={() => setPicking(false)}>
          {CALLOUT_EMOJIS.map((e) => (
            <button key={e} className={e === block.props.emoji ? 'on' : ''}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => { setProps({ emoji: e }); setPicking(false) }}>
              {e}
            </button>
          ))}
          <span className="cl-callout-picker-sep" />
          {CALLOUT_TONES.map((t) => (
            <button key={t} className={`cl-callout-tone t-${t}${t === block.props.tone ? ' on' : ''}`}
              title={`色调·${t}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => setProps({ tone: t })} />
          ))}
        </div>
      )}
      <div className="cl-callout-content" ref={contentRef} />
    </div>
  )
}

/* ═══════════ 嵌入网页（在线视频 / 链接卡 / 本地视频） ═══════════ */

const EmbedBlock = createReactBlockSpec(
  {
    type: 'embed',
    propSchema: { url: { default: '' } },
    content: 'none',
  },
  {
    render: ({ block, editor }) => <EmbedView block={block} editor={editor} />,
    // markdown 出口：存为普通链接（阅读端 linkify 可识别）
    toExternalHTML: ({ block }) =>
      block.props.url ? <p><a href={block.props.url}>{block.props.url}</a></p> : <p />,
  },
)

const EMBED_HOST_LABEL: Record<string, string> = {
  youtube: 'YouTube 视频', bilibili: 'B站视频', youku: '优酷视频', qqvideo: '腾讯视频', local: '本地视频',
}

function EmbedView({ block, editor }: { block: Block; editor: Editor }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const url: string = block.props.url
  const embed = url ? resolveVideoEmbed(url) : null
  let host = ''
  try { host = url ? new URL(url).hostname : '' } catch { host = '' }

  if (!url || editing) {
    return (
      <div className="cl-embed cl-embed-setup">
        <span className="cl-embed-badge">嵌入</span>
        <input
          autoFocus
          value={draft}
          placeholder="粘贴视频/B站/YouTube/网页链接，或本地上传的视频地址…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              editor.updateBlock(block, { props: { url: draft.trim() } })
              setEditing(false)
            }
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <button className="cl-embed-btn primary" disabled={!draft.trim()}
          onClick={() => { if (draft.trim()) { editor.updateBlock(block, { props: { url: draft.trim() } }); setEditing(false) } }}>
          确定
        </button>
        {url && <button className="cl-embed-btn" onClick={() => setEditing(false)}>取消</button>}
      </div>
    )
  }

  // 本地视频（自建图床）：<video controls> 直接播放
  if (isLocalVideoUrl(url)) {
    return (
      <div className="cl-embed cl-embed-local">
        <video className="cl-embed-player" src={url} controls preload="metadata" playsInline />
        <div className="cl-embed-ops">
          <button onClick={() => { setDraft(url); setEditing(true) }}>更换链接</button>
        </div>
      </div>
    )
  }

  // 在线视频：iframe 内嵌播放器直接播放
  if (embed) {
    return (
      <div className="cl-embed">
        <iframe
          className="cl-embed-player"
          src={embed.src}
          title={EMBED_HOST_LABEL[embed.host] ?? '嵌入视频'}
          allowFullScreen
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
        <div className="cl-embed-ops">
          <button onClick={() => { setDraft(url); setEditing(true) }}>更换链接</button>
        </div>
      </div>
    )
  }

  // 其余站点：链接卡片
  return (
    <div className="cl-embed">
      <a className="cl-embed-card" href={url} target="_blank" rel="noreferrer noopener">
        <span className="cl-embed-badge">链接</span>
        <span className="cl-embed-info">
          <b>{host || url}</b>
          <em>{url}</em>
        </span>
      </a>
      <div className="cl-embed-ops">
        <button onClick={() => { setDraft(url); setEditing(true) }}>更换链接</button>
      </div>
    </div>
  )
}

/* ═══════════ Schema：默认块 + 增强代码块 + 自定义块 ═══════════ */

/**
 * 列表标记样式 prop：非默认值会渲染为 .bn-block-content 的 data-list-style 属性（CSS 生效），
 * markdown 真相源经 BlockNoteEditor 的注释桥（lib/listStyles）持久化
 */
function patchListSchemas() {
  const stock = { ...defaultBlockSpecs } as Record<string, { config?: { propSchema?: Record<string, unknown> } }>
  for (const [type, def] of [['bulletListItem', 'disc'], ['numberedListItem', 'decimal']] as const) {
    const spec = stock[type]
    if (spec?.config?.propSchema) spec.config.propSchema = { ...spec.config.propSchema, listStyle: { default: def } }
  }
  return stock as typeof defaultBlockSpecs
}

export const editorSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...patchListSchemas(),
    codeBlock: createCodeBlockSpec({ defaultLanguage: 'text', supportedLanguages: SUPPORTED_LANGUAGES }),
    callout: CalloutBlock(),
    embed: EmbedBlock(),
  },
})

/**
 * 代码块语言归一：别名（ts/js/py…）→ 规范 id（typescript/javascript/python…）。
 * BlockNote 只在键盘输入围栏时做别名解析（input rule），markdown 解析回灌时语言原样
 * 落到 block.props.language，若落在别名或未收录语言上，createLanguageSelect 渲染会
 * 抛 "Language xxx is not supported"。所有解析路径统一经由本函数归一；未收录语言
 * 降级为 text（避免崩溃，语言可在下拉里手动改回）
 */
export function canonicalCodeLanguage(lang: string): string {
  const normalized = lang.trim().toLowerCase()
  const hit = Object.entries(SUPPORTED_LANGUAGES).find(
    ([id, { aliases }]) =>
      id.toLowerCase() === normalized ||
      aliases?.some((a) => a.toLowerCase() === normalized),
  )
  return hit?.[0] ?? 'text'
}

/** 递归遍历解析出的块，把代码块语言归一到规范 id（含列表等嵌套块） */
export function normalizeCodeLanguages(blocks: any[]): any[] {
  for (const b of blocks) {
    if (b?.type === 'codeBlock' && b?.props && typeof b.props.language === 'string') {
      b.props.language = canonicalCodeLanguage(b.props.language)
    }
    if (Array.isArray(b?.content) && b.content.length && typeof b.content[0] === 'object') {
      normalizeCodeLanguages(b.content)
    }
  }
  return blocks
}
