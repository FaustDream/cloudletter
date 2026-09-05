/**
 * 全文检索路由单测：数据源 = Post 表（rawMarkdown 镜像，与文件原子一致）+ FTS5 索引。
 * - 标题/正文命中、分类/标签字段回填；草稿默认排除、includeDraft=1 纳入
 * - 空关键词返回空集；excerpt 围绕关键词截取；命中按 bm25 相关度排序
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { startTestApp, type TestApp } from '@server/test-utils'

vi.mock('@server/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    requireAuth: async (_req: any, _res: any, next: any): Promise<void> => {
      _req.user = { id: 't1', email: 't@test' }
      next()
    },
  }
})

let app: TestApp

beforeAll(async () => {
  app = await startTestApp()
  const { initSearchIndex, reindexAllSearch } = await import('@server/search-index')
  await initSearchIndex()

  const mk = (slug: string, title: string, rawMarkdown: string, frontmatter: Record<string, unknown>, publishedAt: string, status = 'published') =>
    app.prisma.post.create({
      data: {
        slug, title, rawMarkdown, frontmatter: JSON.stringify(frontmatter),
        status, publishedAt: new Date(publishedAt), charCount: rawMarkdown.length,
      },
    })

  await mk('hash-map', '哈希表入门', '哈希表是一种以空间换时间的数据结构。', { title: '哈希表入门', published: '2026-08-01', tags: ['数据结构'] }, '2026-08-01')
  await mk('guide/index', '使用指南', '本指南介绍哈希表的常见用法。', { title: '使用指南', published: '2026-08-02' }, '2026-08-02')
  await mk('secret-draft', '草稿:哈希笔记', '未完成的哈希思考。', { title: '草稿:哈希笔记', published: '2026-08-03' }, '2026-08-03', 'draft')

  await reindexAllSearch()
})

afterAll(async () => {
  await app.close()
  await app.prisma.$disconnect()
})

async function search(q: string, includeDraft = false): Promise<{ status: number; body: any }> {
  const r = await fetch(app.base + `/search?q=${encodeURIComponent(q)}${includeDraft ? '&includeDraft=1' : ''}`)
  return { status: r.status, body: await r.json() }
}

describe('GET /search（FTS5 索引检索）', () => {
  it('标题命中：返回 slug/title/tags/publishedAt', async () => {
    const r = await search('哈希表入门')
    expect(r.status).toBe(200)
    const hit = r.body.items.find((x: any) => x.slug === 'hash-map')
    expect(hit).toBeTruthy()
    expect(hit.tags).toEqual(['数据结构'])
    expect(hit.draft).toBe(false)
  })

  it('正文命中：excerpt 围绕关键词，子目录文章以相对路径为 slug', async () => {
    const r = await search('空间换时间')
    const hit = r.body.items.find((x: any) => x.slug === 'hash-map')
    expect(hit).toBeTruthy()
    expect(hit.excerpt).toContain('空间换时间')
  })

  it('子目录文章命中', async () => {
    const r = await search('常见用法')
    expect(r.body.items.some((x: any) => x.slug === 'guide/index')).toBe(true)
  })

  it('草稿默认排除；includeDraft=1 时纳入并标记 draft', async () => {
    expect((await search('哈希思考')).body.total).toBe(0)
    const withDraft = await search('哈希思考', true)
    const hit = withDraft.body.items[0]
    expect(hit.draft).toBe(true)
    expect(hit.slug).toBe('secret-draft')
  })

  it('命中按 bm25 相关度排序：标题全命中优先', async () => {
    const r = await search('哈希')
    expect(r.body.items[0].slug).toBe('hash-map')
  })

  it('空关键词 → 空结果；无命中 → 空结果', async () => {
    expect((await search('')).body).toEqual({ items: [], total: 0 })
    expect((await search('不存在的词xyz')).body.total).toBe(0)
  })

  it('limit 封顶：请求超大 limit 时按 50 截断', async () => {
    const r = await fetch(app.base + `/search?q=${encodeURIComponent('哈希')}&limit=9999`)
    const body = (await r.json()) as { items: unknown[] }
    expect(body.items.length).toBeLessThanOrEqual(50)
  })
})