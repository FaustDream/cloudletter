/**
 * 一次性授权路由：
 * - 管理端（requireAuth）：创建授权（邮件送达链接）/ 列表 / 撤销
 * - 访客端（公开）：POST /grants/redeem —— 邮件链接验证 → 换取受限只读会话
 * token 仅存哈希（与 Session/MailCode 同口径）；有效期强制，最长 7 天；可随时撤销。
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { hashToken, requireAuth } from '../auth'
import { generateToken } from '../crypto'
import { sendMail, smtpStatus } from '../mailer'
import { ah, err } from './helpers'
import { webOrigin } from '../lib/webOrigin'

export const grants = Router()

/** 可授权模块（模块粒度，全部只读） */
const GRANT_SCOPES = ['timeline', 'posts', 'notes', 'workplan', 'plan'] as const
type GrantScope = (typeof GRANT_SCOPES)[number]

/** 有效期档位（毫秒）；自定义值封顶 7 天 */
const TTL_CHOICES: Record<string, number> = { '1h': 3600e3, '24h': 86_400e3, '3d': 3 * 86_400e3, '7d': 7 * 86_400e3 }
const MAX_TTL_MS = 7 * 86_400e3

const EMAIL_RE = /^\S+@\S+\.\S+$/

/** 发信频控：同 IP 60 秒最多 5 次（内存版，单进程生效） */
const rateAttempts = new Map<string, number[]>()
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of rateAttempts) {
    const live = list.filter((t) => now - t < 60_000)
    if (live.length === 0) rateAttempts.delete(k)
    else rateAttempts.set(k, live)
  }
}, 5 * 60 * 1000).unref?.()
function rateLimited(key: string, max = 5): boolean {
  const now = Date.now()
  const list = (rateAttempts.get(key) ?? []).filter((t) => now - t < 60_000)
  if (list.length >= max) { rateAttempts.set(key, list); return true }
  list.push(now)
  rateAttempts.set(key, list)
  return false
}

/** 授权状态推导（前端展示用） */
function statusOf(g: { expiresAt: Date; revokedAt: Date | null }): 'active' | 'expired' | 'revoked' {
  if (g.revokedAt) return 'revoked'
  if (g.expiresAt < new Date()) return 'expired'
  return 'active'
}

/* ================= 管理端 ================= */

// POST /grants —— 创建授权并发送邮件（返回明文 token 仅用于界面上「复制链接」兜底一次）
grants.post('/', requireAuth, ah(async (req, res) => {
  const { email, scopes, ttlKey, label } = (req.body ?? {}) as {
    email?: string; scopes?: string[]; ttlKey?: string; label?: string
  }
  const mail = String(email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(mail)) return err(res, 422, 'VALIDATION', '邮箱格式不正确')
  const list = Array.isArray(scopes) ? [...new Set(scopes.filter((s): s is GrantScope => (GRANT_SCOPES as readonly string[]).includes(s)))] : []
  if (list.length === 0) return err(res, 422, 'VALIDATION', '至少选择一个授权范围')
  const ttl = TTL_CHOICES[String(ttlKey ?? '24h')] ?? TTL_CHOICES['24h']
  if (rateLimited(`grants|${req.ip ?? ''}`)) {
    return err(res, 429, 'RATE_LIMITED', '创建过于频繁，请 1 分钟后再试')
  }
  const token = generateToken(32)
  const grant = await prisma.accessGrant.create({
    data: {
      email: mail,
      label: String(label ?? '').slice(0, 60),
      scopes: JSON.stringify(list),
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + Math.min(ttl, MAX_TTL_MS)),
    },
  })
  const origin = webOrigin(req)
  const link = `${origin}/grant?token=${token}`
  const st = smtpStatus()
  if (!st.ok && !st.demo) {
    // SMTP 不可用（生产）：撤销刚建的授权，避免悬挂
    await prisma.accessGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } })
    return err(res, 503, 'SMTP_DISABLED', st.reason ?? '邮件服务不可用，授权未创建')
  }
  const scopeText = list.map((s) => SCOPE_LABEL[s]).join('、')
  const mailRes = await sendMail({
    to: mail,
    subject: '【云笺集】临时授权访问邀请',
    text: `你获得了一次临时授权访问（范围：${scopeText}），有效期至 ${grant.expiresAt.toLocaleString()}。\n\n请点击以下链接进入授权访问：\n${link}\n\n仅可只读查看授权范围内的内容；如非本人操作请忽略本邮件。`,
  }, { allowAnyRecipient: true })
  if (!mailRes.sent) {
    await prisma.accessGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } })
    return err(res, 503, 'SMTP_DISABLED', mailRes.reason ?? '邮件发送失败，授权未创建')
  }
  res.json({
    ok: true,
    grant: { id: grant.id, email: grant.email, scopes: list, expiresAt: grant.expiresAt, status: 'active' },
    // 明文链接仅在创建响应返回一次（邮件之外的人工转达兜底）；演示模式同时带回落盘路径
    link,
    ...(mailRes.demoPath ? { demoPath: mailRes.demoPath } : {}),
  })
}))

// GET /grants —— 授权列表（含状态推导）
grants.get('/', requireAuth, ah(async (_req, res) => {
  const rows = await prisma.accessGrant.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  res.json({
    items: rows.map((g) => ({
      id: g.id, email: g.email, label: g.label,
      scopes: safeScopes(g.scopes), expiresAt: g.expiresAt,
      firstUsedAt: g.firstUsedAt, revokedAt: g.revokedAt, createdAt: g.createdAt,
      status: statusOf(g),
    })),
  })
}))

// DELETE /grants/:id —— 撤销授权（访客会话一并清理）
grants.delete('/:id', requireAuth, ah(async (req, res) => {
  try {
    await prisma.accessGrant.update({ where: { id: req.params.id }, data: { revokedAt: new Date() } })
    await prisma.guestSession.deleteMany({ where: { grantId: req.params.id } })
    res.json({ ok: true })
  } catch {
    return err(res, 404, 'NOT_FOUND', '授权不存在')
  }
}))

/* ================= 访客端（公开） ================= */

// POST /grants/redeem —— 邮件链接验证：token 换取受限只读会话
grants.post('/redeem', ah(async (req, res) => {
  const token = String((req.body ?? {}).token ?? '').trim()
  if (!token || token.length > 128) return err(res, 422, 'VALIDATION', '授权链接无效')
  if (rateLimited(`redeem|${req.ip ?? ''}`, 20)) {
    return err(res, 429, 'RATE_LIMITED', '尝试过于频繁，请 1 分钟后再试')
  }
  const grant = await prisma.accessGrant.findUnique({ where: { tokenHash: hashToken(token) } })
  const now = new Date()
  if (!grant || grant.revokedAt || grant.expiresAt < now) {
    return err(res, 401, 'AUTH_REQUIRED', '授权链接无效或已过期')
  }
  const guestToken = generateToken()
  const session = await prisma.guestSession.create({
    data: { grantId: grant.id, tokenHash: hashToken(guestToken), expiresAt: grant.expiresAt },
  })
  if (!grant.firstUsedAt) {
    await prisma.accessGrant.update({ where: { id: grant.id }, data: { firstUsedAt: new Date() } })
  }
  res.json({
    token: guestToken,
    expiresAt: session.expiresAt,
    scopes: safeScopes(grant.scopes),
    label: grant.label,
  })
}))

function safeScopes(s: string): string[] {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

const SCOPE_LABEL: Record<GrantScope, string> = {
  timeline: '时间流',
  posts: '文章',
  notes: '速记',
  workplan: '工作计划',
  plan: '今日计划',
}
