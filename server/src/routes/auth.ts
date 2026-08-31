/**
 * 认证路由（V2）：login / me / logout / password（单管理员）。
 */
import { Router } from 'express'
import crypto from 'node:crypto'
import { prisma } from '../prisma'
import { createSession, extractBearer, hashToken, requireAuth } from '../auth'
import { hashPassword, verifyPassword, generateToken, generateTOTPSecret, generateTOTP, verifyTOTP, otpauthUrl } from '../crypto'
import { sendMail, smtpStatus } from '../mailer'
import { ah, err } from './helpers'

export const auth = Router()

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const CODE_TTL_MS = 10 * 60 * 1000
const RESET_TTL_MS = 15 * 60 * 1000

/** 邮箱验证码字符集：大写字母 + 数字（去掉 0/O/1/I 易混字符） */
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
/** 生成字母数字混合验证码（比 6 位纯数字熵高 ~2.4 倍，配合「错一次作废」杜绝在线穷举） */
const genMailCode = (len = 8) =>
  Array.from({ length: len }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('')

/** 统一口令长度护栏：防超长口令触发同步 scrypt 的 CPU 阻塞（DoS 面） */
const PASSWORD_MAX = 128
function passwordReject(pw: unknown): boolean {
  return typeof pw !== 'string' || pw.length > PASSWORD_MAX
}

/** 验证码归一：去空白 + 统一大写（生成时字符集全大写；大小写混输也能匹配） */
const normCode = (s: string) => s.replace(/[\s-]/g, '').toUpperCase()

/** 记录最后一次登录明细（时间/IP/UA）：优先取首个可信 XFF，回声/盲发的前缀由 recordLogin 自行截断 */
async function recordLogin(userId: string, req: { ip?: string; headers?: Record<string, string | string[] | undefined> }): Promise<void> {
  const ua = String(req.headers?.['user-agent'] ?? '').slice(0, 300)
  const xff = req.headers?.['x-forwarded-for']
  const xffIp = (typeof xff === 'string' ? xff.split(',')[0] : Array.isArray(xff) ? String(xff[0]) : '').trim()
  // XFF 优先（反代可信）；直连时回退 req.ip —— 修复此前 req.ip 恒为 127.0.0.1 导致 XFF 死代码的问题
  const ip = xffIp.slice(0, 64) || String(req.ip ?? '').slice(0, 64) || ''
  await prisma.user.update({
    where: { id: userId },
    data: { lastLoginAt: new Date(), lastLoginIp: ip, lastLoginAgent: ua },
  })
}

/** 落库一枚一次性验证码/令牌（仅存哈希；同邮箱同用途作废旧码） */
async function storeMailCode(email: string, purpose: string, code: string, ttlMs: number): Promise<void> {
  await prisma.mailCode.deleteMany({ where: { email, purpose, usedAt: null } })
  await prisma.mailCode.create({
    data: { email, purpose, tokenHash: sha256(code), expiresAt: new Date(Date.now() + ttlMs) },
  })
}

/** 校验并消费一枚 purpose 令牌（code 或 reset token，仅存哈希）。
 *  codeId：可选的绑定额外校验（图形验证码场景绑定本次签发 id，防跨会话复用）。
 *  归一化差异：邮箱码/图形码可容忍大小写（统一大写比较）；reset token 是 64 位 hex，
 *  大小写敏感，必须按原文比较，否则 toUpperCase 会令哈希失效。 */
async function consumeMailCode(email: string, purpose: string, rawToken: string, codeId?: string): Promise<boolean> {
  const target = await prisma.mailCode.findFirst({
    where: { email, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  if (!target) return false
  if (codeId && target.id !== codeId) {
    // 指定失效（已换发/串用旧验证码）
    await prisma.mailCode.update({ where: { id: target.id }, data: { usedAt: new Date() } })
    return false
  }
  const comparable = purpose === 'reset' ? String(rawToken).trim() : normCode(String(rawToken))
  if (sha256(comparable) !== target.tokenHash) {
    // 首次输错即作废当前验证码：在线穷举最多试一次，必须重新发码
    await prisma.mailCode.update({ where: { id: target.id }, data: { usedAt: new Date() } })
    return false
  }
  await prisma.mailCode.update({ where: { id: target.id }, data: { usedAt: new Date() } })
  return true
}

/* ===== 登录失败防护（服务端强制）：3 次起需图形验证码，5 次锁定，锁定后邮箱验证解锁 ===== */

const CAPTCHA_AT = 3 // 连续失败 ≥3 次：登录前必须通过图形验证码
const LOCK_AT = 5 // 连续失败 5 次：锁定
const LOCK_MS = 15 * 60 * 1000 // 锁定时长 15 分钟
const CAPTCHA_TTL_MS = 5 * 60 * 1000 // 图形验证码有效期 5 分钟
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉 0/O/1/I 易混字符

/**
 * 图形验证码 → SVG 数据 URI：4 个扭曲字符 + 干扰线。
 * 全程不把明文验证码放进 HTTP 响应（响应只含图片 data URI），机器人无法直接读取文本。
 */
function renderCaptchaSvg(text: string): string {
  const w = 124
  const h = 46
  // 随机抖动查表：让每个验证码的字符位置/旋转都不同
  const jitter = () => crypto.randomInt(0, 7) - 3
  const chars = text
    .split('')
    .map((ch, i) => {
      const x = 20 + i * 24 + jitter()
      const y = 31 + jitter()
      const rot = (crypto.randomInt(0, 41) - 20).toFixed(1)
      return `<text x="${x}" y="${y}" font-family="Consolas,Menlo,monospace" font-size="24" font-weight="bold" fill="#2f6fd6" transform="rotate(${rot} ${x} ${y})">${ch}</text>`
    })
    .join('')
  const lines = Array.from(
    { length: 3 },
    () =>
      `<line x1="${(crypto.randomInt(0, w)).toFixed(1)}" y1="${(crypto.randomInt(0, h)).toFixed(1)}" x2="${(crypto.randomInt(0, w)).toFixed(1)}" y2="${(crypto.randomInt(0, h)).toFixed(1)}" stroke="#c9d6ea" stroke-width="1"/>`,
  ).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${lines}${chars}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/** 签发一次性图形验证码（仅存哈希；每次签发作废旧码），响应只返回图片 data URI */
async function issueCaptcha(email: string): Promise<{ captchaId: string; captchaSvg: string }> {
  await prisma.mailCode.deleteMany({ where: { email, purpose: 'captcha', usedAt: null } })
  const code = Array.from({ length: 4 }, () => CAPTCHA_CHARS[crypto.randomInt(CAPTCHA_CHARS.length)]).join('')
  const mc = await prisma.mailCode.create({
    data: { email, purpose: 'captcha', tokenHash: sha256(code), expiresAt: new Date(Date.now() + CAPTCHA_TTL_MS) },
  })
  return { captchaId: mc.id, captchaSvg: renderCaptchaSvg(code) }
}

// 登录限流：同「邮箱|IP」60 秒内最多 10 次（内存版，单进程即生效）
const RATE_MAX = 10
const RATE_WINDOW_MS = 60_000
const rateAttempts = new Map<string, number[]>()
function rateLimited(key: string, max = RATE_MAX, windowMs = RATE_WINDOW_MS): boolean {
  const now = Date.now()
  const list = (rateAttempts.get(key) ?? []).filter((t) => now - t < windowMs)
  if (list.length >= max) { rateAttempts.set(key, list); return true }
  list.push(now)
  rateAttempts.set(key, list)
  return false
}
// 周期性清场：过期窗口的键整体删除，防止限流表无限膨胀
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of rateAttempts) {
    const live = list.filter((t) => now - t < RATE_WINDOW_MS)
    if (live.length === 0) rateAttempts.delete(k)
    else rateAttempts.set(k, live)
  }
}, 5 * 60 * 1000).unref?.()
/** 带 RATE_LIMITED 语义的限流（复写响应用） */
function rateLimitedFail(res: import('express').Response, message = '尝试过于频繁，请 1 分钟后再试'): boolean {
  err(res, 429, 'RATE_LIMITED', message)
  return true
}

auth.post('/login', ah(async (req, res) => {
  const { email, password, remember, captchaId, captcha, totp } = (req.body ?? {}) as {
    email?: string; password?: string; remember?: boolean; captchaId?: string; captcha?: string; totp?: string
  }
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return err(res, 422, 'VALIDATION', 'email 与 password 必填')
  }
  if (password.length > 512) {
    // 超长口令：直接拒绝，避免同步 scrypt 阻塞事件循环
    return err(res, 422, 'VALIDATION', '口令长度非法')
  }
  const emailKey = email.trim().toLowerCase()
  if (rateLimited(`${emailKey}|${req.ip ?? ''}`)) {
    return rateLimitedFail(res)
  }
  const user = await prisma.user.findUnique({ where: { email: emailKey } })
  if (!user) {
    // 与"密码错误"返回同样文案，避免邮箱枚举
    return err(res, 401, 'AUTH_REQUIRED', '邮箱或密码不正确')
  }
  const now = Date.now()
  if (user.loginLockedUntil && user.loginLockedUntil.getTime() > now) {
    const remain = Math.ceil((user.loginLockedUntil.getTime() - now) / 1000)
    return err(res, 423, 'ACCOUNT_LOCKED', `账户已锁定，请${Math.ceil(remain / 60)}分钟后重试，或使用邮箱验证码解锁`, { remainSeconds: remain })
  }
  // ≥3 次失败：登录前必须通过图形验证码（服务端校验 + 图片展示；响应不含明文）
  if (user.loginFailCount >= CAPTCHA_AT) {
    if (!captcha) {
      const c = await issueCaptcha(user.email)
      return err(res, 423, 'CAPTCHA_REQUIRED', '请输入图形验证码后重试', { captchaId: c.captchaId, captchaSvg: c.captchaSvg })
    }
    const okCap = await consumeMailCode(user.email, 'captcha', String(captcha), String(captchaId ?? ''))
    if (!okCap) {
      const c = await issueCaptcha(user.email)
      return err(res, 423, 'CAPTCHA_INVALID', '验证码错误，已更换新验证码', { captchaId: c.captchaId, captchaSvg: c.captchaSvg })
    }
  }
  if (!verifyPassword(password, user.passwordHash)) {
    const fail = user.loginFailCount + 1
    if (fail >= LOCK_AT) {
      await prisma.user.update({ where: { id: user.id }, data: { loginFailCount: 0, loginLockedUntil: new Date(Date.now() + LOCK_MS) } })
      return err(res, 423, 'ACCOUNT_LOCKED', '尝试次数过多，账户已锁定 15 分钟，请使用邮箱验证码解锁', { remainSeconds: Math.floor(LOCK_MS / 1000) })
    }
    await prisma.user.update({ where: { id: user.id }, data: { loginFailCount: fail } })
    if (fail >= CAPTCHA_AT) {
      const c = await issueCaptcha(user.email)
      return err(res, 401, 'CAPTCHA_REQUIRED', `密码错误，还需图形验证码（剩余 ${LOCK_AT - fail} 次机会）`, { captchaId: c.captchaId, captchaSvg: c.captchaSvg, failCount: fail })
    }
    return err(res, 401, 'AUTH_REQUIRED', '邮箱或密码不正确')
  }
  // 两步验证：已开启 TOTP 的账户必须携带 6 位动态码
  if (user.totpEnabled && user.totpSecret) {
    if (!totp) return err(res, 428, 'TOTP_REQUIRED', '请输入两步验证码', { totpRequired: true })
    if (!verifyTOTP(String(totp), user.totpSecret)) {
      return err(res, 401, 'TOTP_INVALID', '两步验证码错误或已过期')
    }
  }
  // 登录成功：清零失败计数与锁定
  await prisma.user.update({ where: { id: user.id }, data: { loginFailCount: 0, loginLockedUntil: null } })
  const { token } = await createSession(user.id, !!remember)
  await recordLogin(user.id, req)
  res.json({ token, email: user.email })
}))

/* ===== 锁定后邮箱验证解锁 ===== */

auth.post('/send-unlock', ah(async (req, res) => {
  const email = String((req.body ?? {}).email ?? '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return err(res, 422, 'VALIDATION', '邮箱格式不正确')
  // 发码频控：同「邮箱|IP」60 秒最多 3 次，防邮件轰炸
  if (rateLimited(`send-unlock|${email}|${req.ip ?? ''}`, 3)) {
    return rateLimitedFail(res, '发送过于频繁，请 1 分钟后再试')
  }
  const user = await prisma.user.findUnique({ where: { email } })
  const accountLocked = !!user?.loginLockedUntil && user.loginLockedUntil.getTime() > Date.now()
  if (!accountLocked) {
    // 未注册或未锁定：统一回"已发送"，不暴露邮箱是否存在/锁定状态
    return res.json({ ok: true, sent: false })
  }
  const code = genMailCode(8)
  await storeMailCode(email, 'unlock', code, CODE_TTL_MS)
  const st = smtpStatus()
  if (!st.ok && !st.demo) return err(res, 503, 'SMTP_DISABLED', st.reason ?? '邮件服务不可用')
  const mail = await sendMail({
    to: email,
    subject: '【云笺集】解锁验证码',
    text: `你的解锁验证码是：${code}（10 分钟内有效）。用于解锁被冻结的账户登录，若非本人操作请忽略。`,
  })
  if (!mail.sent) return err(res, 503, 'SMTP_DISABLED', mail.reason ?? '邮件服务不可用')
  if (st.demo) return sendDemo(res, { code, mailFile: mail.demoPath })
  res.json({ ok: true, sent: mail.sent, mode: 'smtp' })
}))

auth.post('/unlock', ah(async (req, res) => {
  const { email, code } = (req.body ?? {}) as { email?: string; code?: string }
  if (!email || !code) return err(res, 422, 'VALIDATION', 'email 与 code 必填')
  // 校验频控：防在线穷举（叠加「错一次作废」双保险）
  if (rateLimited(`unlock|${String(email).toLowerCase()}|${req.ip ?? ''}`)) {
    return rateLimitedFail(res)
  }
  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } })
  if (!user) return err(res, 401, 'AUTH_REQUIRED', '验证码或邮箱不正确')
  const ok = await consumeMailCode(user.email, 'unlock', String(code))
  if (!ok) return err(res, 401, 'AUTH_REQUIRED', '验证码错误或已过期（输错一次即作废，请重新获取）')
  await prisma.user.update({ where: { id: user.id }, data: { loginFailCount: 0, loginLockedUntil: null } })
  res.json({ ok: true })
}))

