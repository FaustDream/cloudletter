/**
 * 分类与标签路由单测（最小功能）：创建/重名 409/改名冲突 409/删除占用 409/删除 404。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
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

beforeAll(async () => {
  app = await startTestApp()
})

afterAll(async () => {
  await app.close()
  await app.prisma.$disconnect()
})

describe('分类 /categories', () => {
  it('创建：name → slug 自动生成；同名 409', async () => {
    const a = await inject('POST', '/categories', { name: '技术笔记', description: '技术相关' })
    expect(a.status).toBe(200)
    expect(a.body.slug).toBe('技术笔记') // slugify 保留中文字符

    const dup = await inject('POST', '/categories', { name: '技术笔记' })
    expect(dup.status).toBe(409)
  })

  it('缺 name → 422', async () => {
    expect((await inject('POST', '/categories', {})).status).toBe(422)
  })

  it('改名与其他分类 slug 冲突 → 409', async () => {
    await inject('POST', '/categories', { name: '生活' })
    const b = await inject('POST', '/categories', { name: '旅行' })
    const clash = await inject('PUT', `/categories/${b.body.id}`, { name: '生活' })
    expect(clash.status).toBe(409)
  })

  it('列表带文章计数', async () => {
    const cat = await inject('POST', '/categories', { name: '计数分类' })
    await inject('POST', '/posts', { title: '计数文章', categoryId: cat.body.id })
    const list = await inject('GET', '/categories')
    const item = list.body.items.find((c: any) => c.name === '计数分类')
    expect(item._count.posts).toBe(1)
  })

  it('删除：分类下有文章 → 409；空分类 → ok；未知 id → 404', async () => {
    const cat = await inject('POST', '/categories', { name: '占用分类' })
    await inject('POST', '/posts', { title: '占用文章', categoryId: cat.body.id })
    expect((await inject('DELETE', `/categories/${cat.body.id}`)).status).toBe(409)

    const empty = await inject('POST', '/categories', { name: '空分类' })
    expect((await inject('DELETE', `/categories/${empty.body.id}`)).status).toBe(200)
    expect((await inject('DELETE', '/categories/nope')).status).toBe(404)
  })
})

describe('标签 /tags', () => {
  it('创建：同名 409；缺 name 422', async () => {
    expect((await inject('POST', '/tags', { name: '前端' })).status).toBe(200)
    expect((await inject('POST', '/tags', { name: '前端' })).status).toBe(409)
    expect((await inject('POST', '/tags', {})).status).toBe(422)
  })

  it('改名：与其他标签同名 → 409；正常改名 → slug 同步', async () => {
    await inject('POST', '/tags', { name: '前端' })
    const b = await inject('POST', '/tags', { name: '后端' })
    expect((await inject('PUT', `/tags/${b.body.id}`, { name: '前端' })).status).toBe(409)
    const ok = await inject('PUT', `/tags/${b.body.id}`, { name: '服务端' })
    expect(ok.status).toBe(200)
    expect(ok.body.slug).toBeTruthy()
  })

  it('删除：未知 id → 404；已有 → ok', async () => {
    expect((await inject('DELETE', '/tags/nope')).status).toBe(404)
    const t = await inject('POST', '/tags', { name: '待删标签' })
    expect((await inject('DELETE', `/tags/${t.body.id}`)).status).toBe(200)
  })
})
