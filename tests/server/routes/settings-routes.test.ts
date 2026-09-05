/**
 * 站点设置路由单测（最小功能）：
 * - GET 初始为 {}；PUT 合并白名单分组（增量合并，不整体覆盖）
 * - 非白名单分组 → 422；非对象值忽略；同时写入 settings/site.json
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe('站点设置 /settings', () => {
  it('初始 GET 返回空对象', async () => {
    const r = await inject('GET', '/settings')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({})
  })

  it('PUT 写入分组并落库；再次 PUT 增量合并不覆盖其他分组', async () => {
    const put1 = await inject('PUT', '/settings', {
      appearance: { theme: 'dark', accent: '#185FA5' },
    })
    expect(put1.status).toBe(200)
    expect((await inject('GET', '/settings')).body.appearance.theme).toBe('dark')

    await inject('PUT', '/settings', { layout: { sidebar: 'left' } })
    const merged = (await inject('GET', '/settings')).body
    expect(merged.appearance.theme).toBe('dark')
    expect(merged.layout.sidebar).toBe('left')
  })

  it('非白名单分组 → 422；非对象分组值被忽略', async () => {
    const bad = await inject('PUT', '/settings', { hack: true })
    expect(bad.status).toBe(422)
    expect(bad.body.error.code).toBe('VALIDATION')

    await inject('PUT', '/settings', { appearance: 'not-an-object' })
    const cur = (await inject('GET', '/settings')).body
    expect(typeof cur.appearance).toBe('object') // 原值未被字符串覆盖
  })

  it('设置写入 settings/site.json 文件', async () => {
    const siteJson = join(app.contentRoot, 'src', 'content', '_settings', 'site.json')
    expect(existsSync(siteJson)).toBe(true)
    const parsed = JSON.parse(readFileSync(siteJson, 'utf-8'))
    expect(parsed.appearance.theme).toBe('dark')
  })
})
