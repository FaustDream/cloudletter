/** 编辑页顶部轻提示条：非阻断、可关闭、可选自动消失（替代旧的冲突/草稿横幅） */
import { useEffect } from 'react'
import type { EditorNotice } from './useEditorSave'

/** 各类通知条的自动关闭时长（conflict 轻提示自动消失；stale 到点未处理视为放弃本机草稿） */
export const NOTICE_AUTO_CLOSE_MS: Partial<Record<EditorNotice['kind'], number>> = {
  'conflict-saved': 6000,
  'stale-draft': 12000,
}

export function EdNotice({ children, actions, onClose, autoCloseMs }: {
  children: React.ReactNode
  actions?: React.ReactNode
  onClose?: () => void
  autoCloseMs?: number
}) {
  useEffect(() => {
    if (!onClose || !autoCloseMs) return
    const t = setTimeout(onClose, autoCloseMs)
    return () => clearTimeout(t)
  }, [onClose, autoCloseMs])
  return (
    <div className="ed-note">
      <span className="ed-note-text">{children}</span>
      {actions && <span className="ed-note-ops">{actions}</span>}
      {onClose && <button className="ed-note-x" onClick={onClose} title="关闭">✕</button>}
    </div>
  )
}