/* ===== 邮箱验证码登录 ===== */

auth.post('/send-code', ah(async (req, res) => {
  const email = String((req.body ?? {}).email ?? '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return err(res, 422, 'VALIDATION', '邮箱格式不正确')
  // 发码频控：同「邮箱|IP」60 秒最多 3 次，防邮件轰炸
  if (rateLimited(`send-code|${email}|${req.ip ?? ''}`, 3)) {
    return rateLimitedFail(res, '发送过于频繁，请 1 分钟后再试')
  }
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    // 未注册邮箱：不创建验证码、统一回"已发送"，防邮箱枚举
    return res.json({ ok: true, sent: false })
  }
  const code = genMailCode(8)
  await storeMailCode(email, 'login', code, CODE_TTL_MS)
  const st = smtpStatus()
  if (!st.ok && !st.demo) return err(res, 503, 'SMTP_DISABLED', st.reason ?? '邮件服务不可用')
  const mail = await sendMail({
    to: email,
    subject: '【云笺集】登录验证码',
    text: `你的登录验证码是：${code}（10 分钟内有效）。若非本人操作请忽略。`,
  })
  if (!mail.sent) return err(res, 503, 'SMTP_DISABLED', mail.reason ?? '邮件服务不可用')
  if (st.demo) return sendDemo(res, { code, mailFile: mail.demoPath })
  res.json({ ok: true, sent: mail.sent, mode: 'smtp' })
}))

