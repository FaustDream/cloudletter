/**
 * 常驻通用格式工具栏（BlockNote 0.54 公开命令直连，成熟编辑器通行做法）：
 * 撤销/重做 | H1-H3 | 加粗/斜体/下划线/删除线/行内代码 | 引用 | 无序/有序/待办列表。
 * - 按钮 onMouseDown preventDefault 保持编辑器选区与光标
 * - 激活态跟随光标处的样式（getActiveStyles）与块类型（getTextCursorPosition），
 *   经 onSelectionChange / onEditorContentChange 触发重渲染
 * - 斜杠菜单与选中浮动工具栏（内核内置）继续可用，本栏解决「不知道有格式入口」的可发现性问题
 */
import { useEffect, useState } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'

type Editor = BlockNoteEditor<any, any, any>

export function EditorToolbar({ editor }: { editor: Editor }) {
  const [, setTick] = useState(0)
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

  const toggleBlockType = (type: 'quote' | 'bulletListItem' | 'numberedListItem' | 'checkListItem') => {
    editor.updateBlock(block, { type: block.type === type ? 'paragraph' : type })
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

  return (
    <div className="ed-toolbar" role="toolbar" aria-label="格式工具栏">
      {btn('undo', '撤销（Ctrl+Z）', false, () => editor.undo(), '↶')}
      {btn('redo', '重做（Ctrl+Shift+Z）', false, () => editor.redo(), '↷')}
      <i className="ed-tb-sep" />
      {([1, 2, 3] as const).map((n) =>
        btn(`h${n}`, `${n} 级标题`, block.type === 'heading' && block.props?.level === n, () => setHeading(n), `H${n}`),
      )}
      <i className="ed-tb-sep" />
      {btn('bold', '加粗', Boolean(styles.bold), () => editor.toggleStyles({ bold: true }), <b>B</b>)}
      {btn('italic', '斜体', Boolean(styles.italic), () => editor.toggleStyles({ italic: true }), <i>I</i>)}
      {btn('underline', '下划线', Boolean(styles.underline), () => editor.toggleStyles({ underline: true }), <u>U</u>)}
      {btn('strike', '删除线', Boolean(styles.strike), () => editor.toggleStyles({ strike: true }), <s>S</s>)}
      {btn('code', '行内代码', Boolean(styles.code), () => editor.toggleStyles({ code: true }), <code>{'</>'}</code>)}
      <i className="ed-tb-sep" />
      {btn('quote', '引用块', block.type === 'quote', () => toggleBlockType('quote'), '❝')}
      {btn('bullet', '无序列表', block.type === 'bulletListItem', () => toggleBlockType('bulletListItem'), '•—')}
      {btn('numbered', '有序列表', block.type === 'numberedListItem', () => toggleBlockType('numberedListItem'), '1.')}
      {btn('check', '待办列表', block.type === 'checkListItem', () => toggleBlockType('checkListItem'), '☑')}
    </div>
  )
}
