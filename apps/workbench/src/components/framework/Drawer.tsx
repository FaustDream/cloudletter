/** 框架层 · 右侧滑入抽屉（Drawer）：快速创建/预览/关联绑定/详情编辑。
 * 交互：右侧滑入；透明捕获层点击外部关闭（DESIGN-SPEC §9 浮层规范）；Esc / × 兜底；
 * 保存不自动关闭（父组件控制）；可自定义宽度（400/480/560/720）。
 * 通过 createPortal 挂载到 body：避免祖先的 transform/filter 把 fixed 坐标系
 * 困在页面容器里（表现为抽屉"只有容器大小"），保证始终相对视口全屏定位。
 */
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
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

  return createPortal(
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
    </div>,
    document.body,
  )
}
