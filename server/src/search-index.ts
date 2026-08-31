/**
 * 全文检索索引（SQLite FTS5）：
 * - 数据源 = Post 表（rawMarkdown 为正文镜像；文件与 DB 原子一致，索引以 DB 为可信镜像）。
 * - 中文分词：unicode61 tokenizer 会把「连续 CJK」当成一个 token，子串搜不到；故索引与查询
 *   时都把 CJK 片段展开为「单字 + 双字」空格分词（bigram），配合 bm25 排序兼顾召回与精度。
 * - 调用约定：所有 API 写路径（create/update/delete/batch/restore）在成功提交后同步
 *   indexSearchPost / removeSearchPost；索引失败不阻断文章保存（仅告警，可 reindex 兜底）。
 * - FTS5 不可用（如 Prisma 捆绑 SQLite 不带 FTS5）时 isFtsReady=false，search 路由降级为 LIKE。
 */
import { prisma } from './prisma'

export const FTS_TABLE = 'post_search'

/** FTS5 是否可用（启动时探测一次，路由据此决定降级） */
let ftsReady = false

/** CJK 片段展开：连续中文拆成「单字 + 双字」，其余保留原词 */
export function segmentCjk(text: string): string {
  return String(text).replace(/[\u4e00-\u9fff]+/g, (run) => {
    const parts: string[] = []
    for (let i = 0; i < run.length; i++) {
      parts.push(run[i])
      if (i + 1 < run.length) parts.push(run.slice(i, i + 2))
    }
    return ` ${parts.join(' ')} `
  })
}

export function ftsAvailable(): boolean {
  return ftsReady
}

/** 建表（幂等）。返回是否可用；失败时 ftsReady=false，调用方降级。 */
export async function initSearchIndex(): Promise<boolean> {
  try {
    await prisma.$executeRawUnsafe(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
        slug UNINDEXED,
        title,
        body,
        category,
        tags,
        publishedAt UNINDEXED,
        draft UNINDEXED,
        tokenize = 'unicode61'
      )`,
    )
    ftsReady = true
  } catch (e) {
    ftsReady = false
    console.error('[search-index] FTS5 不可用，检索将降级为 LIKE:', (e as Error).message)
  }
  return ftsReady
}

/** 索引数据来源：DB Post 行 + 分类名 + 标签 */
async function loadPost(postId: string): Promise<SearchablePost | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { category: true, tags: { include: { tag: true } } },
  })
  if (!post) return null
  let fm: Record<string, unknown> = {}
  try {
    fm = JSON.parse(post.frontmatter || '{}')
  } catch {}
  return {
    slug: post.slug,
    title: post.title,
    rawMarkdown: post.rawMarkdown,
    category: post.category?.name ?? String(fm.category ?? ''),
    tags: post.tags.map((t) => t.tag.name),
    publishedAt: post.publishedAt ?? null,
    draft: post.status !== 'published',
  }
}

export interface SearchablePost {
  slug: string
  title: string
  rawMarkdown: string
  category: string
  tags: string[]
  publishedAt: Date | string | null
  draft: boolean
}

/** 正文清洗：去代码块与图片，转小写 + CJK 分词 */
function cleanBody(raw: string): string {
  return String(raw)
    .replace(/```[\s\S]*?```/gs, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .toLowerCase()
}

/** 索引一篇（DB 已提交成功后调用）；失败仅告警，不阻断业务 */
export async function indexSearchPost(postId: string): Promise<void> {
  if (!ftsReady) return
  try {
    const p = await loadPost(postId)
    if (!p) return
    // FTS5 无 upsert：先按 slug 删旧行再插入
    await prisma.$executeRawUnsafe(`DELETE FROM ${FTS_TABLE} WHERE slug = ?`, p.slug)
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${FTS_TABLE}(slug, title, body, category, tags, publishedAt, draft)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      p.slug,
      segmentCjk(p.title.toLowerCase()),
      segmentCjk(cleanBody(p.rawMarkdown) + ' ' + p.title.toLowerCase()),
      segmentCjk(p.category.toLowerCase()),
      p.tags.map((t) => t.toLowerCase()).join(' '),
      p.publishedAt ? new Date(p.publishedAt).toISOString() : '',
      p.draft ? 1 : 0,
    )
  } catch (e) {
    console.error('[search-index] index fail:', postId, (e as Error).message)
  }
}

/** 删除索引条目（文章删除后调用） */
export async function removeSearchPost(slug: string): Promise<void> {
  if (!ftsReady) return
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM ${FTS_TABLE} WHERE slug = ?`, slug)
  } catch (e) {
    console.error('[search-index] remove fail:', slug, (e as Error).message)
  }
}

