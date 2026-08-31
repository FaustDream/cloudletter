/** 框架层 · 右侧滑入抽屉（Drawer）：快速创建/预览/关联绑定。
 * 交互：右侧滑入 280ms；主内容区降透明(不遮罩)；Esc / × / 点击主区关闭；
 * 保存不自动关闭（父组件控制）；可自定义宽度（400/480/560）。
 */
import { useEffect, type ReactNode } from 'react'
import { Icon } from './Icon'

export function Drawer({ title, onClose, children, footer, width = 520, hint }: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  hint?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="drawer-layer">
      <div className="drawer-mask" onClick={onClose} />
      <aside className="drawer" style={{ width }} role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div className="drawer-title">{title}</div>
          {hint && <span className="drawer-hint">{hint}</span>}
          <button className="drawer-x" onClick={onClose} aria-label="关闭"><Icon name="x" size={18} /></button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </aside>
    </div>
  )
}