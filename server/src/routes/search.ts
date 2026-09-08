/**
 * 搜索路由（V2）：对文章做标题 + 正文检索，基于 SQLite FTS5 索引（search-index.ts 建表/维护）。
 * - 索引数据源 = Post 表（rawMarkdown 镜像；文章写路径已同步索引，启动/维护端可全量重建）。
 * - 中文按「单字+双字」分段索引/查询 + bm25 排序；草稿默认排除，includeDraft=1 纳入。
 * - FTS5 不可用时自动降级为 DB LIKE（标题/正文包含匹配），保证功能可用。
 * - 参数封顶：q ≤100 字符、limit ≤50，防止超大查询拖垮服务。
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { ftsAvailable, searchFts } from '../search-index'

export const search = Router()
search.use(requireAuth)

/** 摘取关键词附近的一段正文作为摘要片段 */
function excerpt(text: string, q: string, radius = 56): string {
  const ql = q.toLowerCase()
  const idx = text.toLowerCase().indexOf(ql)
  if (idx < 0) return text.slice(0, radius * 2).replace(/\n+/g, ' ').trim()
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + q.length + radius)
  const slice = text.slice(start, end).replace(/\s+/g, ' ')
  return (start > 0 ? '…' : '') + slice + (end < text.length ? '…' : '')
}

/** 轻量 frontmatter 读取（仅做补充信息；slug 与索引同源） */
function fmTags(frontmatter: string): string[] {
  try {
    const fm = JSON.parse(frontmatter || '{}') as Record<string, unknown>
    return Array.isArray(fm.tags) ? (fm.tags as string[]).filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

/** 正文可检索文本（去代码块/图片，供精确过滤与摘录） */
function searchableText(raw: string): string {
  return String(raw).replace(/```[\s\S]*?```/gs, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
}

/**
 * 精确过滤：FTS 的 OR 分词优先召回，但单字（如「的」「在」）会引入噪声；这里要求查询词
 * 真实出现在标题/正文（与旧文件扫描语义一致：整串子串，或多英文词逐个命中），保留 bm25 排序。
 */
function textHit(title: string, raw: string, q: string): boolean {
  const ql = q.toLowerCase()
  const hay = `${title} ${searchableText(raw)}`.toLowerCase()
  if (hay.includes(ql)) return true
  const words = ql.split(/\s+/).filter(Boolean)
  return words.length > 1 && words.every((w) => hay.includes(w))
}

search.get('/', ah(async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100)
  const includeDraft = req.query.includeDraft === '1'
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50)
  if (!q) return res.json({ items: [], total: 0 })

  // 降级路径：FTS5 不可用 → DB LIKE（标题 + 正文镜像），行为等价但随量级变慢
  if (!ftsAvailable()) {
    const rows = await prisma.post.findMany({
      where: { OR: [{ title: { contains: q } }, { rawMarkdown: { contains: q } }], ...(includeDraft ? {} : { status: 'published' }) },
      select: { slug: true, title: true, rawMarkdown: true, frontmatter: true, status: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    })
    return res.json({
      items: rows.map((p) => ({
        slug: p.slug,
        title: p.title,
        excerpt: excerpt(p.rawMarkdown, q),
        category: null,
        tags: fmTags(p.frontmatter),
        publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
        draft: p.status !== 'published',
      })),
      total: rows.length,
    })
  }

  const hits = await searchFts({ q, includeDraft, limit })
  if (hits.length === 0) return res.json({ items: [], total: 0 })

  // 按 slug 取正文做摘录（仅在命中集内取，避免全表拉取）
  const slugs = hits.map((h) => h.slug)
  const rows = await prisma.post.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, title: true, rawMarkdown: true, frontmatter: true, status: true, publishedAt: true, category: { select: { name: true } } },
  })
  const bySlug = new Map(rows.map((r) => [r.slug, r]))
  const items = hits
    .map((h) => {
      const p = bySlug.get(h.slug)
      if (!p) return null
      // 精确过滤（OR 分词召回可能有噪声），过滤不过的按原 bm25 顺序输出
      if (!textHit(p.title, p.rawMarkdown, q)) return null
      return {
        slug: p.slug,
        title: p.title,
        excerpt: excerpt(p.rawMarkdown, q),
        category: p.category?.name ?? null,
        tags: fmTags(p.frontmatter),
        publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
        draft: p.status !== 'published',
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  res.json({ items, total: items.length })
}))

/** 全量重建索引（维护端点）：从 Post 表重建 FTS，个人规模毫秒级完成 */
search.post('/reindex', ah(async (_req, res) => {
  if (!ftsAvailable()) return err(res, 503, 'SEARCH_UNAVAILABLE', 'FTS 索引不可用')
  const { reindexAllSearch } = await import('../search-index')
  const count = await reindexAllSearch()
  res.json({ ok: true, indexed: count })
}))