/**
 * 演示模式发码响应：仅限非生产环境（双重条件：SMTP 未配置 且 非生产）。
 * 生产环境 SMTP 未配置时直接 503，绝不把验证码/重置链接放进 HTTP 响应。
 */
function sendDemo(res: import('express').Response, dev: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') {
    err(res, 503, 'SMTP_DISABLED', '邮件服务未配置，无法发送验证码（生产环境禁用演示模式）')
    return
  }
  res.json({ ok: true, sent: true, mode: 'demo', dev })
}

auth.post('/login-by-code', ah(async (req, res) => {
  const { email, code } = (req.body ?? {}) as { email?: string; code?: string }
  if (!email || !code) return err(res, 422, 'VALIDATION', 'email 与 code 必填')
  // 校验频控：防在线穷举（叠加「错一次作废」双保险）
  if (rateLimited(`lbc|${String(email).toLowerCase()}|${req.ip ?? ''}`)) {
    return rateLimitedFail(res)
  }
  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } })
  if (!user) return err(res, 401, 'AUTH_REQUIRED', '验证码或邮箱不正确')
  const ok = await consumeMailCode(user.email, 'login', String(code))
  if (!ok) return err(res, 401, 'AUTH_REQUIRED', '验证码错误或已过期（输错一次即作废，请重新获取）')
  const { token } = await createSession(user.id)
  await recordLogin(user.id, req)
  res.json({ token, email: user.email })
}))

