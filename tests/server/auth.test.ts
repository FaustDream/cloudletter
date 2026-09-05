/**
 * 会话层单测（最小功能）：
 * - createSession：token 64 位 hex、库内只存 sha256 哈希、remember 长 TTL
 * - requireAuth（经 /auth/me）：无 token 401、过期 401、活动续期
 * - extractBearer：Bearer 解析
 * 注意：./auth 会实例化 Prisma，必须等 startTestApp 设置临时 DATABASE_URL 后动态导入。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { startTestApp, type TestApp } from '@server/test-utils'
import { hashPassword } from '@server/crypto'

// 隔离 mailer：防止 .env 中 SMTP 配置生效导致真实发信
vi.mock('@server/mailer', () => ({
  smtpStatus: () => ({ ok: true, demo: true }),
  sendMail: async () => ({ sent: true, demoPath: 'test://demo-mail' }),
}))

let app: TestApp
let auth: typeof import('@server/auth')
let userId: string
let token: string

async function get(path: string, bearer?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(app.base + path, {
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

beforeAll(async () => {
  app = await startTestApp()
  auth = await import('@server/auth')
  const u = await app.prisma.user.create({
    data: { email: 'sess@test.local', passwordHash: hashPassword('pw-123456') },
  })
  userId = u.id
})

afterAll(async () => {
  await app.close()
  await app.prisma.$disconnect()
})

describe('createSession', () => {
  it('普通会话：token 64 位 hex，库内只存哈希，TTL ≈ 30 分钟', async () => {
    const s = await auth.createSession(userId)
    token = s.token
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const row = await app.prisma.session.findUnique({ where: { token: auth.hashToken(token) } })
    expect(row).not.toBeNull()
    const ttlMin = (row!.expiresAt.getTime() - Date.now()) / 60000
    expect(ttlMin).toBeGreaterThan(28)
    expect(ttlMin).toBeLessThanOrEqual(30.1)
  })

  it('remember 会话 TTL ≈ 30 天', async () => {
    const s = await auth.createSession(userId, true)
    const row = await app.prisma.session.findUnique({ where: { token: auth.hashToken(s.token) } })
    const days = (row!.expiresAt.getTime() - Date.now()) / 86400000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThanOrEqual(30.1)
  })
})

describe('extractBearer', () => {
  it('解析 Bearer 头；缺失/格式错返回 null', () => {
    const req = (h?: Record<string, string>) => ({ headers: h ?? {} }) as any
    expect(auth.extractBearer(req({ authorization: 'Bearer abc' }))).toBe('abc')
    expect(auth.extractBearer(req())).toBeNull()
    expect(auth.extractBearer(req({ authorization: 'Basic abc' }))).toBeNull()
  })
})

describe('requireAuth（经 GET /auth/me）', () => {
  it('有效 token → 200 且返回用户信息', async () => {
    const r = await get('/auth/me', token)
    expect(r.status).toBe(200)
    expect(r.body.user.email).toBe('sess@test.local')
  })

  it('无 token → 401 AUTH_REQUIRED', async () => {
    const r = await get('/auth/me')
    expect(r.status).toBe(401)
    expect(r.body.error.code).toBe('AUTH_REQUIRED')
  })

  it('过期会话 → 401', async () => {
    const s = await auth.createSession(userId)
    await app.prisma.session.update({
      where: { token: auth.hashToken(s.token) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const r = await get('/auth/me', s.token)
    expect(r.status).toBe(401)
  })

  it('活动续期：仅剩余 TTL 不足一半时才写库续期（避免每次请求一次 DB 写）', async () => {
    // 新会话（剩余充足）：不触发续期写
    const before = (await app.prisma.session.findUnique({ where: { token: auth.hashToken(token) } }))!.expiresAt
    await get('/auth/me', token)
    const afterFresh = (await app.prisma.session.findUnique({ where: { token: auth.hashToken(token) } }))!.expiresAt
    expect(afterFresh.getTime()).toBe(before.getTime())

    // 快过期会话（剩余 < 1/2 TTL）：续期后移
    const s = await auth.createSession(userId)
    await app.prisma.session.update({
      where: { token: auth.hashToken(s.token) },
      data: { expiresAt: new Date(Date.now() + 1000) },
    })
    const nearly = (await app.prisma.session.findUnique({ where: { token: auth.hashToken(s.token) } }))!.expiresAt
    await get('/auth/me', s.token)
    const renewed = (await app.prisma.session.findUnique({ where: { token: auth.hashToken(s.token) } }))!.expiresAt
    expect(renewed.getTime()).toBeGreaterThan(nearly.getTime())
  })

  it('登出删除会话；再访问 401', async () => {
    const res = await fetch(app.base + '/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    expect(await get('/auth/me', token).then((r) => r.status)).toBe(401)
  })
})
