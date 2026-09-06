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
import { EditorToolbar } from './EditorToolbar'
import { matchWikilinkAtOffset } from '../../lib/wikilinkText'
import { applyDocTransform, createWikilink } from './docActions'
import { autoFormatMarkdown, recognizeWikilinksInMarkdown } from '../../lib/docTransforms'
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

/** 从 DOM Selection 读取光标落点是否在 [[双链]] 上（不依赖内核私有字段，跨版本安全） */
function wikilinkFromSelection(): { name: string; rect: DOMRect } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const node = sel.focusNode
  if (!node || node.nodeType !== Node.TEXT_NODE) return null
  if (!node.parentElement?.closest('.bn-editor')) return null
  const hit = matchWikilinkAtOffset(node.textContent ?? '', sel.focusOffset)
  if (!hit) return null
  const range = document.createRange()
  range.setStart(node, hit.start)
  range.setEnd(node, hit.end)
  return { name: hit.name, rect: range.getBoundingClientRect() }
}

export function BlockNoteEditor({
  value,
  onChange,
  onPasteImage,
  wikilinkTargets,
  onOpenWikilink,
  currentTitle,
  notify,
}: {
  value: string
  onChange: (markdown: string) => void
  /** 图片/视频/音频/文件上传：返回可访问 URL */
  onPasteImage?: (file: File) => Promise<string | null>
  /** [[ 双链候选（全站文章标题） */
  wikilinkTargets?: Array<{ id: string; title: string }>
  /** 点击正文 [[标题]] 回调（跳转关联文章） */
  onOpenWikilink?: (title: string) => void
  /** 当前文章标题（工具栏「识别双链」排除自身） */
  currentTitle?: string
  /** 轻提示（编辑页 toast） */
  notify?: (message: string, kind?: 'ok' | 'err') => void
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
  /** 浮层打开时刻：忽略紧跟其后的那次 click（mouseup → click 序列会误关浮层） */
  const wlOpenedAt = useRef(0)
  /** 右键编辑区菜单：创建/识别双链、一键排版 */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
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

  /** 外部回灌：markdown → blocks（期间抑制内容变更回抛，避免反馈环导致选区/光标异常甚至崩溃）。
   *  keepOnFail=true（外部值变更路径）：解析失败时保持现有内容不清空——清空正文比内容暂旧更糟。 */
  const replaceFromMarkdown = async (md: string, keepOnFail = false): Promise<boolean> => {
    let blocks: any[] = []
    if (md.trim()) {
      try {
        blocks = normalizeCodeLanguages(await editor.tryParseMarkdownToBlocks(md))
      } catch (e) {
        console.error('[BlockNote] markdown 解析失败', e)
        if (keepOnFail) return false
      }
    }
    suppressEmit.current = true
    try {
      editor.replaceBlocks(editor.document, (blocks.length ? blocks : EMPTY_BLOCKS) as PartialBlock<any>[])
    } finally {
      suppressEmit.current = false
    }
    return true
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
            // 竞态防御：文档仍有文字却序列化出空串（双击选词等场景偶发）——跳过本次上抛，
            // 否则父组件值变空会触发空文档回灌，整篇正文被清空且撤销无效（2026-09-05 实测复现）
            const docHasText = editor.document.some((b) => Array.isArray(b.content) && b.content.some((c) => {
              const t = (c as { text?: unknown })?.text
              return typeof t === 'string' && t.trim() !== ''
            }))
            if (!md.trim() && docHasText) {
              console.warn('[BlockNote] 序列化异常得到空串，已跳过本次同步以防正文被清空')
              return
            }
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
        // 解析失败 → 保持现有内容并同步 lastEmitted（防无限重解析）：内容暂旧但绝不清空
        await replaceFromMarkdown(value, true)
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

  // 双链浮层：点击正文空白/Escape/编辑内容时收起（打开瞬间的 click 忽略，防误关）
  useEffect(() => {
    if (!wlHint) return
    const close = () => {
      if (Date.now() - wlOpenedAt.current > 200) setWlHint(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWlHint(null) }
    document.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [wlHint])

  const onRootMouseUp = () => {
    // ProseMirror 在 mousedown 即落好选区，mouseup 时同步读 DOM Selection 即可命中；
    // 点击 [[双链]] 弹出操作浮层，点击空白处收起
    const hit = wikilinkFromSelection()
    if (hit) {
      setWlHint({ name: hit.name, x: hit.rect.left, y: hit.rect.bottom + 6 })
      wlOpenedAt.current = Date.now()
    } else {
      setWlHint(null)
    }
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

  // 右键菜单：点击任意处/Escape 关闭
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    document.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const onRootContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }

  /** 右键/工具栏共用的文档变换动作（带结果提示） */
  const runDocTransform = (label: string, fn: (md: string) => { md: string; count: number }) => {
    void applyDocTransform(editor, fn).then((n) => {
      notify?.(n < 0 ? `${label}：没有需要处理的内容` : `${label}：已处理 ${n} 处（Ctrl+Z 可撤销）`)
    })
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
    <div className="ed-blocknote" onClick={onRootClick} onMouseUp={onRootMouseUp} onContextMenu={onRootContextMenu}>
      {/* 常驻格式工具栏：斜杠菜单/浮动工具栏之外的固定入口 */}
      <EditorToolbar
        editor={editor}
        titles={(wikilinkTargets ?? []).map((t) => t.title)}
        currentTitle={currentTitle}
        onImageUpload={onPasteImage}
        notify={notify}
      />
      {/* ready 前 editable=false：初版 markdown 尚未解析完成，禁止输入——
          否则打字/选词落在空文档上，解析完成的 replaceBlocks 会把刚输入的内容一并冲掉 */}
      <BlockNoteView editor={editor} theme={dark ? 'dark' : 'light'} editable={ready}>
        {/* 斜杠菜单（打字 "/" 唤起）：内置块 + 自定义块 */}
        <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
        {/* [[ 双链自动补全（光标键入 [[ 后唤起；选区中包含 [[ 不会误触发） */}
        <SuggestionMenuController triggerCharacter="[[" getItems={wikilinkItems} minQueryLength={0} />
      </BlockNoteView>

      {/* 双链操作浮层：打开关联文章 + 用法说明（未找到目标时说明原因） */}
      {wlHint && createPortal(
        <div className="bn-wl-mask" onClick={() => setWlHint(null)}>
          <div className="bn-wl-hint" style={{ left: wlHint.x, top: wlHint.y }} onClick={(e) => e.stopPropagation()}>
            <b>🔗 {wlHint.name}</b>
            {(() => {
              const target = (wikilinkTargets ?? []).find((t) => t.title === wlHint.name)
              return target ? (
                <em>找到同名文章，点击下方按钮跳转。</em>
              ) : (
                <em>还没有同名文章。输入 [[ 时会弹出文章补全，选中即可建立双链。</em>
              )
            })()}
            <em className="bn-wl-howto">用法：在正文输入 [[文章标题]] 建立双链；点击正文中的双链文字随时跳转。</em>
            <div className="bn-wl-ops">
              <button
                className="bn-wl-open"
                disabled={!(wikilinkTargets ?? []).some((t) => t.title === wlHint.name)}
                onClick={openWl}
              >
                打开关联文章
              </button>
              <button className="bn-wl-close" onClick={() => setWlHint(null)}>知道了</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* 右键编辑区菜单：一键创建双链等高频动作 */}
      {ctxMenu && createPortal(
        <div className="ed-ctx-mask" onClick={() => setCtxMenu(null)} onContextMenu={(e) => e.preventDefault()}>
          <div className="ed-ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => {
                const r = createWikilink(editor)
                notify?.(r === 'wrapped' ? '已转为双链' : '已插入 [[ ：输入标题过滤，或从补全列表点选文章')
                setCtxMenu(null)
              }}
            >
              🔗 创建双链
            </button>
            <button onClick={() => { runDocTransform('识别双链', (md) => recognizeWikilinksInMarkdown(md, (wikilinkTargets ?? []).map((t) => t.title), { exclude: currentTitle })); setCtxMenu(null) }}>
              🧲 识别双链
            </button>
            <button onClick={() => { runDocTransform('一键排版', autoFormatMarkdown); setCtxMenu(null) }}>
              🪄 一键排版
            </button>
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