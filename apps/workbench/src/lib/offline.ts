/**
 * 离线能力小工具：
 * - 网络状态检测（navigator.onLine + online/offline 事件订阅）
 * - 编辑器本地草稿快照（localStorage）：断网/突然关闭时内容不丢，恢复网络后自动同步
 */
import type { Frontmatter } from '../components/editor/Outline'

const DRAFT_PREFIX = 'cl:editdraft:'

export interface EditorDraft {
  /** 编辑器内容快照 */
  content: { markdown: string; title: string; fm: Frontmatter }
  slug: string
  /** 保存时的 baseVersion（服务器 updatedAt 毫秒）；恢复草稿后按此做乐观锁 */
  baseVersion: number | null
  /** 快照写入时间戳（恢复时与服务器 updatedAt 比较） */
  savedAt: number
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

/** 订阅在线/离线切换，返回退订函数 */
export function subscribeNetwork(onChange: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onOnline = () => onChange(true)
  const onOffline = () => onChange(false)
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
  }
}

function keyOf(postId: string): string {
  return DRAFT_PREFIX + postId
}

export function saveDraft(postId: string, draft: EditorDraft): void {
  try {
    localStorage.setItem(keyOf(postId), JSON.stringify(draft))
  } catch {
    // 存满/隐私模式：静默失败，不阻断编辑
  }
}

export function loadDraft(postId: string): EditorDraft | null {
  try {
    const raw = localStorage.getItem(keyOf(postId))
    if (!raw) return null
    const d = JSON.parse(raw) as EditorDraft
    if (!d || typeof d.savedAt !== 'number' || !d.content) return null
    return d
  } catch {
    return null
  }
}

export function clearDraft(postId: string): void {
  try {
    localStorage.removeItem(keyOf(postId))
  } catch {}
}