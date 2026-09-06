/**
 * 常驻通用格式工具栏（BlockNote 0.54 公开命令直连，成熟编辑器通行做法）：
 * 撤销/重做 | H1-H3 | 加粗/斜体/下划线/删除线/行内代码 | 文字颜色/背景色 | 引用/列表 |
 * 双链（选区包 [[ ]]）/ 识别双链（全文标题→双链）/ 一键排版（序号行→标题，自动出大纲）|
 * 链接 / 图片 / 表格 / 分隔线 / 代码块 / 提示框 / 嵌入网页
 * - 按钮 onMouseDown preventDefault 保持编辑器选区与光标
 * - 激活态跟随光标处的样式（getActiveStyles）与块类型（getTextCursorPosition）
 * - 文档级变换（识别双链/一键排版）走 markdown 往返 + replaceBlocks（Ctrl+Z 可撤销）
 */
import { useEffect, useRef, useState } from 'react'
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { autoFormatMarkdown, recognizeWikilinksInMarkdown } from '../../lib/docTransforms'
import { applyDocTransform, createWikilink, selectedEditorText } from './docActions'

type Editor = BlockNoteEditor<any, any, any>

const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'default'] as const

export function EditorToolbar({ editor, titles, currentTitle, onImageUpload, notify }: {
  editor: Editor
  /** 全站文章标题（识别双链候选） */
  titles?: string[]
  /** 当前文章标题（识别双链时排除自身） */
  currentTitle?: string
  /** 图片上传：返回可访问 URL */
  onImageUpload?: (file: File) => Promise<string | null>
  /** 轻提示（ EditorPage 的 toast） */
  notify?: (message: string, kind?: 'ok' | 'err') => void
}) {
  const [, setTick] = useState(0)
  const [colorOpen, setColorOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    const offSel = editor.onSelectionChange(bump)
    // onEditorContentChange 无退订（随 editor 实例存活）；组件卸载后 setState 为无害空操作
    editor.onEditorContentChange(bump)
    return offSel
  }, [editor])

  const cursor = editor.getTextCursorPosition()
  const block = cursor.block
  const styles = editor.getActiveStyles()

  const setHeading = (n: number) => {
    if (block.type === 'heading' && block.props.level === n) editor.updateBlock(block, { type: 'paragraph' })
    else editor.updateBlock(block, { type: 'heading', props: { level: n } })
  }

  const toggleBlockType = (type: 'quote' | 'bulletListItem' | 'numberedListItem' | 'checkListItem' | 'codeBlock' | 'callout' | 'embed') => {
    editor.updateBlock(block, { type: block.type === type ? 'paragraph' : type })
  }

  /** 选中文字（DOM Selection 即编辑器选区；无选区返回空并提示） */
  const selectedText = (): string => {
    const text = selectedEditorText()
    if (!text) notify?.('请先选中要处理的文字', 'err')
    return text
  }

  /** 文档级变换：markdown 往返 + replaceBlocks（事务提交，Ctrl+Z 可整体撤销） */
  const applyTransform = async (label: string, fn: (md: string) => { md: string; count: number }) => {
    const n = await applyDocTransform(editor, fn)
    notify?.(n < 0 ? `${label}：没有需要处理的内容` : `${label}：已处理 ${n} 处（Ctrl+Z 可撤销）`)
  }

  const insertAfter = (partial: PartialBlock<any>) => {
    editor.insertBlocks([partial], block, 'after')
  }

  const btn = (key: string, title: string, active: boolean, onClick: () => void, label: React.ReactNode) => (
    <button
      key={key}
      type="button"
      className={`ed-tb-btn${active ? ' on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  )

  const colorRow = (field: 'textColor' | 'backgroundColor', label: string) => (
    <div className="ed-tb-color-row">
      <span>{label}</span>
      {TEXT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`ed-tb-swatch${styles[field] === c ? ' on' : ''}`}
          style={{ background: c === 'default' ? 'var(--surface-card)' : COLOR_HEX[c] }}
          title={`${label}·${c}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.toggleStyles({ [field]: c })}
        />
      ))}
    </div>
  )

  return (
    <div className="ed-toolbar" role="toolbar" aria-label="格式工具栏">
      {btn('undo', '撤销（Ctrl+Z）', false, () => editor.undo(), '↶')}
      {btn('redo', '重做（Ctrl+Shift+Z）', false, () => editor.redo(), '↷')}
      <i className="ed-tb-sep" />
      {([1, 2, 3] as const).map((n) =>
        btn(`h${n}`, `${n} 级标题`, block.type === 'heading' && block.props.level === n, () => setHeading(n), `H${n}`),
      )}
      <i className="ed-tb-sep" />
      {btn('bold', '加粗', Boolean(styles.bold), () => editor.toggleStyles({ bold: true }), <b>B</b>)}
      {btn('italic', '斜体', Boolean(styles.italic), () => editor.toggleStyles({ italic: true }), <i>I</i>)}
      {btn('underline', '下划线', Boolean(styles.underline), () => editor.toggleStyles({ underline: true }), <u>U</u>)}
      {btn('strike', '删除线', Boolean(styles.strike), () => editor.toggleStyles({ strike: true }), <s>S</s>)}
      {btn('code', '行内代码', Boolean(styles.code), () => editor.toggleStyles({ code: true }), <code>{'</>'}</code>)}
      <div className="ed-tb-colors">
        {btn('color', '文字颜色 / 背景色', colorOpen, () => setColorOpen((v) => !v), <span className="ed-tb-color-ico">A</span>)}
        {colorOpen && (
          <>
            <div className="ed-tb-color-mask" onClick={() => setColorOpen(false)} />
            <div className="ed-tb-color-pop">
              {colorRow('textColor', '文字')}
              {colorRow('backgroundColor', '背景')}
            </div>
          </>
        )}
      </div>
      <i className="ed-tb-sep" />
      {btn('quote', '引用块', block.type === 'quote', () => toggleBlockType('quote'), '❝')}
      {btn('bullet', '无序列表', block.type === 'bulletListItem', () => toggleBlockType('bulletListItem'), '•—')}
      {btn('numbered', '有序列表', block.type === 'numberedListItem', () => toggleBlockType('numberedListItem'), '1.')}
      {btn('check', '待办列表', block.type === 'checkListItem', () => toggleBlockType('checkListItem'), '☑')}
      <i className="ed-tb-sep" />
      {btn('wikilink', '双链：选中文字→包裹；未选中→插入 [[ 并唤起文章补全，点选即完成', false, () => {
        const r = createWikilink(editor)
        notify?.(r === 'wrapped' ? '已转为双链' : '已插入 [[ ：输入标题过滤，或从补全列表点选文章')
      }, <span className="ed-tb-wl">[[ ]]</span>)}
      {btn('recognize', '识别双链：把正文里出现的其他文章标题自动包成 [[ ]]', false, () => {
        void applyTransform('识别双链', (md) => recognizeWikilinksInMarkdown(md, titles ?? [], { exclude: currentTitle }))
      }, '识别双链')}
      {btn('autoformat', '一键排版：把「第一章 / 一、 / 1、」等序号行转为标题，自动生成大纲', false, () => {
        void applyTransform('一键排版', autoFormatMarkdown)
      }, '一键排版')}
      <i className="ed-tb-sep" />
      {btn('link', '插入链接（先选中文字）', false, () => {
        const text = selectedText()
        if (!text) return
        const url = window.prompt('链接地址（URL）：')
        if (url?.trim()) editor.createLink(url.trim())
      }, '🔗')}
      {btn('image', '插入图片（上传到服务器图床）', false, () => fileRef.current?.click(), '🖼')}
      {btn('table', '插入表格', false, () => insertAfter({
        type: 'table',
        content: { type: 'tableContent', rows: [{ cells: ['', ''] }, { cells: ['', ''] }] },
      } as any), '⊞')}
      {btn('divider', '插入分隔线', false, () => insertAfter({ type: 'divider' } as any), '—')}
      {btn('codeblock', '代码块', block.type === 'codeBlock', () => toggleBlockType('codeBlock'), '{ }')}
      {btn('callout', '提示框', block.type === 'callout', () => toggleBlockType('callout'), '💡')}
      {btn('embed', '嵌入网页（B站/YouTube/链接卡）', block.type === 'embed', () => toggleBlockType('embed'), '🌐')}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f || !onImageUpload) return
          void Promise.resolve(onImageUpload(f)).then((url) => {
            if (url) { insertAfter({ type: 'image', props: { url } } as any); notify?.('图片已插入') }
            else notify?.('图片上传失败', 'err')
          })
        }}
      />
    </div>
  )
}

const COLOR_HEX: Record<string, string> = {
  red: '#e0483d', orange: '#e0791f', yellow: '#ddb42e', green: '#3aa052',
  blue: '#3b82d6', purple: '#8b5cf6', default: '#8a8f98',
}
