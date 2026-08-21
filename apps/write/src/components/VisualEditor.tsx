/**
 * 可视化编辑器（§8.1 Tiptap 双模之可视化侧）：
 * 与源码模式共用同一 Markdown 契约——进入时由 tiptap-markdown 解析，
 * 编辑时经 storage.markdown 序列化回写。富块渲染为 React 卡片（NodeView）。
 */
import { useState } from 'react'
import {
  EditorContent,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  useEditor,
  type NodeViewProps,
} from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import {
  ApiBlock,
  ParamsBlock,
  Callout,
  WikiLink,
  RichCodeBlock,
  MarkdownItRichRules,
} from '../editor/richBlocks'
import { parseScalarListBody } from '../lib/serializer'
import { ApiCard, ParamsCard } from './Preview'

/** 接口卡片 NodeView：结构化卡片展示 + YAML 源码编辑切换 */
function ApiBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false)
  const yaml = node.attrs.yaml as string
  const block = parseScalarListBody(yaml, 'api')
  return (
    <NodeViewWrapper as="div" className={`atom-view ${selected ? 'selected' : ''}`}>
      {editing ? (
        <div className="atom-edit">
          <textarea
            value={yaml}
            onChange={(e) => updateAttributes({ yaml: e.target.value })}
            rows={Math.max(6, yaml.split('\n').length + 1)}
            spellCheck={false}
          />
          <button className="btn slim" onClick={() => setEditing(false)}>
            完成编辑
          </button>
        </div>
      ) : (
        <div className="atom-card-wrap">
          {block.t === 'api' ? <ApiCard block={block} /> : <pre className="atom-fallback">{yaml}</pre>}
          <button
            contentEditable={false}
            className="btn slim atom-edit-btn"
            onClick={() => setEditing(true)}
          >
            编辑源码
          </button>
        </div>
      )}
    </NodeViewWrapper>
  )
}

/** 参数表卡片 NodeView */
function ParamsBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false)
  const yaml = node.attrs.yaml as string
  const block = parseScalarListBody(yaml, 'params')
  return (
    <NodeViewWrapper as="div" className={`atom-view ${selected ? 'selected' : ''}`}>
      {editing ? (
        <div className="atom-edit">
          <textarea
            value={yaml}
            onChange={(e) => updateAttributes({ yaml: e.target.value })}
            rows={Math.max(6, yaml.split('\n').length + 1)}
            spellCheck={false}
          />
          <button className="btn slim" onClick={() => setEditing(false)}>
            完成编辑
          </button>
        </div>
      ) : (
        <div className="atom-card-wrap">
          {block.t === 'params' ? <ParamsCard block={block} /> : <pre className="atom-fallback">{yaml}</pre>}
          <button
            contentEditable={false}
            className="btn slim atom-edit-btn"
            onClick={() => setEditing(true)}
          >
            编辑源码
          </button>
        </div>
      )}
    </NodeViewWrapper>
  )
}

// 带卡片视图的节点（addNodeView 必须在扩展上声明）
const ApiBlockWithView = ApiBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ApiBlockView)
  },
})
const ParamsBlockWithView = ParamsBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ParamsBlockView)
  },
})

export function VisualEditor({
  markdown,
  onChange,
}: {
  markdown: string
  onChange: (v: string) => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // 由 RichCodeBlock 接管（title/行高亮）
      }),
      MarkdownItRichRules,
      ApiBlockWithView,
      ParamsBlockWithView,
      Callout,
      WikiLink,
      RichCodeBlock,
      Markdown.configure({
        // 🟡W2 修复：本应用只用受控的 ```api/params/callout/wiki``` 语法，无需原生 HTML。
        // html:false 避免原始 HTML 进入序列化后的 Markdown 契约，消除存储型 XSS 风险面。
        html: false,
        linkify: false,
        breaks: false,
        transformPastedText: true, // 粘贴 Markdown 直接解析为富文本
      }),
    ],
    content: markdown,
    onUpdate: ({ editor }) => {
      const storage = editor.storage as unknown as {
        markdown: { getMarkdown: () => string }
      }
      onChange(storage.markdown.getMarkdown())
    },
  })

  if (!editor) return <div className="boot">编辑器载入中…</div>

  return (
    <div className="visual-editor">
      <EditorContent editor={editor} />
    </div>
  )
}
