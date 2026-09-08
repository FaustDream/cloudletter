/**
 * 框架层 · 统一弹窗（Modal / Dialog）：
 * - 遮罩为透明捕获层（fixed 全视口，点击外部关闭；不变暗、不加 backdrop 模糊，DESIGN-SPEC §9）
 * - 危险级别：info / warning / danger / success（标题图标 + 强调色）
 * - 四档尺寸：sm(400) / md(560) / lg(720) / xl(960)
 * - 进入/退出动效、Esc 关闭、body 滚动锁定、焦点管理（初始聚焦 + Tab 循环 + 关闭还原）
 * - 命令式 confirmDialog() 用于一行替换 window.confirm()
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { createRoot, type Root } from 'react-dom/client'

export type ModalType = 'info' | 'warning' | 'danger' | 'success'
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const TYPE_META: Record<ModalType, { icon: string; color: string }> = {
  info: { icon: 'target', color: 'var(--accent)' },
  warning: { icon: 'bolt', color: 'var(--warn)' },
  danger: { icon: 'trash', color: 'var(--danger)' },
  success: { icon: 'check', color: 'var(--ok)' },
}

const SIZE_W: Record<ModalSize, number> = { sm: 400, md: 560, lg: 720, xl: 960 }

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, children, footer, type = 'info', size = 'md', maskClosable = true, hideClose = false }: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  type?: ModalType
  size?: ModalSize
  maskClosable?: boolean
  /** 隐藏右上角 × 关闭按钮（关闭途径保留：页脚按钮 / Esc / 点遮罩） */
  hideClose?: boolean
}) {
  const [closing, setClosing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  /** 播放 150ms 退场动画后，再通知父组件正式关闭 */
  const requestClose = () => {
    if (closing) return
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, 150)
  }

  useEffect(() => {
    prevFocus.current = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden' // 锁定背景滚动
    const t = window.setTimeout(() => panelRef.current?.focus(), 30) // 初始聚焦
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      if (closeTimer.current) clearTimeout(closeTimer.current)
      document.body.style.overflow = ''
      prevFocus.current?.focus?.() // 关闭后焦点还原到触发元素
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Tab 焦点循环（不跑出弹窗）+ Enter 触发主按钮（data-modal-primary） */
  const panelKeyDown = (e: React.KeyboardEvent) => {
    const el = panelRef.current
    if (!el) return
    if (e.key === 'Enter') {
      const t = e.target as HTMLElement
      if (!['TEXTAREA', 'BUTTON', 'INPUT', 'SELECT'].includes(t.tagName)) {
        el.querySelector<HTMLElement>('[data-modal-primary]')?.click()
      }
      return
    }
    if (e.key !== 'Tab') return
    const list = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (!list.length) return
    const first = list[0]
    const last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const meta = TYPE_META[type]

  // createPortal 挂 body：避免祖先 transform/filter 困住 fixed 坐标系导致弹窗偏心/被裁切；
  // .overlay 纵向可滚 + .modal margin:auto = 内容超高时安全居中（顶部不再被裁出屏幕）
  return createPortal(
    <div
      className={`overlay${closing ? ' overlay-out' : ''}`}
      onClick={(e) => { if (maskClosable && e.target === e.currentTarget) requestClose() }}
    >
      <div
        ref={panelRef}
        className={`modal m-${type}${closing ? ' modal-out' : ''}`}
        style={{ width: SIZE_W[size] }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={panelKeyDown}
      >
        <div className="mh">
          <span className="m-ttl">
            <span className="m-tic" style={{ color: meta.color }}>
              <Icon name={meta.icon} size={17} />
            </span>
            {title}
          </span>
          {!hideClose && (
            <button className="x" onClick={requestClose} aria-label="关闭">
              <Icon name="x" size={18} />
            </button>
          )}
        </div>
        {children}
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** 定义表单行布局：label + 控件。
 *  as='div'：富文本编辑器（contenteditable）等非 labelable 控件必须用它——
 *  浏览器会把 label 内的点击做控件焦点转发，包住 contenteditable 会导致
 *  点击落点/焦点被劫持（打字无效、误触工具栏按钮）。 */
export function Field({ label, children, as = 'label' }: { label: string; children: ReactNode; as?: 'label' | 'div' }) {
  const Tag = as === 'div' ? 'div' : 'label'
  return (
    <Tag className="mfield">
      <span>{label}</span>
      {children}
    </Tag>
  )
}

/* ================= 命令式确认弹窗（替代 window.confirm） ================= */

export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  type?: ModalType
  confirmText?: string
  cancelText?: string
}

/** 一行调用：`if (!(await confirmDialog({ title, type: 'danger' }))) return` */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    let root: Root | null = null
    const close = (val: boolean) => {
      root?.unmount()
      host.remove()
      resolve(val)
    }
    const type = opts.type ?? 'info'
    const color = TYPE_META[type].color
    root = createRoot(host)
    root.render(
      <Modal
        title={opts.title}
        size="sm"
        type={type}
        onClose={() => close(false)}
        footer={
          <>
            <button className="btn ghost" onClick={() => close(false)}>{opts.cancelText ?? '取消'}</button>
            <button className="btn slim" data-modal-primary style={{ background: color, borderColor: color }} onClick={() => close(true)}>
              {opts.confirmText ?? '确定'}
            </button>
          </>
        }
      >
        {opts.description != null && <p className="confirm-desc">{opts.description}</p>}
      </Modal>,
    )
  })
}