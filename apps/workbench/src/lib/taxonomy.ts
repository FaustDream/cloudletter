/**
 * 分类/标签内容过滤纯函数：文章与灵感笔记共用同一套分类/标签体系，
 * 内容抽屉（点分类/标签查看关联内容）据此混合列出两边数据。
 */
import type { NoteItem, PostListItem } from '../api'

export type TaxonomyKind = 'category' | 'tag'

export const postInCategory = (p: PostListItem, name: string): boolean => p.category?.name === name
export const postWithTag = (p: PostListItem, name: string): boolean => p.tags.includes(name)
export const noteInCategory = (n: NoteItem, name: string): boolean => n.category?.name === name
export const noteWithTag = (n: NoteItem, name: string): boolean => n.tags.includes(name)

/** 某分类/标签下的文章与灵感笔记（文章按既有更新时间倒序，笔记按日期倒序） */
export function collectTaxonomyItems(
  kind: TaxonomyKind,
  name: string,
  posts: PostListItem[],
  notes: NoteItem[],
): { posts: PostListItem[]; notes: NoteItem[] } {
  const hitPost = kind === 'category' ? postInCategory : postWithTag
  const hitNote = kind === 'category' ? noteInCategory : noteWithTag
  return {
    posts: posts.filter((p) => hitPost(p, name)),
    notes: notes.filter((n) => hitNote(n, name)).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
  }
}

/** 按名解析分类 id（Notion 式下拉保存前的名→id 换算）：
 *  命中既有分类直接返回 id；否则经 create 落库新建后返回新 id；
 *  空名返回 ''；新建失败也返回 ''（内容按无分类保存，不阻断保存）。 */
export async function resolveCategoryIdByName(
  cats: Array<{ id: string; name: string }>,
  name: string,
  create: (name: string) => Promise<{ id: string; name: string }>,
): Promise<string> {
  const n = name.trim()
  if (!n) return ''
  const hit = cats.find((c) => c.name === n)
  if (hit) return hit.id
  try {
    return (await create(n)).id
  } catch {
    return ''
  }
}
