/**
 * BlockNote 编辑器封装（ProseMirror/Tiptap 内核的 Notion 式块编辑器，全 TypeScript）：
 * - 全中文界面（dictionary i18n）：斜杠菜单、占位符、悬浮工具栏提示、右键表格菜单等
 * - 置顶中文富工具栏（见 EditorToolbar），不被页面滚动遮挡；右键简易菜单保留；
 *   "/" 菜单与 Ctrl+B/I/K 等内核快捷键保留
 * - 真相源仍是 Markdown：挂载时 markdown → blocks，编辑时 blocks → markdown 上抛（内部 300ms 合并）
 * - 图片粘贴/拖拽/工具栏上传统一走 onPasteImage（服务端 /uploads + 客户端压缩缩略图）
 * - 外部 value 变更（版本恢复/重载）仅在确实不同时重新解析回灌
 */
import { useEffect, useRef, useState } from 'react'
import { useCreateBlockNote, getDefaultReactSlashMenuItems, SuggestionMenuController } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import type { BlockNoteEditor as BlockNoteEditorInstance, PartialBlock } from '@blocknote/core'
import { zhDictionary } from '../../i18n/blocknote-zh'
import { EditorToolbar } from './EditorToolbar'
import '@blocknote/mantine/style.css'

const EMPTY_BLOCKS: PartialBlock[] = [{ type: 'paragraph' }]

export function BlockNoteEditor({
  value,
  onChange,
  onPasteImage,
}: {
  value: string
  onChange: (markdown: string) => void
  /** 图片粘贴/拖拽/工具栏上传：返回可访问 URL */
  onPasteImage?: (file: File) => Promise<string | null>
}) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onPasteImageRef = useRef(onPasteImage)
  onPasteImageRef.current = onPasteImage
  /** 最近一次上抛的 markdown：外部 value 与之相同时不回灌，防光标跳动 */
  const lastEmitted = useRef(value)
  const [ready, setReady] = useState(false)

  const editor: BlockNoteEditorInstance = useCreateBlockNote({
    dictionary: zhDictionary as any,
    uploadFile: async (file: File): Promise<string> => {
      const handler = onPasteImageRef.current
      if (!handler) throw new Error('上传不可用')
      const url = await handler(file)
      if (!url) throw new Error('上传失败')
      return url
    },
  })

  // 挂载：markdown → blocks；订阅变更：blocks → markdown（300ms 合并，避免每次按键全量序列化）
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    void (async () => {
      let blocks: PartialBlock[] = []
      if (value.trim()) {
        try {
          const parsed = await editor.tryParseMarkdownToBlocks(value)
          if (!disposed) blocks = parsed
        } catch (e) {
          console.error('[BlockNote] markdown 解析失败，退回空文档', e)
        }
      }
      if (disposed) return
      editor.replaceBlocks(editor.document, blocks.length ? blocks : EMPTY_BLOCKS)
      setReady(true)

      editor.onEditorContentChange(() => {
        clearTimeout(timer)
        timer = setTimeout(async () => {
          if (disposed) return
          try {
            const md = await editor.blocksToMarkdownLossy(editor.document)
            lastEmitted.current = md
            onChangeRef.current(md)
          } catch (e) {
            console.error('[BlockNote] markdown 序列化失败', e)
          }
        }, 300)
      })
    })()

    return () => {
      disposed = true
      clearTimeout(timer)
    }
    // 仅挂载时执行一次（value 初值）；外部变更走下方 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // 外部值变更（版本恢复 / 载入文章）：仅当确实不同于最近上抛值时重新解析回灌
  useEffect(() => {
    if (!ready) return
    if (value === lastEmitted.current) return
    let cancelled = false
    void (async () => {
      try {
        const blocks: PartialBlock[] = value.trim()
          ? await editor.tryParseMarkdownToBlocks(value)
          : EMPTY_BLOCKS
        if (!cancelled) {
          lastEmitted.current = value
          editor.replaceBlocks(editor.document, blocks)
        }
      } catch (e) {
        console.error('[BlockNote] 外部 markdown 回灌失败', e)
      }
    })()
    return () => { cancelled = true }
  }, [value, ready, editor])

  return (
    <div className="ed-blocknote">
      <EditorToolbar editor={editor} onUploadImage={onPasteImage} />
      <BlockNoteView editor={editor} theme="light" editable onChange={() => {}}>
        {/* 0.54：斜杠菜单触发需显式挂载控制器（打字 "/" 唤起） */}
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={async (query: string) => getDefaultReactSlashMenuItems(editor)}
        />
      </BlockNoteView>
    </div>
  )
}
