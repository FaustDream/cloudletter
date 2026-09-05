/**
 * 文章编辑的保存/草稿策略（纯函数，供 EditorPage 消费、单测覆盖）：
 * - 保存失败处置：编辑会话内以本地内容为主，乐观锁冲突自动以本地覆盖重试，不再弹冲突条；
 *   仅网络层失败走离线兜底，其余按普通失败提示。
 * - 重开取舍：以服务器版本为主；仅当本机快照严格比服务器新时返回它，供一次性轻提示
 *   （用户可显式恢复或放弃，见 EditorPage 的 staleDraft 通知条）。
 */
import { ApiError } from '../api'

export type SaveFailurePlan =
  | { kind: 'retry-override' }
  | { kind: 'offline' }
  | { kind: 'fail' }

/** 保存失败后的处置计划：alreadyOverridden 表示本次已是「以本地为准」的覆盖重试 */
export function planSaveFailure(err: unknown, opts: { alreadyOverridden: boolean }): SaveFailurePlan {
  if (err instanceof TypeError) return { kind: 'offline' }
  if (err instanceof ApiError && err.code === 'CONFLICT' && !opts.alreadyOverridden) {
    return { kind: 'retry-override' }
  }
  return { kind: 'fail' }
}

/** 重开文章时的本机未同步草稿判定：快照严格比服务器新才视为「较新草稿」 */
export function pickStaleLocalDraft<T extends { savedAt: number }>(
  serverUpdatedAtMs: number,
  draft: T | null,
): T | null {
  return draft && draft.savedAt > serverUpdatedAtMs ? draft : null
}
