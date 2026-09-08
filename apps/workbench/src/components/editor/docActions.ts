/**
 * 编辑器动作（工具栏 / 右键菜单共用）：
 * - applyDocTransform：文档级变换（识别双链/一键排版）= markdown 往返 + replaceBlocks，
 *   事务提交，Ctrl+Z 可整体撤销；返回处理处数（-1 表示无变化）
 * - createWikilink：一键创建双链——有选区→把选区包成 [[选区]]；无选区→插入 [[ 触发符，
 *   唤起文章补全菜单（点选即完成，或直接输入标题）
 */
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { normalizeCodeLanguages } from './customBlocks'

type Editor = BlockNoteEditor<any, any, any>

export async function applyDocTransform(
  editor: Editor,
  fn: (md: string) => { md: string; count: number },
): Promise<number> {
  const md = await editor.blocksToMarkdownLossy(editor.document)
  const { md: next, count } = fn(md)
  if (!count) return -1
  const blocks = normalizeCodeLanguages(await editor.tryParseMarkdownToBlocks(next))
  editor.replaceBlocks(editor.document, blocks as PartialBlock<any>[])
  return count
}

/** 编辑器内的选中文字（DOM Selection 即编辑器选区；选区不在编辑器内返回空串） */
export function selectedEditorText(): string {
  const sel = window.getSelection()
  const text = (sel?.toString() ?? '').trim()
  const inEditor = !!sel?.focusNode && sel.focusNode.parentElement?.closest('.bn-editor') != null
  return inEditor ? text : ''
}

export function createWikilink(editor: Editor): 'wrapped' | 'inserted' {
  const text = selectedEditorText()
  if (text) {
    editor.insertInlineContent(`[[${text}]] `)
    return 'wrapped'
  }
  editor.insertInlineContent('[[')
  return 'inserted'
}
