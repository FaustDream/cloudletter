/**
 * 通用胶囊骨架组件（概念：骨架固定 · 样式抽离可切换）
 * - 任意「图标 + 主文本 + 附加件」的胶囊形组件，外观由 data-theme 注入的 CSS 变量控制
 * - 同一份主题样式（CAPSULE_THEMES + main.css [data-theme] 变体）可复用于：
 *   日期选择胶囊（悬浮）、日期胶囊（每日小结）、设置页预览 …
 * - 接入新主题无需改动骨架：追加 ThemeVariant + 一组 CSS 变量即可
 */
import { Icon } from './Icon'

export function Capsule({ theme, icon, value, extra, className, title, style, onClick, onPointerDown, onPointerMove, onPointerUp, draggable }: {
  theme: string
  icon?: string
  value: React.ReactNode
  extra?: React.ReactNode
  className?: string
  title?: string
  style?: React.CSSProperties
  onClick?: (e: React.MouseEvent<HTMLSpanElement>) => void
  onPointerDown?: (e: React.PointerEvent<HTMLSpanElement>) => void
  onPointerMove?: (e: React.PointerEvent<HTMLSpanElement>) => void
  onPointerUp?: (e: React.PointerEvent<HTMLSpanElement>) => void
  draggable?: boolean
}) {
  return (
    <span
      className={className ? `capsule ${className}` : 'capsule'}
      data-theme={theme}
      title={title}
      style={style}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      draggable={draggable}
    >
      {icon && <span className="cap-ico"><Icon name={icon} size={15} /></span>}
      <span className="cap-val">{value}</span>
      {extra && <span className="cap-ext">{extra}</span>}
    </span>
  )
}