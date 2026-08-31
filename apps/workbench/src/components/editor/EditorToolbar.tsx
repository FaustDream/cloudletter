/**
 * 编辑器中文工具栏（置顶常驻）+ 右键简易菜单：
 * - 块类型：正文 / 标题1-3 / 引用 / 无序 / 有序 / 任务列表
 * - 行内样式：加粗 / 斜体 / 下划线 / 删除线 / 行内代码 / 文字颜色 / 高亮
 * - 插入：表格 / 图片（走上传）/ 分割线 / 链接
 * - 操作：撤销 / 重做
 * - 右键：就地弹出简易中文菜单（按鼠标位置定位，防遮挡）
 * 全部操作走 BlockNote editor API；快捷键（Ctrl+B/I/K 等）由内核保留。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useExtension } from '@blocknote/react'
import type { BlockNoteEditor } from '@blocknote/core'
import { SuggestionMenu } from '@blocknote/core'

type Editor = BlockNoteEditor<any, any, any>

const TEXT_COLORS = [
  { v: 'red', c: '#e03e3e', n: '红' },
  { v: 'orange', c: '#ec9b3b', n: '橙' },
  { v: 'green', c: '#00b04a', n: '绿' },
  { v: 'blue', c: '#2f6fd6', n: '蓝' },
  { v: 'purple', c: '#8b5cf6', n: '紫' },
]
const HL_COLORS = [
  { v: 'yellow', c: '#fff36b', n: '黄' },
  { v: 'green', c: '#c8f7d0', n: '绿' },
  { v: 'blue', c: '#cfe6ff', n: '蓝' },
  { v: 'pink', c: '#ffd6e8', n: '粉' },
]

interface CtxMenu {
  x: number
  y: number
}

export function EditorToolbar({ editor, onUploadImage }: {
  editor: Editor
  /** 图片上传：返回可访问 URL */
  onUploadImage?: (file: File) => Promise<string | null>
}) {
  const [ctx, setCtx] = useState<CtxMenu | null>(null)
  const [tick, setTick] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  // 0.54：编程打开斜杠菜单走 SuggestionMenu 扩展（editor 上无该方法）
  const suggestionMenu = useExtension(SuggestionMenu, { editor }) as any

  const openSlashMenu = () => {
    const doc = editor.document
    editor.setTextCursorPosition(doc[doc.length - 1], 'end')
    editor.focus()
    suggestionMenu.openSuggestionMenu?.('/')
  }

  // 选中内容变化时刷新工具态（延迟一帧，走 PM 同步后状态）
  useEffect(() => {
    const refresh = () => requestAnimationFrame(() => setTick((t) => t + 1))
    const dom = (editor as any)._tiptapEditor?.view?.dom
    document.addEventListener('selectionchange', refresh)
    dom?.addEventListener('selectionchange', refresh)
    return () => {
      document.removeEventListener('selectionchange', refresh)
      dom?.removeEventListener('selectionchange', refresh)
    }
  }, [editor])

  // Ctrl + /：手动唤起斜杠菜单（保底入口，不依赖打字触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        openSlashMenu()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  // 点击其他位置 / Esc 关闭右键菜单
  useEffect(() => {
    if (!ctx) return
    const close = () => setCtx(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtx(null) }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctx])

  // 编辑器区域内右键 → 简易中文菜单（含工具栏与正文区）
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const root = rootRef.current?.closest('.ed-blocknote')
      if (!root || !root.contains(e.target as Node)) return
      e.preventDefault()
      const W = 150, H = 196
      setCtx({
        x: Math.min(e.clientX, window.innerWidth - W - 8),
        y: Math.min(e.clientY, window.innerHeight - H - 8),
      })
    }
    document.addEventListener('contextmenu', onCtx)
    return () => document.removeEventListener('contextmenu', onCtx)
  }, [])

  const cur = editor.getTextCursorPosition().block
  const styles = safeStyles(editor)

  const setBlockType = (type: string, props?: Record<string, unknown>) => {
    editor.updateBlock(cur, { type, props } as any)
    editor.focus()
  }

  const insertAfter = (blocks: any[]) => {
    editor.insertBlocks(blocks, cur, 'after')
    editor.focus()
  }

  const toggleStyle = (patch: Record<string, string>) => {
    editor.toggleStyles(patch as any)
    editor.focus()
  }

  const insertImage = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file || !onUploadImage) return
      const url = await onUploadImage(file)
      if (url) insertAfter([{ type: 'image', props: { url, caption: file.name } }])
    }
    input.click()
  }

  const insertLink = () => {
    const url = window.prompt('链接地址（URL）：')
    if (!url) return
    try {
      ;(editor as any).createLink({ url })
    } catch { /* 无选中内容时忽略 */ }
    editor.focus()
  }

  const insertTable = () => {
    const cell = () => ({ type: 'tableContent' as const, content: [] as any[] })
    insertAfter([{
      type: 'table',
      content: {
        type: 'tableContent',
        rows: [
          { cells: [cell(), cell(), cell()] },
          { cells: [cell(), cell(), cell()] },
          { cells: [cell(), cell(), cell()] },
        ],
      },
    } as any])
  }

  const undo = () => { (editor as any).undo?.() ?? (editor as any)._tiptapEditor?.commands.undo() }
  const redo = () => { (editor as any).redo?.() ?? (editor as any)._tiptapEditor?.commands.redo() }

  void tick // 选中变化 → 重渲染刷激活态

  return (
    <div className="ed-toolbar-wrap" ref={rootRef}>
      {/* ── 置顶中文工具栏 ── */}
      <div className="ed-toolbar-cn">
        <Group label="块类型">
          <Btn active={cur.type === 'heading' && Number((cur.props as any)?.level) === 1} onClick={() => setBlockType('heading', { level: 1 })}>H1</Btn>
          <Btn active={cur.type === 'heading' && Number((cur.props as any)?.level) === 2} onClick={() => setBlockType('heading', { level: 2 })}>H2</Btn>
          <Btn active={cur.type === 'heading' && Number((cur.props as any)?.level) === 3} onClick={() => setBlockType('heading', { level: 3 })}>H3</Btn>
          <Btn active={cur.type === 'paragraph'} onClick={() => setBlockType('paragraph')}>正文</Btn>
          <Btn active={cur.type === 'quote'} onClick={() => setBlockType('quote')}>引用</Btn>
        </Group>
        <Sep />
        <Group label="列表">
          <Btn active={cur.type === 'bulletListItem'} onClick={() => setBlockType('bulletListItem')} title="无序列表">• 列表</Btn>
          <Btn active={cur.type === 'numberedListItem'} onClick={() => setBlockType('numberedListItem')} title="有序列表">1. 列表</Btn>
          <Btn active={cur.type === 'checkListItem'} onClick={() => setBlockType('checkListItem')} title="任务列表">☑ 任务</Btn>
        </Group>
        <Sep />
        <Group label="样式">
          <Btn active={styles.bold} onClick={() => toggleStyle({ bold: 'bold' })} title="加粗 (Ctrl+B)"><b>加粗</b></Btn>
          <Btn active={styles.italic} onClick={() => toggleStyle({ italic: 'italic' })} title="斜体 (Ctrl+I)"><i>斜体</i></Btn>
          <Btn active={styles.underline} onClick={() => toggleStyle({ underline: 'underline' })} title="下划线 (Ctrl+U)"><u>下划线</u></Btn>
          <Btn active={styles.strike} onClick={() => toggleStyle({ strike: 'strike' })} title="删除线"><s>删除线</s></Btn>
          <Btn active={styles.code} onClick={() => toggleStyle({ code: 'code' })} title="行内代码">{'</>'}</Btn>
        </Group>
        <Sep />
        <Group label="颜色">
          <span className="ed-tb-colors">
            {TEXT_COLORS.map((c) => (
              <i key={c.v} title={`文字·${c.n}`} style={{ background: c.c }}
                onClick={() => toggleStyle({ textColor: c.v })} />
            ))}
          </span>
          <span className="ed-tb-colors">
            {HL_COLORS.map((c) => (
              <i key={c.v} title={`高亮·${c.n}`} style={{ background: c.c }}
                onClick={() => toggleStyle({ backgroundColor: c.v })} />
            ))}
          </span>
        </Group>
        <Sep />
        <Group label="插入">
          <Btn onClick={insertTable} title="插入表格">表格</Btn>
          <Btn onClick={insertImage} title="插入图片（也可直接粘贴）">图片</Btn>
          <Btn onClick={insertLink} title="插入链接 (Ctrl+K)">链接</Btn>
          <Btn onClick={() => insertAfter([{ type: 'divider' }])} title="插入分割线">分割线</Btn>
        </Group>
        <Sep />
        <Group label="操作">
          <Btn onClick={undo} title="撤销 (Ctrl+Z)">↶</Btn>
          <Btn onClick={redo} title="重做 (Ctrl+Y)">↷</Btn>
          <Btn onClick={openSlashMenu} title="打开插入菜单 (Ctrl+/)">菜单</Btn>
        </Group>
        <span className="ed-tb-hint">右键更多 · Ctrl+/ 唤起菜单</span>
      </div>

      {/* ── 右键简易菜单（portal 到 body：页面动画的 transform 会让 fixed 相对祖先定位而偏移） ── */}
      {ctx && createPortal(
        <div className="ed-ctx-menu" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          <MenuItem onClick={() => { toggleStyle({ bold: 'bold' }); setCtx(null) }}>加粗 <kbd>Ctrl+B</kbd></MenuItem>
          <MenuItem onClick={() => { toggleStyle({ italic: 'italic' }); setCtx(null) }}>斜体 <kbd>Ctrl+I</kbd></MenuItem>
          <MenuItem onClick={() => { setBlockType('heading', { level: 2 }); setCtx(null) }}>设为标题 2</MenuItem>
          <MenuItem onClick={() => { setBlockType('quote'); setCtx(null) }}>转为引用</MenuItem>
          <MenuItem onClick={() => { insertTable(); setCtx(null) }}>插入表格</MenuItem>
          <div className="ed-ctx-sep" />
          <MenuItem danger onClick={() => {
            editor.removeBlocks([editor.getTextCursorPosition().block])
            setCtx(null)
          }}>删除当前块</MenuItem>
        </div>,
        document.body,
      )}
    </div>
  )
}

/** 读取当前选中的行内样式（内核异常时静默降级） */
function safeStyles(editor: Editor): Record<string, boolean> {
  try {
    const tp = (editor as any)._tiptapEditor
    if (tp?.isActive) {
      return {
        bold: tp.isActive('bold'),
        italic: tp.isActive('italic'),
        underline: tp.isActive('underline'),
        strike: tp.isActive('strike'),
        code: tp.isActive('code'),
      }
    }
    return (editor as any).getSelectedStyles?.() ?? {}
  } catch {
    return {}
  }
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="ed-tb-group" title={label}>
      {children}
    </span>
  )
}
function Sep() {
  return <span className="ed-tb-sep" />
}
function Btn({ children, onClick, active, title }: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  title?: string
}) {
  return (
    <button className={`ed-tb-btn${active ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title}>
      {children}
    </button>
  )
}
function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`ed-ctx-item${danger ? ' danger' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  )
}