/* ===== 邮箱重置密码（仅通过一次性加密链接；链接内 token 仅存哈希、一次性、15 分钟有效） ===== */

auth.post('/send-reset', ah(async (req, res) => {
  const email = String((req.body ?? {}).email ?? '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return err(res, 422, 'VALIDATION', '邮箱格式不正确')
  // 发码频控：同「邮箱|IP」60 秒最多 3 次，防邮件轰炸
  if (rateLimited(`send-reset|${email}|${req.ip ?? ''}`, 3)) {
    return rateLimitedFail(res, '发送过于频繁，请 1 分钟后再试')
  }
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    // 未注册邮箱：统一回"已发送"，防邮箱枚举
    return res.json({ ok: true, sent: false })
  }
  const token = generateToken(32) // 密文仅出现在邮件链接中，库内只存哈希
  await storeMailCode(email, 'reset', token, RESET_TTL_MS)
  const origin = `${req.protocol}://${req.get('host') || 'localhost:3015'}`
  const link = `${origin}/login?reset=${token}&email=${encodeURIComponent(user.email)}`
  const st = smtpStatus()
  if (!st.ok && !st.demo) return err(res, 503, 'SMTP_DISABLED', st.reason ?? '邮件服务不可用')
  const mail = await sendMail({
    to: email,
    subject: '【云笺集】重置密码链接',
    text: `请点击以下链接重置密码（15 分钟内有效，仅本人可操作）：\n\n${link}\n\n若无法点击请复制到浏览器打开。`,
  })
  if (!mail.sent) return err(res, 503, 'SMTP_DISABLED', mail.reason ?? '邮件服务不可用')
  if (st.demo) return sendDemo(res, { link, mailFile: mail.demoPath })
  res.json({ ok: true, sent: mail.sent, mode: 'smtp' })
}))

