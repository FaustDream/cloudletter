/**
 * BlockNote 编辑器封装（ProseMirror/Tiptap 内核的 Notion 式块编辑器，全 TypeScript）：
 * - 交互范式对齐现代编辑器：无常驻工具栏，格式入口 = 斜杠菜单（/）+ 选中浮动工具栏 +
 *   块拖拽手柄菜单（均为内核内置，中文词典 i18n）
 * - 块类型扩充见 customBlocks.tsx：Callout 提示框 / 嵌入网页 / 代码块中文语言表 +
 *   math·mermaid 实时预览；斜杠菜单追加对应条目
 * - [[ 双链：输入 [[ 唤起文章搜索自动补全，回车插入 [[标题]]；点击正文中的 [[标题]]
 *   弹出操作浮层（打开关联文章 + 用法说明）
 * - 图片点击放大灯箱（Esc / 点击关闭）
 * - 暗色主题：监听 <html data-theme>，同步切换 BlockNote theme
 * - 真相源仍是 Markdown：挂载时 markdown → blocks，编辑时 blocks → markdown 上抛（300ms 合并）
 * - 图片粘贴/拖拽/上传统一走 onPasteImage（服务端 /uploads + 客户端压缩缩略图）
 * - 外部 value 变更（版本恢复/重载）仅在确实不同时重新解析回灌；
 *   回灌期间抑制内容变更回抛，杜绝「解析 → 变更 → 再解析」反馈环（文字选择/双击场景安全）
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  useCreateBlockNote,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import type { BlockNoteEditor as BlockNoteEditorInstance, PartialBlock } from '@blocknote/core'
import { zhDictionary } from '../../i18n/blocknote-zh'
import { editorSchema, normalizeCodeLanguages } from './customBlocks'
import '@blocknote/mantine/style.css'

const EMPTY_BLOCKS: PartialBlock[] = [{ type: 'paragraph' }]

/** 监听全站 <html data-theme>，供 BlockNote 内核与 mermaid 跟随暗色 */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark')
  useEffect(() => {
    const sync = () => setDark(document.documentElement.dataset.theme === 'dark')
    const ob = new MutationObserver(sync)
    ob.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => ob.disconnect()
  }, [])
  return dark
}

/** 从正文提取光标所在位置的 [[双链]] 目标（仅折叠光标命中时返回非 null） */
function wikilinkAtCaret(editor: BlockNoteEditorInstance<any, any, any>): string | null {
  const tiptap = (editor as any)._tiptapEditor
  if (!tiptap?.state) return null
  const sel = tiptap.state.selection
  if (!sel || !sel.empty) return null // 只处理无选区（单次点击/双击后光标）的落点
  const from = sel.from
  try {
    const block = tiptap.state.doc.resolve(from).parent
    const text = block.textContent
    const rel = from - Math.max(block.start, 1)
    if (rel < 0 || rel > text.length) return null
    for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      const s = m.index ?? 0
      const e = s + m[0].length
      // 光标落点紧贴双链两端或内部都算命中，便于点击跳转
      if (rel >= s - 1 && rel <= e + 1) return m[1].trim()
    }
  } catch {
    /* 解析失败视为无命中，不影响编辑 */
  }
  return null
}

