/**
 * 通用空态 / 载入占位：统一各页面的「载入中 / 暂无内容」表现。
 *  variant=hero：整页居中大空态（emoji + 文案）；variant=plain：区块内小占位。
 */
import type { CSSProperties, ReactNode } from 'react'

export function EmptyState({ icon, children, variant = 'plain', style, className }: {
  icon?: ReactNode
  children?: ReactNode
  variant?: 'plain' | 'hero'
  style?: CSSProperties
  className?: string
}) {
  return (
    <div className={`${variant === 'hero' ? 'empty-state' : 'empty'}${className ? ` ${className}` : ''}`} style={style}>
      {icon != null && <span className="emoj">{icon}</span>}
      {children}
    </div>
  )
}
