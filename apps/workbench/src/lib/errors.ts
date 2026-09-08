/** 从 unknown 错误中提取可读消息（统一 unknown 错误处理，替代显式 any 后的 e?.message 访问） */

export function errMsg(e: unknown, fallback = '操作失败'): string {
  if (e instanceof Error) return e.message || fallback
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message?: unknown }).message
    if (typeof m === 'string' && m) return m
  }
  return fallback
}

/** 用 try-catch 包裹的异步调用结果：成功返回 [数据]，失败返回 [null, 错误消息] */
export async function tryCatch<T>(fn: () => Promise<T>, fallback = '操作失败'): Promise<[T, null] | [null, string]> {
  try {
    return [await fn(), null]
  } catch (e) {
    return [null, errMsg(e, fallback)]
  }
}