auth.post('/reset', ah(async (req, res) => {
  const { email, token, newPassword } = (req.body ?? {}) as { email?: string; token?: string; newPassword?: string }
  if (!email || !token || !newPassword) return err(res, 422, 'VALIDATION', 'email / token / newPassword 必填')
  if (String(newPassword).length < 8) return err(res, 422, 'VALIDATION', '新密码至少 8 位')
  if (passwordReject(newPassword)) return err(res, 422, 'VALIDATION', `新密码最长 ${PASSWORD_MAX} 位`)
  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } })
  if (!user) return err(res, 401, 'AUTH_REQUIRED', '重置链接无效')
  const ok = await consumeMailCode(user.email, 'reset', String(token))
  if (!ok) return err(res, 401, 'AUTH_REQUIRED', '重置链接无效或已过期')
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(String(newPassword)) } })
  // 重置后撤销全部会话，需重新登录
  await prisma.session.deleteMany({ where: { userId: user.id } })
  res.json({ ok: true })
}))

auth.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

/** 更新个人资料（目前仅昵称） */
auth.put('/profile', requireAuth, ah(async (req, res) => {
  const { nickname } = (req.body ?? {}) as { nickname?: string }
  const v = String(nickname ?? '').trim().slice(0, 40)
  await prisma.user.update({ where: { id: req.user!.id }, data: { nickname: v } })
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  res.json({
    user: {
      id: user!.id, email: user!.email, nickname: user!.nickname,
      lastLoginAt: user!.lastLoginAt, lastLoginIp: user!.lastLoginIp, lastLoginAgent: user!.lastLoginAgent,
    },
  })
}))

auth.post('/logout', requireAuth, ah(async (req, res) => {
  const token = extractBearer(req) ?? ''
  await prisma.session.deleteMany({ where: { token: hashToken(token) } })
  res.json({ ok: true })
}))

/* ===== 两步验证（TOTP）===== */

/** 生成密钥：返回 otpauth 链接与 base32 密钥（未开启状态下可反复生成，覆盖旧密钥） */
auth.post('/2fa/setup', requireAuth, ah(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) return err(res, 404, 'NOT_FOUND', '用户不存在')
  if (user.totpEnabled) return err(res, 409, 'CONFLICT', '两步验证已开启，请先关闭后重新设置')
  const { hex, base32 } = generateTOTPSecret()
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: hex, totpEnabled: false } })
  res.json({ secret: base32, otpauthUrl: otpauthUrl(base32, user.email) })
}))