/** 全量重建（维护端点 / 启动兜底用） */
export async function reindexAllSearch(): Promise<number> {
  if (!ftsReady) return 0
  try {
    await prisma.$executeRawUnsafe(`DELETE FROM ${FTS_TABLE}`)
  } catch (e) {
    console.error('[search-index] reindex clear fail:', (e as Error).message)
    return 0
  }
  const ids = await prisma.post.findMany({ select: { id: true } })
  // 串行逐篇（每篇 2 次执行）太慢：按 8 篇一批并行（indexSearchPost 内部自吞错，不阻断）
  const BATCH = 8
  for (let i = 0; i < ids.length; i += BATCH) {
    await Promise.all(ids.slice(i, i + BATCH).map(({ id }) => indexSearchPost(id)))
  }
  return ids.length
}

export interface SearchHit {
  slug: string
  draft: boolean
  publishedAt: string | null
  rawMarkdown: string
  title: string
}

export interface SearchArgs {
  q: string
  includeDraft?: boolean
  limit: number
}

const FTS_SPECIAL = /[\s"*()]/

/** 关键词 → FTS 查询表达式：分词后逐词 OR（bm25 排序兜住相关度） */
export function buildMatchExpression(q: string): string {
  const lower = q.toLowerCase()
  // CJK 片段拆成 单字+双字；拉丁按空白分词（unicode61 自会处理大小写/前缀不在本次范围）
  const segments = lower.split(/([\u4e00-\u9fff]+|[\s]+)/).filter(Boolean)
  const terms = new Set<string>()
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (/^\s*$/.test(s)) continue
    if (/[\u4e00-\u9fff]/.test(s)) {
      const chars = s.replace(/\s/g, '')
      for (let j = 0; j < chars.length; j++) {
        terms.add(chars[j])
        if (j + 1 < chars.length) terms.add(chars.slice(j, j + 2))
      }
    } else {
      for (const w of s.split(/\s+/)) if (w) terms.add(w)
    }
  }
  return [...terms]
    .map((t) => (FTS_SPECIAL.test(t) ? `"${t.replace(/"/g, '""')}"` : `"${t}"`))
    .join(' OR ')
}

/**
 * FTS 检索：返回命中文章（按 bm25 排序）——需要摘录时再按需取 rawMarkdown。
 * 查询用 OR（召回优先），bm25 排序保证相关命中在前；返回最多 limit 条。
 */
export async function searchFts(args: SearchArgs): Promise<Array<{ slug: string; draft: boolean; publishedAt: string | null }>> {
  const match = buildMatchExpression(args.q)
  const where = args.includeDraft ? '' : ' AND draft = 0'
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT slug, draft, publishedAt FROM ${FTS_TABLE}
     WHERE ${FTS_TABLE} MATCH ?${where}
     ORDER BY bm25(${FTS_TABLE}) LIMIT ?`,
    match,
    Math.min(Math.max(args.limit, 1), 50),
  )) as Array<{ slug: string; draft: number | boolean; publishedAt: string | null }>
  return rows.map((r) => ({ slug: r.slug, draft: !!r.draft, publishedAt: r.publishedAt }))
}