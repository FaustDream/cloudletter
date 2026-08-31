/**
 * 文章路由单测（最小功能）：
 * - 创建：标题 slug / 非 ASCII 时间戳 slug / 自定义 slug / 重名加后缀 / 校验 422 / 文件与 v1 快照落盘
 * - 查询：列表字段（chars/readMin/tags/category）、status 过滤、详情 404
 * - 更新：乐观锁（baseVersion 过期 409）、slug 改名（文件同步/冲突 409）、发布置 publishedAt、
 *          '' 清空 summary/category（keepEmpty）、标签去重不 500、文件 frontmatter 同步
 * - 删除：DB + 文件 + 版本目录全清理
 * - 版本：列表倒序、读取快照正文、恢复生成新版本
 * - 批量：发布/转草稿/打标签（回写文件）/删除
 * 只 mock auth（requireAuth 注入假用户），聚焦业务规则。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startTestApp, type TestApp } from '../test-utils'

vi.mock('../auth', async (importOriginal) => {
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

async function inject(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(app.base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

function postFile(slug: string): string {
  return join(app.contentRoot, 'src', 'content', 'posts', `${slug}.md`)
}

async function createPost(body: Record<string, unknown>) {
  const r = await inject('POST', '/posts', body)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body as { id: string; slug: string; status: string }
}

beforeAll(async () => {
  app = await startTestApp()
})

afterAll(async () => {
  await app.close()
  await app.prisma.$disconnect()
})

describe('POST /posts（创建）', () => {
  it('标题 ASCII → slugify；文件与 v1 版本快照落盘', async () => {
    const p = await createPost({ title: 'Hello World', rawMarkdown: '# 正文一' })
    expect(p.slug).toBe('hello-world')
    expect(existsSync(postFile('hello-world'))).toBe(true)
    const raw = readFileSync(postFile('hello-world'), 'utf-8')
    expect(raw).toContain('title: Hello World')
    expect(raw).toContain('draft: true')
    expect(raw).toContain('# 正文一')
    // v1 快照
    const revs = await inject('GET', `/posts/${p.id}/revisions`)
    expect(revs.body.items).toHaveLength(1)
    expect(revs.body.items[0].version).toBe(1)
    expect((await inject('GET', `/posts/${p.id}/revisions/1`)).body.content).toBe('# 正文一')
  })

  it('非 ASCII 标题 → 时间戳 slug 兜底', async () => {
    const p = await createPost({ title: '云笺集指南' })
    expect(p.slug).toMatch(/^post-[0-9a-z]+$/)
  })

  it('自定义 slug 优先；重复 slug 加时间戳后缀', async () => {
    const a = await createPost({ title: 'A 文章', slug: 'my-slug' })
    expect(a.slug).toBe('my-slug')
    const b = await createPost({ title: 'B 文章', slug: 'my-slug' })
    expect(b.slug).not.toBe('my-slug')
    expect(b.slug.startsWith('my-slug-')).toBe(true)
  })

  it('校验：缺标题 422；不存在的分类 422', async () => {
    expect((await inject('POST', '/posts', {})).status).toBe(422)
    expect((await inject('POST', '/posts', { title: 'T', categoryId: 'nope' })).status).toBe(422)
  })

  it('status=published 直接发布并置 publishedAt；frontmatter 写入 category/tags', async () => {
    const cat = await inject('POST', '/categories', { name: '随笔' })
    const p = await createPost({
      title: '已发布文', status: 'published', categoryId: cat.body.id, tags: ['aa', 'bb'],
    })
    expect(p.status).toBe('published')
    const detail = await inject('GET', `/posts/${p.id}`)
    expect(detail.body.publishedAt).not.toBeNull()
    expect(detail.body.tags).toEqual(['aa', 'bb'])
    const raw = readFileSync(postFile(detail.body.slug), 'utf-8')
    expect(raw).toContain("category: '随笔'")
    expect(raw).toContain('tags: [aa, bb]')
    expect(raw).toContain('draft: false')
  })

  it('重复标签名去重，不因 PostTag 复合主键冲突 500', async () => {
    const p = await createPost({ title: '重复标签文', tags: ['dup', 'dup'] })
    const detail = await inject('GET', `/posts/${p.id}`)
    expect(detail.status).toBe(200)
    expect(detail.body.tags).toEqual(['dup'])
  })
})

describe('GET /posts（列表与详情）', () => {
  it('列表返回 chars/readMin/tag 名/分类名；status 过滤生效', async () => {
    await createPost({ title: '列表草稿', rawMarkdown: '一二三四五六七八九十' })
    const list = await inject('GET', '/posts?status=draft')
    expect(list.status).toBe(200)
    const item = list.body.items.find((x: any) => x.title === '列表草稿')
    expect(item.chars).toBe(10)
    expect(item.readMin).toBe(1)
    expect(item.status).toBe('draft')
    const pub = await inject('GET', '/posts?status=published')
    expect(pub.body.items.some((x: any) => x.title === '列表草稿')).toBe(false)
  })

  it('未知 id → 404 NOT_FOUND', async () => {
    const r = await inject('GET', '/posts/nope')
    expect(r.status).toBe(404)
    expect(r.body.error.code).toBe('NOT_FOUND')
  })
})

describe('PUT /posts/:id（更新）', () => {
  it('无 baseVersion 正常更新；正文变更产生 v2 快照', async () => {
    const p = await createPost({ title: '乐观锁文', rawMarkdown: 'v1' })
    const r = await inject('PUT', `/posts/${p.id}`, { rawMarkdown: 'v2', title: '乐观锁文改' })
    expect(r.status).toBe(200)
    const revs = (await inject('GET', `/posts/${p.id}/revisions`)).body.items
    expect(revs).toHaveLength(2)
    expect(revs[0].version).toBe(2) // 倒序
    expect((await inject('GET', `/posts/${p.id}/revisions/2`)).body.content).toBe('v2')
    expect(readFileSync(postFile(p.slug), 'utf-8')).toContain('v2')
  })

  it('过期的 baseVersion → 409 CONFLICT + serverUpdatedAt；相同正文不产生新版本', async () => {
    const p = await createPost({ title: '冲突文', rawMarkdown: 'c1' })
    const detail = await inject('GET', `/posts/${p.id}`)
    const stale = new Date(detail.body.updatedAt).getTime()
    await inject('PUT', `/posts/${p.id}`, { rawMarkdown: 'c2' }) // updatedAt 前移
    const conflict = await inject('PUT', `/posts/${p.id}`, { rawMarkdown: 'c3', baseVersion: stale })
    expect(conflict.status).toBe(409)
    expect(conflict.body.error.code).toBe('CONFLICT')
    expect(conflict.body.error.details.serverUpdatedAt).toBeTruthy()

    // baseVersion 匹配 → 更新成功；内容未变 → 不加版本
    const fresh = await inject('GET', `/posts/${p.id}`)
    const same = await inject('PUT', `/posts/${p.id}`, {
      rawMarkdown: 'c2', baseVersion: new Date(fresh.body.updatedAt).getTime(),
    })
    expect(same.status).toBe(200)
    expect((await inject('GET', `/posts/${p.id}/revisions`)).body.items).toHaveLength(2)
  })

  it('slug 改名同步文件与版本目录；与他人冲突 → 409', async () => {
    const p = await createPost({ title: '改名文', rawMarkdown: 'r1', slug: 'rename-old' })
    const r = await inject('PUT', `/posts/${p.id}`, { slug: 'rename-new' })
    expect(r.status).toBe(200)
    expect(r.body.slug).toBe('rename-new')
    expect(existsSync(postFile('rename-old'))).toBe(false)
    expect(existsSync(postFile('rename-new'))).toBe(true)

    await createPost({ title: '占用文', slug: 'taken' })
    expect((await inject('PUT', `/posts/${p.id}`, { slug: 'taken' })).status).toBe(409)
  })

  it("summary: '' 与 categoryId: '' 清空字段（keepEmpty 语义）", async () => {
    const cat = await inject('POST', '/categories', { name: '临时分类' })
    const p = await createPost({ title: '清空文', summary: '原摘要', categoryId: cat.body.id })
    const r = await inject('PUT', `/posts/${p.id}`, { summary: '', categoryId: '' })
    expect(r.status).toBe(200)
    const detail = await inject('GET', `/posts/${p.id}`)
    expect(detail.body.summary).toBe('')
    expect(detail.body.categoryId).toBeNull()
    const raw = readFileSync(postFile(detail.body.slug), 'utf-8')
    expect(raw).not.toContain('description:')
    expect(raw).not.toContain('category:')
  })

  it('标签更新回写文件 frontmatter；空数组清空', async () => {
    const p = await createPost({ title: '标签同步文', tags: ['旧标签'] })
    await inject('PUT', `/posts/${p.id}`, { tags: ['新标签', '多标签'] })
    const raw = readFileSync(postFile(p.slug), 'utf-8')
    expect(raw).toContain('新标签')
    await inject('PUT', `/posts/${p.id}`, { tags: [] })
    expect(readFileSync(postFile(p.slug), 'utf-8')).not.toContain('tags:')
  })

  it('发布状态流转：draft → published 置 publishedAt；published → draft 保留首发时间', async () => {
    const p = await createPost({ title: '状态文' })
    await inject('PUT', `/posts/${p.id}`, { status: 'published' })
    const d1 = (await inject('GET', `/posts/${p.id}`)).body
    expect(d1.publishedAt).not.toBeNull()
    await inject('PUT', `/posts/${p.id}`, { status: 'draft' })
    const d2 = (await inject('GET', `/posts/${p.id}`)).body
    expect(d2.status).toBe('draft')
    expect(d2.publishedAt).not.toBeNull()
  })
})

describe('DELETE /posts/:id', () => {
  it('删除 DB、文章文件与版本目录', async () => {
    const p = await createPost({ title: '待删文', rawMarkdown: 'del' })
    expect(existsSync(postFile(p.slug))).toBe(true)
    const r = await inject('DELETE', `/posts/${p.id}`)
    expect(r.status).toBe(200)
    expect((await inject('GET', `/posts/${p.id}`)).status).toBe(404)
    expect(existsSync(postFile(p.slug))).toBe(false)
    expect((await inject('GET', `/posts/${p.id}/revisions/1`)).status).toBe(404)
  })

  it('未知 id → 404', async () => {
    expect((await inject('DELETE', '/posts/nope')).status).toBe(404)
  })
})

describe('版本恢复', () => {
  it('restore 把旧版本内容写回正文并生成新版本号', async () => {
    const p = await createPost({ title: '恢复文', rawMarkdown: '第一版' })
    await inject('PUT', `/posts/${p.id}`, { rawMarkdown: '第二版' })
    const r = await inject('POST', `/posts/${p.id}/revisions/1/restore`)
    expect(r.status).toBe(200)
    const detail = (await inject('GET', `/posts/${p.id}`)).body
    expect(detail.rawMarkdown).toBe('第一版')
    const revs = (await inject('GET', `/posts/${p.id}/revisions`)).body.items
    expect(revs[0].version).toBe(3)
    expect((await inject('GET', `/posts/${p.id}/revisions/3`)).body.content).toBe('第一版')
  })

  it('不存在的版本 → 404', async () => {
    const p = await createPost({ title: '无版本恢复' })
    expect((await inject('POST', `/posts/${p.id}/revisions/99/restore`)).status).toBe(404)
  })
})

describe('POST /posts/batch（批量操作）', () => {
  it('批量发布：状态与 publishedAt 更新，文件 draft 翻转', async () => {
    const a = await createPost({ title: '批量A' })
    const b = await createPost({ title: '批量B' })
    const r = await inject('POST', '/posts/batch', { action: 'publish', ids: [a.id, b.id] })
    expect(r.status).toBe(200)
    expect(r.body.affected).toBe(2)
    expect(readFileSync(postFile(a.slug), 'utf-8')).toContain('draft: false')
  })

  it('批量打标签：DB 关联与文件 frontmatter 同步（不落文件即分叉）', async () => {
    const a = await createPost({ title: '打标签A' })
    const r = await inject('POST', '/posts/batch', { action: 'tag', ids: [a.id], payload: { tags: ['批量标签'] } })
    expect(r.status).toBe(200)
    const detail = (await inject('GET', `/posts/${a.id}`)).body
    expect(detail.tags).toEqual(['批量标签'])
    expect(readFileSync(postFile(a.slug), 'utf-8')).toContain('批量标签')
  })

  it('批量校验：非法 action / 空 ids / tag 空数组 → 422', async () => {
    expect((await inject('POST', '/posts/batch', { action: 'nope', ids: ['x'] })).status).toBe(422)
    expect((await inject('POST', '/posts/batch', { action: 'delete', ids: [] })).status).toBe(422)
    expect((await inject('POST', '/posts/batch', { action: 'tag', ids: ['x'], payload: { tags: [] } })).status).toBe(422)
  })

  it('批量删除：DB 与文件同清；空目标 404', async () => {
    const a = await createPost({ title: '批量删A' })
    const r = await inject('POST', '/posts/batch', { action: 'delete', ids: [a.id] })
    expect(r.status).toBe(200)
    expect(existsSync(postFile(a.slug))).toBe(false)
    expect((await inject('POST', '/posts/batch', { action: 'delete', ids: ['nope1', 'nope2'] })).status).toBe(404)
  })
})