export function BlockNoteEditor({
  value,
  onChange,
  onPasteImage,
  wikilinkTargets,
  onOpenWikilink,
}: {
  value: string
  onChange: (markdown: string) => void
  /** 图片/视频/音频/文件上传：返回可访问 URL */
  onPasteImage?: (file: File) => Promise<string | null>
  /** [[ 双链候选（全站文章标题） */
  wikilinkTargets?: Array<{ id: string; title: string }>
  /** 点击正文 [[标题]] 回调（跳转关联文章） */
  onOpenWikilink?: (title: string) => void
}) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onPasteImageRef = useRef(onPasteImage)
  onPasteImageRef.current = onPasteImage
  const onOpenWikilinkRef = useRef(onOpenWikilink)
  onOpenWikilinkRef.current = onOpenWikilink
  /** 最近一次上抛的 markdown：外部 value 与之相同时不回灌，防光标跳动 */
  const lastEmitted = useRef(value)
  /** 外部回灌抑制标志：markdown→blocks 触发的 onEditorContentChange 一律不回抛 */
  const suppressEmit = useRef(false)
  const [ready, setReady] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  /** 双链操作浮层：{ 目标标题, 浮层位置 } */
  const [wlHint, setWlHint] = useState<{ name: string; x: number; y: number } | null>(null)
  const dark = useDarkTheme()

  const editor: BlockNoteEditorInstance<any, any, any> = useCreateBlockNote({
    schema: editorSchema,
    dictionary: zhDictionary as any,
    uploadFile: async (file: File): Promise<string> => {
      const handler = onPasteImageRef.current
      if (!handler) throw new Error('上传不可用')
      const url = await handler(file)
      if (!url) throw new Error('上传失败')
      return url
    },
  })

  /** 外部回灌：markdown → blocks（期间抑制内容变更回抛，避免反馈环导致选区/光标异常甚至崩溃） */
  const replaceFromMarkdown = async (md: string) => {
    let blocks: any[] = []
    if (md.trim()) {
      try {
        blocks = normalizeCodeLanguages(await editor.tryParseMarkdownToBlocks(md))
      } catch (e) {
        console.error('[BlockNote] markdown 解析失败，退回空文档', e)
      }
    }
    suppressEmit.current = true
    try {
      editor.replaceBlocks(editor.document, (blocks.length ? blocks : EMPTY_BLOCKS) as PartialBlock<any>[])
    } finally {
      suppressEmit.current = false
    }
  }

  // 挂载：markdown → blocks；订阅变更：blocks → markdown（300ms 合并，避免每次按键全量序列化）
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    void (async () => {
      await replaceFromMarkdown(value)
      if (disposed) return
      setReady(true)

      editor.onEditorContentChange(() => {
        // 外部回灌导致的变更不经过用户编辑，直接忽略（防解析反馈环）
        if (suppressEmit.current) return
        clearTimeout(timer)
        timer = setTimeout(async () => {
          if (disposed) return
          try {
            // onEditorContentChange 可能被回灌 Suppress 段再次触发，此刻仍处于抑制窗口则跳过
            if (suppressEmit.current) return
            const md = await editor.blocksToMarkdownLossy(editor.document)
            if (md === lastEmitted.current) return
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
      if (!cancelled) {
        await replaceFromMarkdown(value)
        if (!cancelled) lastEmitted.current = value
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ready])

  // 图片灯箱：点击正文里的图片放大预览（Esc / 点击遮罩关闭）
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  // 双链浮层：点击正文空白/Escape/编辑内容时收起
  useEffect(() => {
    if (!wlHint) return
    const close = () => setWlHint(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWlHint(null) }
    document.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [wlHint])

  const onRootMouseUp = (e: React.MouseEvent) => {
    // 点击正文中的 [[双链]] 文本：弹出操作浮层（打开 / 用法说明）
    const hit = wikilinkAtCaret(editor)
    if (hit) {
      e.preventDefault()
      e.stopPropagation()
      const tiptap = (editor as any)._tiptapEditor
      const pos = tiptap?.view?.coordsAtPos ? tiptap.view.coordsAtPos(tiptap.state.selection.from) : null
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      setWlHint({
        name: hit,
        x: (pos?.left ?? rect.left + rect.width / 2),
        y: (pos?.bottom ?? rect.top) + 8,
      })
      return
    }
    setWlHint(null)
  }

  const openWl = () => {
    const h = wlHint
    if (!h) return
    onOpenWikilinkRef.current?.(h.name)
    setWlHint(null)
  }

  const onRootClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement
    if (el.tagName === 'IMG' && el.closest('.bn-editor')) {
      e.preventDefault()
      setLightbox((el as HTMLImageElement).src)
    }
  }

  // 斜杠菜单条目 = 内置默认（含标题/列表/折叠/表格/媒体/表情等）+ 自定义块
  const slashItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const extra: DefaultReactSuggestionItem[] = [
      {
        title: '提示框',
        subtext: '高亮提示 / 警告 / 备忘卡片',
        aliases: ['callout', 'tip', 'note', '提示', '高亮', '标注'],
        group: '高级',
        icon: <span className="bn-slice-ico">💡</span>,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' } as any),
      },
      {
        title: '嵌入网页',
        subtext: 'B站 / YouTube 视频或链接卡片',
        aliases: ['embed', 'iframe', 'bilibili', 'youtube', '视频', '嵌入', '网页'],
        group: '高级',
        icon: <span className="bn-slice-ico">🌐</span>,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'embed' } as any),
      },
    ]
    return filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), ...extra], query)
  }

  // [[ 双链候选菜单：按标题过滤，点击插入 [[标题]] 文本
  const wikilinkItems = async (query: string): Promise<DefaultReactSuggestionItem[]> => {
    const q = query.trim().toLowerCase()
    return (wikilinkTargets ?? [])
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .slice(0, 8)
      .map((t) => ({
        title: t.title,
        subtext: '插入 [[双链]]·点击可跳转',
        group: '关联文章',
        icon: <span className="bn-slice-ico">🔗</span>,
        onItemClick: () => { editor.insertInlineContent(`[[${t.title}]] ` as any) },
      }))
  }

  return (
    <div className="ed-blocknote" onClick={onRootClick} onMouseUp={onRootMouseUp}>
      <BlockNoteView editor={editor} theme={dark ? 'dark' : 'light'} editable>
        {/* 斜杠菜单（打字 "/" 唤起）：内置块 + 自定义块 */}
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
        {/* [[ 双链自动补全（光标键入 [[ 后唤起；选区中包含 [[ 不会误触发） */}
        <SuggestionMenuController triggerCharacter="[[" getItems={wikilinkItems} minQueryLength={0} />
      </BlockNoteView>

      {/* 双链操作浮层：打开关联文章 + 使用说明 */}
      {wlHint && createPortal(
        <div className="bn-wl-mask" onClick={() => setWlHint(null)}>
          <div className="bn-wl-hint" style={{ left: wlHint.x, top: wlHint.y }} onClick={(e) => e.stopPropagation()}>
            <b>🔗 {wlHint.name}</b>
            <em>双链：输入 [[ 插入文章引用，点击正文中的 [[标题]] 可快速跳转关联文章</em>
            <div className="bn-wl-ops">
              <button className="bn-wl-open" onClick={openWl}>打开关联文章</button>
              <button className="bn-wl-close" onClick={() => setWlHint(null)}>知道了</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* 图片灯箱 */}
      {lightbox && createPortal(
        <div className="md-lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="预览" onClick={(e) => e.stopPropagation()} />
          <span className="md-lightbox-close">✕</span>
        </div>,
        document.body,
      )}
    </div>
  )
}