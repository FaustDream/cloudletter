/**
 * [[双链]] 光标命中检测（纯字符串部分）：
 * 给定一行文本与光标偏移，判断光标是否落在某个 [[目标]] / [[目标|别名]] 上
 * （两端 ±1 字符容差，便于点击双链边缘时也能命中）。DOM Selection 的取文本/测矩形
 * 粘合在 BlockNoteEditor 内完成，本模块不依赖 DOM，可单测。
 */
export interface WikilinkHit {
  /** 双链目标名（别名形式取 | 前部分，去首尾空白） */
  name: string
  /** [[ 起始偏移 */
  start: number
  /** ]] 结束后一位（end - start = 完整长度） */
  end: number
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g

export function matchWikilinkAtOffset(text: string, offset: number): WikilinkHit | null {
  for (const m of text.matchAll(WIKILINK_RE)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    const name = m[1].trim()
    if (!name) continue
    if (offset >= start - 1 && offset <= end + 1) return { name, start, end }
  }
  return null
}