/** 确认开启：校验一次动态码，成功后登录才需要两步验证 */
auth.post('/2fa/enable', requireAuth, ah(async (req, res) => {
  const { token } = (req.body ?? {}) as { token?: string }
  if (!token) return err(res, 422, 'VALIDATION', 'token 必填')
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user?.totpSecret) return err(res, 400, 'NO_SECRET', '请先生成两步验证密钥')
  if (user.totpEnabled) return err(res, 409, 'CONFLICT', '两步验证已开启')
  if (!verifyTOTP(String(token), user.totpSecret)) return err(res, 401, 'TOTP_INVALID', '验证码错误或已过期')
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } })
  res.json({ ok: true })
}))

/** 关闭两步验证：需要当前密码 + 有效动态码 */
auth.post('/2fa/disable', requireAuth, ah(async (req, res) => {
  const { password, token } = (req.body ?? {}) as { password?: string; token?: string }
  if (!password || !token) return err(res, 422, 'VALIDATION', 'password 与 token 必填')
  if (passwordReject(password)) return err(res, 422, 'VALIDATION', '口令长度非法')
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user?.totpEnabled) return err(res, 409, 'CONFLICT', '两步验证未开启')
  if (!verifyPassword(String(password), user.passwordHash)) return err(res, 401, 'AUTH_REQUIRED', '密码错误')
  if (!verifyTOTP(String(token), user.totpSecret)) return err(res, 401, 'TOTP_INVALID', '两步验证码错误或已过期')
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: '', totpEnabled: false } })
  res.json({ ok: true })
}))

/** 两步验证状态 */
auth.get('/2fa/status', requireAuth, ah(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  res.json({ enabled: !!user?.totpEnabled, pending: !!user?.totpSecret && !user?.totpEnabled })
}))

/* ===== 修改登录邮箱 ===== */

auth.post('/email', requireAuth, ah(async (req, res) => {
  const { newEmail, password } = (req.body ?? {}) as { newEmail?: string; password?: string }
  const email = String(newEmail ?? '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return err(res, 422, 'VALIDATION', '邮箱格式不正确')
  if (!password) return err(res, 422, 'VALIDATION', 'password 必填')
  if (passwordReject(password)) return err(res, 422, 'VALIDATION', '口令长度非法')
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user) return err(res, 404, 'NOT_FOUND', '用户不存在')
  if (!verifyPassword(String(password), user.passwordHash)) return err(res, 401, 'AUTH_REQUIRED', '密码错误')
  if (email === user.email) return err(res, 409, 'CONFLICT', '新邮箱与当前邮箱相同')
  const taken = await prisma.user.findUnique({ where: { email } })
  if (taken) return err(res, 409, 'CONFLICT', '该邮箱已被使用')
  await prisma.user.update({ where: { id: user.id }, data: { email } })
  // 邮箱是登录凭证：撤销当前之外的全部会话
  const cur = extractBearer(req)
  if (cur) await prisma.session.deleteMany({ where: { userId: user.id, NOT: { token: hashToken(cur) } } })
  res.json({ ok: true, email })
}))

auth.post('/password', requireAuth, ah(async (req, res) => {
  const { oldPassword, newPassword } = (req.body ?? {}) as { oldPassword?: string; newPassword?: string }
  if (!oldPassword || !newPassword) return err(res, 422, 'VALIDATION', 'oldPassword/newPassword 必填')
  if (String(newPassword).length < 8) return err(res, 422, 'VALIDATION', '新密码至少 8 位')
  if (passwordReject(oldPassword) || passwordReject(newPassword)) {
    return err(res, 422, 'VALIDATION', `密码最长 ${PASSWORD_MAX} 位`)
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
    return err(res, 401, 'AUTH_REQUIRED', '旧密码错误')
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(String(newPassword)) } })
  // 修改密码后撤销其他会话（保留当前会话，避免本机被登出；与改邮箱路径同口径）
  const cur = extractBearer(req)
  await prisma.session.deleteMany({
    where: { userId: user.id, ...(cur ? { NOT: { token: hashToken(cur) } } : {}) },
  })
  res.json({ ok: true })
}))