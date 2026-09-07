/**
 * 列表标记样式 → Markdown 真相源互转（纯函数，零副作用）：
 * - BlockNote 的 bullet/numbered 列表块支持自定义 prop `listStyle`（非默认时渲染为
 *   .bn-block-content 的 data-list-style 属性，由 CSS 决定 marker 形态）；
 * - 但 BlockNote 的 markdown 导出丢弃该 prop —— 用 HTML 注释行持久化在真相源里：
 *   `<!-- bn:ul:circle -->` / `<!-- bn:ol:lower-roman -->`（位于列表起始行上方）。
 * - 注入 = md 行扫描找「列表 run 起点」并按顺序分配样式；提取 = 移除注释并返回样式序列。
 */
export type BulletListStyle = 'disc' | 'circle' | 'square'
export type OrderedListStyle = 'decimal' | 'lower-alpha' | 'upper-alpha' | 'lower-roman' | 'upper-roman'
export type ListStyle = BulletListStyle | OrderedListStyle

export const BULLET_STYLES: BulletListStyle[] = ['disc', 'circle', 'square']
export const ORDERED_STYLES: OrderedListStyle[] = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman']

/** 展示文案（工具栏选项用） */
export const LIST_STYLE_LABEL: Record<ListStyle, string> = {
  disc: '实心圆点', circle: '空心圆圈', square: '方块',
  decimal: '数字', 'lower-alpha': '小写字母', 'upper-alpha': '大写字母', 'lower-roman': '小写罗马', 'upper-roman': '大写罗马',
}

/** 循环取下一个样式（默认值视为「未设置」，首个返回默认样式让用户能看到切换生效） */
export function nextBulletStyle(cur: string | undefined): BulletListStyle {
  const base = BULLET_STYLES
  const idx = cur === undefined ? -1 : base.indexOf(cur as BulletListStyle)
  return base[(idx + 1) % base.length]
}
export function nextOrderedStyle(cur: string | undefined): OrderedListStyle {
  const base = ORDERED_STYLES
  const idx = cur === undefined ? -1 : base.indexOf(cur as OrderedListStyle)
  return base[(idx + 1) % base.length]
}

const UL_COMMENT_RE = /^<!--\s*bn:ul:([a-z-]+)\s*-->\s*$/
const OL_COMMENT_RE = /^<!--\s*bn:ol:([a-z-]+)\s*-->\s*$/
const FENCE_RE = /^ {0,3}(```|~~~)/
const bulletRe = () => /^\s*[-*+]\s+/
const orderedRe = () => /^\s*\d+[.)]\s+/

export interface ListComment {
  kind: 'bullet' | 'ordered'
  style: ListStyle
}

/** 提取列表样式注释：返回净化后的 md 与按扫描顺序的样式序列（所有 bn:ul/bn:ol 注释行都会移除，非法样式丢弃） */
export function extractListStyleComments(md: string): { md: string; styles: ListStyle[] } {
  const styles: ListStyle[] = []
  const out: string[] = []
  for (const line of md.split('\n')) {
    const ul = line.match(UL_COMMENT_RE)
    const ol = line.match(OL_COMMENT_RE)
    if (ul) {
      if ((BULLET_STYLES as string[]).includes(ul[1])) styles.push(ul[1] as ListStyle)
    } else if (ol) {
      if ((ORDERED_STYLES as string[]).includes(ol[1])) styles.push(ol[1] as ListStyle)
    } else {
      out.push(line)
    }
  }
  return { md: out.join('\n'), styles }
}

/**
 * 注入列表样式注释：逐行扫描 md，在「列表 run 起点」行上方插入对应注释。
 * run 起点 = 列表项行，且其上一行（跳过空行，不受代码围栏干扰）不是同种列表项。
 * styles 按 run 出现顺序消耗；数量多于 run 时多余忽略。
 */
export function injectListStyleComments(md: string, styles: ListStyle[]): string {
  if (!styles.length) return md
  const lines = md.split('\n')
  const out: string[] = []
  let si = 0
  let inFence = false
  let prevWasSameList = false
  let prevListKind: 'bullet' | 'ordered' | null = null
  for (const line of lines) {
    if (FENCE_RE.test(line)) { inFence = !inFence; prevWasSameList = false; prevListKind = null; out.push(line); continue }
    if (inFence) { out.push(line); continue }
    const isBullet = bulletRe().test(line)
    const isOrdered = orderedRe().test(line)
    if (!isBullet && !isOrdered) {
      prevWasSameList = false
      prevListKind = null
      out.push(line)
      continue
    }
    const kind: 'bullet' | 'ordered' = isBullet ? 'bullet' : 'ordered'
    const isRunStart = !prevWasSameList && prevListKind !== kind
    if (isRunStart && si < styles.length) {
      out.push(kind === 'bullet' ? `<!-- bn:ul:${styles[si]} -->` : `<!-- bn:ol:${styles[si]} -->`)
      si++
    }
    prevWasSameList = true
    prevListKind = kind
    out.push(line)
  }
  return out.join('\n')
}

/* ═══════ 块级帮助：editor.document ↔ 样式序列（顺序与 md run 一致） ═══════ */

export interface BaseBlock {
  type: string
  props?: Record<string, unknown>
  children?: unknown
}

export type ListKind = 'bullet' | 'ordered'

function kindOf(b: BaseBlock): ListKind | null {
  if (b.type === 'bulletListItem') return 'bullet'
  if (b.type === 'numberedListItem') return 'ordered'
  return null
}

function isDefaultStyle(kind: ListKind, style: string): boolean {
  return kind === 'bullet' ? style === 'disc' : style === 'decimal'
}

/** 收集文档中「列表 run 起点」的非默认样式（DFS 顺序 == md 行顺序） */
export function collectListStyles(blocks: BaseBlock[]): ListStyle[] {
  const styles: ListStyle[] = []
  let prev: ListKind | null = null
  const walk = (arr: BaseBlock[]) => {
    for (const b of arr) {
      const k = kindOf(b)
      const start = !!k && prev !== k
      prev = k
      if (start && k) {
        const s = b.props?.listStyle
        if (typeof s === 'string' && !isDefaultStyle(k, s)) styles.push(s as ListStyle)
      }
      if (Array.isArray(b.children)) walk(b.children as BaseBlock[])
    }
  }
  walk(blocks)
  return styles
}

/** 按样式序列回写列表 run 的 listStyle prop（加载回灌用；就地修改块，不重建） */
export function applyListStylesToBlocks(blocks: BaseBlock[], styles: ListStyle[]): void {
  let si = 0
  let prev: ListKind | null = null
  const walk = (arr: BaseBlock[]) => {
    for (const b of arr) {
      const k = kindOf(b)
      const start = !!k && prev !== k
      prev = k
      if (start && k && si < styles.length) {
        b.props = { ...(b.props ?? {}), listStyle: styles[si] }
        si++
      }
      if (Array.isArray(b.children)) walk(b.children as BaseBlock[])
    }
  }
  walk(blocks)
}