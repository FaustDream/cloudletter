/**
 * 认证路由单测（最小功能）：
 * - login：成功/密码错/缺参/未知邮箱同文案；TOTP 强制（428/401）
 * - 2fa：setup → enable（校验动态码）→ 登录要求动态码 → disable
 * - profile / password：改昵称；改密码错旧密码 401、成功后撤销其他会话且保留当前会话
 * - 邮箱验证码登录：demo 发码 → 错码一次作废 → 正确码登录
 * - 重置密码：demo 发链接 → 重置成功后旧会话全部失效
 * 只 mock mailer（捕获验证码文本），requireAuth 不 mock（随登录态真实走通）。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { startTestApp, type TestApp } from '../test-utils'
import { hashPassword, generateTOTPSecret, generateTOTP } from '../crypto'

vi.mock('../mailer', () => ({
  smtpStatus: () => ({ ok: true, demo: true }),
  sendMail: vi.fn(async () => ({ sent: true, demoPath: 'test://demo-mail' })),
}))
import { sendMail } from '../mailer'

let app: TestApp
const PW = 'old-password-1'

async function inject(method: string, path: string, body?: unknown, bearer?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(app.base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** 从 mock 的邮件文本里提取 N 位验证码 */
function lastMailCode(): string {
  const calls = (sendMail as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[ { text: string } ]>
  const text = calls.at(-1)![0].text
  const m = text.match(/验证码是：([A-Z2-9]{8})/) ?? text.match(/reset=([0-9a-f]{64})/)
  expect(m, '邮件文本应包含验证码或重置 token').not.toBeNull()
  return m![1]
}

/** 从图形验证码 SVG data URI 中解析出 4 位验证码（响应不再明文回传，仅供测试用） */
function capText(svgDataUri: string): string {
  const svg = Buffer.from(String(svgDataUri).split(',')[1] ?? '', 'base64').toString('utf-8')
  const chars = [...svg.matchAll(/>([A-Z2-9])<\/text>/g)].map((m) => m[1]).join('')
  expect(chars.length, 'SVG 应含 4 位验证码字符').toBe(4)
  return chars
}

beforeAll(async () => {
  app = await startTestApp()
  await app.prisma.user.create({ data: { email: 'u1@test.local', passwordHash: hashPassword(PW), nickname: '旧昵称' } })
  await app.prisma.user.create({ data: { email: 'u2@test.local', passwordHash: hashPassword(PW) } })
})

afterAll(async () => {
  await app.close()
  await app.prisma.$disconnect()
})

describe('POST /auth/login（口令登录）', () => {
  it('正确口令 → 200 token；错误口令 → 401；未知邮箱同样 401 文案（防枚举）', async () => {
    const ok = await inject('POST', '/auth/login', { email: 'u1@test.local', password: PW })
    expect(ok.status).toBe(200)
    expect(ok.body.token).toMatch(/^[0-9a-f]{64}$/)

    const bad = await inject('POST', '/auth/login', { email: 'u1@test.local', password: 'wrong' })
    expect(bad.status).toBe(401)
    expect(bad.body.error.code).toBe('AUTH_REQUIRED')

    const ghost = await inject('POST', '/auth/login', { email: 'nobody@test.local', password: 'x' })
    expect(ghost.status).toBe(401)
    expect(ghost.body.error.message).toBe(bad.body.error.message)
  })

  it('缺 email/password → 422', async () => {
    expect((await inject('POST', '/auth/login', { email: 'u1@test.local' })).status).toBe(422)
    expect((await inject('POST', '/auth/login', {})).status).toBe(422)
  })
})

describe('个人资料与改密码', () => {
  it('PUT /auth/profile 更新昵称', async () => {
    const login = await inject('POST', '/auth/login', { email: 'u1@test.local', password: PW })
    const r = await inject('PUT', '/auth/profile', { nickname: '新昵称' }, login.body.token)
    expect(r.status).toBe(200)
    expect(r.body.user.nickname).toBe('新昵称')
  })

  it('改密码：旧密码错 → 401；成功 → 200，其他会话失效、当前会话保留', async () => {
    const a = await inject('POST', '/auth/login', { email: 'u1@test.local', password: PW })
    const b = await inject('POST', '/auth/login', { email: 'u1@test.local', password: PW })

    const bad = await inject('POST', '/auth/password', { oldPassword: 'wrong', newPassword: 'new-password-9' }, a.body.token)
    expect(bad.status).toBe(401)

    const ok = await inject('POST', '/auth/password', { oldPassword: PW, newPassword: 'new-password-9' }, a.body.token)
    expect(ok.status).toBe(200)
    // 当前会话保留
    expect((await inject('GET', '/auth/me', undefined, a.body.token)).status).toBe(200)
    // 其他会话撤销
    expect((await inject('GET', '/auth/me', undefined, b.body.token)).status).toBe(401)
    // 新密码生效
    expect((await inject('POST', '/auth/login', { email: 'u1@test.local', password: 'new-password-9' })).status).toBe(200)

    // 新密码至少 8 位
    const short = await inject('POST', '/auth/password', { oldPassword: 'new-password-9', newPassword: 'short' }, a.body.token)
    expect(short.status).toBe(422)
  })
})

describe('两步验证（TOTP）', () => {
  it('setup → enable（错码 401 / 对码 200）→ 登录强制动态码 → disable 还原', async () => {
    const login = await inject('POST', '/auth/login', { email: 'u2@test.local', password: PW })
    const bearer = login.body.token

    const setup = await inject('POST', '/auth/2fa/setup', undefined, bearer)
    expect(setup.status).toBe(200)
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(setup.body.otpauthUrl).toContain('secret=')
    // setup 后：未确认开启 → pending
    const st1 = await inject('GET', '/auth/2fa/status', undefined, bearer)
    expect(st1.body).toEqual({ enabled: false, pending: true })

    // 错误动态码 → 401，开启失败
    const bad = await inject('POST', '/auth/2fa/enable', { token: '000000' }, bearer)
    expect(bad.status).toBe(401)

    // 从库中读 hex secret 生成正确动态码 → 开启成功
    const u = await app.prisma.user.findUnique({ where: { email: 'u2@test.local' } })
    const good = await inject('POST', '/auth/2fa/enable', { token: generateTOTP(u!.totpSecret) }, bearer)
    expect(good.status).toBe(200)
    expect((await inject('GET', '/auth/2fa/status', undefined, bearer)).body).toEqual({ enabled: true, pending: false })

    // 开启后：不带动态码登录 → 428 TOTP_REQUIRED；错码 → 401；对码 → 200
    const noTotp = await inject('POST', '/auth/login', { email: 'u2@test.local', password: PW })
    expect(noTotp.status).toBe(428)
    expect(noTotp.body.error.code).toBe('TOTP_REQUIRED')
    expect((await inject('POST', '/auth/login', { email: 'u2@test.local', password: PW, totp: '000000' })).status).toBe(401)
    const u2 = await app.prisma.user.findUnique({ where: { email: 'u2@test.local' } })
    const okLogin = await inject('POST', '/auth/login', {
      email: 'u2@test.local', password: PW, totp: generateTOTP(u2!.totpSecret),
    })
    expect(okLogin.status).toBe(200)

    // disable：需密码 + 动态码；之后登录不再要求动态码
    const off = await inject('POST', '/auth/2fa/disable', {
      password: PW, token: generateTOTP(u2!.totpSecret),
    }, okLogin.body.token)
    expect(off.status).toBe(200)
    expect((await inject('POST', '/auth/login', { email: 'u2@test.local', password: PW })).status).toBe(200)
  })

  it('未 setup 直接 enable → 400 NO_SECRET', async () => {
    await app.prisma.user.create({ data: { email: 'u3@test.local', passwordHash: hashPassword(PW) } })
    const login = await inject('POST', '/auth/login', { email: 'u3@test.local', password: PW })
    const bearer = login.body.token
    expect((await inject('POST', '/auth/2fa/enable', { token: '000000' }, bearer)).status).toBe(400)
  })
})

describe('连续失败锁定', () => {
  it('错 5 次锁定（423），锁定期间正确密码也拒绝', async () => {
    await app.prisma.user.create({ data: { email: 'lock@test.local', passwordHash: hashPassword(PW) } })
    const tryLogin = (captcha?: { captchaId: string; captcha: string }) =>
      inject('POST', '/auth/login', { email: 'lock@test.local', password: 'wrong', ...captcha })

    // 前 2 次：普通 401；第 3 次起要求图形验证码（响应只含 SVG data URI，无明文）
    expect((await tryLogin()).body.error.code).toBe('AUTH_REQUIRED')
    expect((await tryLogin()).body.error.code).toBe('AUTH_REQUIRED')
    const c1 = await tryLogin()
    expect(c1.body.error.code).toBe('CAPTCHA_REQUIRED')
    expect(c1.body.error.details.captchaSvg).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(c1.body.error.details.text).toBeUndefined()
    const cap1 = { captchaId: c1.body.error.details.captchaId, captcha: capText(c1.body.error.details.captchaSvg) }
    // 第 4 次：验证码对但密码错 → 换发新验证码
    const c2 = await tryLogin(cap1)
    expect(c2.body.error.code).toBe('CAPTCHA_REQUIRED')
    const cap2 = { captchaId: c2.body.error.details.captchaId, captcha: capText(c2.body.error.details.captchaSvg) }
    // 第 5 次：锁定
    const c3 = await tryLogin(cap2)
    expect(c3.status).toBe(423)
    expect(c3.body.error.code).toBe('ACCOUNT_LOCKED')
    // 锁定期间正确密码也 423
    const locked = await inject('POST', '/auth/login', { email: 'lock@test.local', password: PW })
    expect(locked.status).toBe(423)
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED')
  })
})

describe('邮箱验证码登录', () => {
  it('demo 发码 → 错码一次作废 → 重发后正确码登录成功', async () => {
    const s1 = await inject('POST', '/auth/send-code', { email: 'u1@test.local' })
    expect(s1.status).toBe(200)
    expect(s1.body.mode).toBe('demo')
    const code1 = lastMailCode()

    const bad = await inject('POST', '/auth/login-by-code', { email: 'u1@test.local', code: 'ZZZZ9999' })
    expect(bad.status).toBe(401)
    // 原码已被「错一次作废」
    expect((await inject('POST', '/auth/login-by-code', { email: 'u1@test.local', code: code1 })).status).toBe(401)

    await inject('POST', '/auth/send-code', { email: 'u1@test.local' })
    const ok = await inject('POST', '/auth/login-by-code', { email: 'u1@test.local', code: lastMailCode() })
    expect(ok.status).toBe(200)
    expect(ok.body.token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('邮箱格式非法 → 422', async () => {
    expect((await inject('POST', '/auth/send-code', { email: 'not-an-email' })).status).toBe(422)
  })

  it('未注册邮箱：统一回「已发送」，不暴露注册状态（防枚举）', async () => {
    const code = await inject('POST', '/auth/send-code', { email: 'ghost@test.local' })
    expect(code.status).toBe(200)
    expect(code.body.sent).toBe(false)
    expect(code.body.dev).toBeUndefined()
    const reset = await inject('POST', '/auth/send-reset', { email: 'ghost@test.local' })
    expect(reset.status).toBe(200)
    expect(reset.body.sent).toBe(false)
    const unlock = await inject('POST', '/auth/send-unlock', { email: 'ghost@test.local' })
    expect(unlock.status).toBe(200)
    expect(unlock.body.sent).toBe(false)
  })
})

describe('重置密码（一次性链接）', () => {
  it('demo 发链接 → 重置成功 → 旧密码失效、全部旧会话撤销', async () => {
    const login = await inject('POST', '/auth/login', { email: 'u3@test.local', password: PW })
    const s = await inject('POST', '/auth/send-reset', { email: 'u3@test.local' })
    expect(s.status).toBe(200)
    const token = lastMailCode()

    const ok = await inject('POST', '/auth/reset', { email: 'u3@test.local', token, newPassword: 'reset-pw-123' })
    expect(ok.status).toBe(200)
    // 旧会话全部撤销
    expect((await inject('GET', '/auth/me', undefined, login.body.token)).status).toBe(401)
    // 新密码可登录，旧密码不可
    expect((await inject('POST', '/auth/login', { email: 'u3@test.local', password: 'reset-pw-123' })).status).toBe(200)
    expect((await inject('POST', '/auth/login', { email: 'u3@test.local', password: PW })).status).toBe(401)
  })
})
