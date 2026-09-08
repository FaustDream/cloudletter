/**
 * 文档批量变换（纯函数，供工具栏「一键排版 / 识别双链」消费，单测覆盖）：
 * - autoFormatMarkdown：常见中文序号行（第X章 / 第X节 / 一、 / 1、）转为对应级别标题，
 *   标题即大纲（自动大纲）；跳过代码围栏、已有标题与列表行
 * - recognizeWikilinksInMarkdown：把正文中出现的其他文章标题包成 [[标题]]；
 *   跳过代码围栏、行内代码、既有双链与 markdown 链接；长标题优先、排除当前文章自身
 */

export interface DocTransformResult {
  md: string
  /** 被转换/识别的处数（0 表示无事发生） */
  count: number
}

/** 标题行模式（按优先级）：章篇部讲→##，节回课→###，中文顿号→###，数字顿号→#### */
const HEADING_RULES: Array<{ re: RegExp; level: number }> = [
  { re: /^(第[0-9〇零一二三四五六七八九十百千]+[章篇部讲])\s*(\S.*)$/, level: 2 },
  { re: /^(第[0-9〇零一二三四五六七八九十百千]+[节回课])\s*(\S.*)$/, level: 3 },
  { re: /^([一二三四五六七八九十]{1,3}、)\s*(\S.*)$/, level: 3 },
  { re: /^([0-9]{1,3}、)\s*(\S.*)$/, level: 4 },
]

/** 一键排版：识别序号标题行并转为 markdown 标题 */
export function autoFormatMarkdown(md: string): DocTransformResult {
  let count = 0
  let inFence = false
  const lines = md.split('\n').map((line) => {
    if (/^```/.test(line.trim())) {
      inFence = !inFence
      return line
    }
    if (inFence || /^#{1,4}\s/.test(line) || /^\s*([-*+]|\d+[.)])\s/.test(line)) return line
    for (const { re, level } of HEADING_RULES) {
      const m = line.match(re)
      if (m) {
        count++
        return `${'#'.repeat(level)} ${line.trim()}`
      }
    }
    return line
  })
  return { md: lines.join('\n'), count }
}

/** 掩码工具：把不想被替换的区段替换为占位符，处理完再还原 */
function withMasked(md: string, patterns: RegExp[], fn: (masked: string) => string): { md: string; count: number } {
  const stash: string[] = []
  let masked = md
  for (const re of patterns) {
    masked = masked.replace(re, (m) => {
      stash.push(m)
      return `\u0000${stash.length - 1}\u0001`
    })
  }
  masked = fn(masked)
  const out = masked.replace(/\u0000(\d+)\u0001/g, (_, i) => {
    return stash[Number(i)] ?? ''
  })
  // 计数：还原后统计新增的 [[ 标记（还原的 stash 中也可能含 [[，故在 fn 阶段计数）
  return { md: out, count: 0 }
}

/** 识别双链：把正文中的其他文章标题包成 [[标题]]（掩码保护围栏/行内代码/既有链接） */
export function recognizeWikilinksInMarkdown(
  md: string,
  titles: string[],
  opts?: { exclude?: string },
): DocTransformResult {
  const exclude = (opts?.exclude ?? '').trim()
  const pool = [...new Set(titles.map((t) => t.trim()))]
    .filter((t) => t.length >= 2 && t !== exclude && !/^\u0000|\u0001$/.test(t))
    .sort((a, b) => b.length - a.length) // 长标题优先，避免短标题截断长标题
  if (!pool.length) return { md, count: 0 }

  let count = 0
  const masked = withMasked(
    md,
    [/```[\s\S]*?```/g, /`[^`\n]*`/g, /\[\[[^\]\n]*\]\]/g, /\[[^\]\n]*\]\([^)\n]*\)/g, /https?:\/\/\S+/g],
    (text) => {
      for (const title of pool) {
        const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        // 不在 [[ ]] 内部（掩码已处理既有双链，这里防同轮早先生成的 [[ ]] 嵌套误配）
        text = text.replace(new RegExp(`(?<!\\[\\[)(?<!\\[)${esc}(?!\\]\\])(?!\\])`, 'g'), () => {
          count++
          return `[[${title}]]`
        })
      }
      return text
    },
  )
  return { md: masked.md, count }
}
