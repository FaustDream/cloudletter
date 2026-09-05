/**
 * 标签下拉多选候选构建（Notion 式属性交互的纯逻辑部分）：
 * - 已选标签始终出现在候选里（可取消勾选），即使不在全站标签中；
 * - 按查询过滤（拉丁字母忽略大小写、中文包含匹配）；
 * - 查询无精确等值命中（忽略大小写）时追加「新建」项。
 */
export interface TagOption {
  name: string
  selected: boolean
  kind: 'existing' | 'create'
}

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** 构建下拉候选：suggestions=全站标签，selected=已选，query=搜索词，max=普通候选上限（新建项不计入） */
export function buildTagOptions(
  suggestions: string[],
  selected: string[],
  query: string,
  max = 8,
): TagOption[] {
  const q = query.trim()
  const picked = new Set(selected)
  // 候选 = 已选（含不在全站列表的自定义标签）+ 全站建议，按出现顺序去重
  const pool: string[] = [...selected]
  for (const s of suggestions) if (!pool.some((p) => eq(p, s))) pool.push(s)

  const hit = (n: string): boolean => (q ? n.toLowerCase().includes(q.toLowerCase()) : true)
  const existing = pool
    .filter(hit)
    .slice(0, max)
    .map<TagOption>((name) => ({ name, selected: picked.has(name), kind: 'existing' }))

  const hasExact = pool.some((p) => eq(p, q))
  const create: TagOption[] =
    q && !hasExact ? [{ name: q, selected: false, kind: 'create' }] : []
  return [...existing, ...create]
}
