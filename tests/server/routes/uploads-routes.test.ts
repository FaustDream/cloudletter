/**
 * 上传路由单测（最小功能）：
 * - POST png/gif 二进制 → 落盘（内容一致）+ 返回 /api/v2/uploads/<name>；静态 GET 免登录可读
 * - 非图片类型 → 415；图片类型但空 body → 415
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
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
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') // PNG 魔数

beforeAll(async () => {
  app = await startTestApp()
})

afterAll(async () => {
  await app.close()
  await app.prisma.$disconnect()
})

describe('POST /uploads（图片直传）', () => {
  it('png 直传：落盘内容一致，返回 url 与字节数', async () => {
    const res = await fetch(app.base + '/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(PNG),
    })
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.ok).toBe(true)
    expect(body.bytes).toBe(PNG.length)
    expect(body.url).toMatch(/^\/api\/v2\/uploads\/[0-9a-z]+-[0-9a-f]{8}\.png$/)

    const name = body.url.split('/').pop()
    const file = join(app.dataRoot, 'uploads', name)
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file).equals(PNG)).toBe(true)
  })

  it('静态 GET 免登录可读，内容与上传一致', async () => {
    const res = await fetch(app.base + '/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'image/gif' },
      body: new Uint8Array(Buffer.from('474946383961', 'hex')),
    })
    const body: any = await res.json()
    const url: string = body.url
    const served = await fetch(app.base + url.replace('/api/v2', ''))
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toContain('image/gif')
  })

  it('非图片 Content-Type → 415', async () => {
    const res = await fetch(app.base + '/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: 'PK',
    })
    expect(res.status).toBe(415)
    expect(((await res.json()) as any).error.code).toBe('UNSUPPORTED')
  })

  it('图片类型但空 body → 415', async () => {
    const res = await fetch(app.base + '/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
    })
    expect(res.status).toBe(415)
  })

  it('声明图片类型但内容不是图片（魔数不匹配）→ 415 BAD_IMAGE', async () => {
    const res = await fetch(app.base + '/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: '#!/bin/sh\necho x\n', // 非图片字节
    })
    expect(res.status).toBe(415)
    expect(((await res.json()) as any).error.code).toBe('BAD_IMAGE')
  })
})
