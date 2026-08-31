/**
 * 通用页面头部：标题 + 副标题 + 可选中间元素（Tab）+ 右侧操作区。
 * 覆盖各页面重复的 <div className="header"> 结构，统一骨架、按页传参。
 */
import type { ReactNode } from 'react'

export function PageHeader({ title, subtitle, lead, actions, className }: {
  title?: ReactNode
  subtitle?: ReactNode
  /** 标题与操作区之间的元素（如 Tab 切换、状态芯片） */
  lead?: ReactNode
  /** 右侧操作区（自动前置 spacer 推到最右） */
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={`header${className ? ` ${className}` : ''}`}>
      {title != null && (
        <div className="ph-t">
          <h2>{title}</h2>
          {subtitle != null && <p>{subtitle}</p>}
        </div>
      )}
      {lead}
      <div className="spacer" />
      {actions}
    </div>
  )
}
