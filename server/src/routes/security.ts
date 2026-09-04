/**
 * 安全路由：登录设备记录、头像上传/装饰、两步验证恢复（安全托底）。
 * - 头像：JSON dataURL 上传（≤3MB），白名单格式 png/jpeg/webp/gif（GIF 动图支持），魔数校验，落盘 data/avatars/
 * - 2FA 恢复：验证邮箱 → 一次性恢复码（15 分钟、限频、留下活动日志）→ 确认后关闭 2FA 并撤销全部会话
 */
import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { requestInfo, logActivity } from '../services/activity'
import { sendMail, smtpStatus } from '../mailer'
import { avatarsDir } from '../config'

export const security = Router()
security.use(requireAuth)

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** 尽力而为的 IP → 地理位置（公网接口，失败留空；结果缓存 6 小时防超限） */
const geoCache = new Map<string, { geo: string; t: number }>()
async function lookupGeo(ip: string): Promise<string> {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) return ''
  const hit = geoCache.get(ip)
  if (hit && Date.now() - hit.t < 6 * 3600_000) return hit.geo
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 3000)
    const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=status,country,regionName,city`, {
      signal: ac.signal,
      headers: { 'user-agent': 'cloudletter/2.0' },
    })
    clearTimeout(timer)
    if (r.ok) {
      const d = (await r.json()) as { status: string; country?: string; regionName?: string; city?: string }
      if (d.status === 'success') {
        const geo = [d.country, d.regionName, d.city].filter(Boolean).join(' ')
        geoCache.set(ip, { geo, t: Date.now() })
        return geo
      }
    }
  } catch { /* 尽力而为，失败留空 */ }
  geoCache.set(ip, { geo: '', t: Date.now() })
  return ''
}

/** 登录设备列表（区分服务器信息与用户客户端信息） */
security.get('/devices', ah(async (_req, res) => {
  const [, records] = await Promise.all([
    prisma.user.findUnique({ where: { id: _req.user!.id } }),
    prisma.loginRecord.findMany({ orderBy: { time: 'desc' }, take: 50 }),
  ])
  res.json({
    server: { note: '以下为服务器记录的登录流水（来自登录请求的真实客户端信息）' },
    records: records.map((r) => ({
      time: r.time.toISOString(),
      ip: r.ip,
      client: r.client,
      os: r.os,
      browser: r.browser,
      ua: r.ua,
      geo: r.geo,
      deviceId: r.deviceId,
      status: r.status,
      detail: r.detail,
    })),
  })
}))

/** 登录时在 auth.ts 内部记录：解析 UA + 设备标识 + 地理（此处导出复用） */
export async function recordLoginSession(args: {
  ip: string
  ua: string
  deviceId: string
  status?: 'ok' | 'fail'
  detail?: string
}): Promise<void> {
  const { parseUa } = await import('../lib/ua')
  const u = parseUa(args.ua)
  const geo = await lookupGeo(args.ip)
  await prisma.loginRecord.create({
    data: {
      ip: args.ip.slice(0, 64),
      ua: args.ua.slice(0, 300),
      client: u.client,
      os: u.os,
      browser: u.browser,
      geo,
      deviceId: args.deviceId.slice(0, 64),
      status: args.status ?? 'ok',
      detail: (args.detail ?? '').slice(0, 300),
    },
  })
}

/* ===== 头像上传（JSON dataURL；支持 GIF 动图；魔数校验；≤3MB） ===== */

const AVATAR_MAGIC: [string, string][] = [
  ['/9j/', '.jpg'],
  ['iVBORw0KGgo', '.png'],
  ['R0lGOD', '.gif'],
  ['UklGR', '.webp'],
]
const AVATAR_MAX = 3 * 1024 * 1024

security.post('/avatar', ah(async (_req, res) => {
  const b = (_req.body ?? {}) as { dataUrl?: string }
  const raw = String(b.dataUrl ?? '')
  const m = raw.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/)
  if (!m) return err(res, 422, 'VALIDATION', '仅支持 png / jpeg / webp / gif 图片')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > AVATAR_MAX) return err(res, 422, 'VALIDATION', '头像文件过大（上限 3MB）')
  const head = buf.subarray(0, 16).toString('base64')
  let ext = ''
  for (const [magic, e] of AVATAR_MAGIC) {
    if (head.startsWith(magic)) { ext = e; break }
  }
  if (!ext) return err(res, 422, 'VALIDATION', '图片格式校验失败（魔数不匹配）')
  fs.mkdirSync(avatarsDir, { recursive: true })
  const filename = `avatar-${_req.user!.id}-${Date.now()}${ext}`
  fs.writeFileSync(path.join(avatarsDir, filename), buf)
  // 清理旧头像文件（仅本用户，保留最近 3 张）
  try {
    const files = fs.readdirSync(avatarsDir).filter((f) => f.includes(`avatar-${_req.user!.id}-`)).sort()
    for (const f of files.slice(0, Math.max(0, files.length - 3))) fs.unlinkSync(path.join(avatarsDir, f))
  } catch { /* 清理失败不阻断 */ }
  await prisma.user.update({ where: { id: _req.user!.id }, data: { avatar: `/api/v2/avatars/${filename}` } })
  logActivity(_req, { action: 'avatar_update', object: '头像', detail: { type: m[1], size: buf.length } })
  res.json({ ok: true, avatar: `/api/v2/avatars/${filename}` })
}))

/** 头像装饰（边框/徽章/动效；仅存标识，前端映射样式） */
security.put('/avatar-decors', ah(async (_req, res) => {
  const b = (_req.body ?? {}) as { frame?: string; badge?: string; effect?: string }
  await prisma.user.update({
    where: { id: _req.user!.id },
    data: {
      avatarFrame: String(b.frame ?? '').slice(0, 40),
      avatarBadge: String(b.badge ?? '').slice(0, 40),
      avatar: undefined,
    },
  })
  logActivity(_req, { action: 'avatar_decors', object: '头像装饰', detail: { frame: b.frame ?? '', badge: b.badge ?? '', effect: b.effect ?? '' } })
  const user = await prisma.user.findUnique({ where: { id: _req.user!.id } })
  res.json({ ok: true, user: { avatar: user?.avatar ?? '', avatarFrame: user?.avatarFrame ?? '', avatarBadge: user?.avatarBadge ?? '' } })
}))

/* ===== 两步验证安全恢复（无法完成验证时的托底：绑定邮箱验证 → 一次性恢复码） ===== */

const RECOVERY_CC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const RECOVERY_TTL_MS = 15 * 60_000

async function sendRecoveryCode(email: string): Promise<{ ok: boolean; sent: boolean; mode?: string; dev?: Record<string, unknown> }> {
  const code = Array.from({ length: 8 }, () => RECOVERY_CC[crypto.randomInt(RECOVERY_CC.length)]).join('')
  await prisma.mailCode.deleteMany({ where: { email, purpose: 'tfa-recovery', usedAt: null } })
  await prisma.mailCode.create({
    data: { email, purpose: 'tfa-recovery', tokenHash: sha256(code), expiresAt: new Date(Date.now() + RECOVERY_TTL_MS) },
  })
  const st = smtpStatus()
  if (!st.ok && !st.demo) return { ok: false, sent: false }
  const mail = await sendMail({
    to: email,
    subject: '【云笺集】两步验证恢复码',
    text: `你的两步验证恢复码是：${code}（15 分钟内有效，仅一次有效）。\n用它关闭两步验证后重新登录，并尽快重新绑定你的身份验证器。\n若非本人操作，请立即修改邮箱密码并联系管理员。`,
  })
  if (!mail.sent) return { ok: false, sent: false }
  if (st.demo) return { ok: true, sent: true, mode: 'demo', dev: { code, mailFile: mail.demoPath } }
  return { ok: true, sent: true, mode: 'smtp' }
}

// 防滥用限频：同 IP 60 秒 3 次 / 同邮箱 15 分钟 1 次
const recoveryRate = new Map<string, number[]>()
const recoveryCooldown = new Map<string, number>()
function recoveryLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const list = (recoveryRate.get(key) ?? []).filter((t) => now - t < windowMs)
  if (list.length >= max) { recoveryRate.set(key, list); return true }
  list.push(now)
  recoveryRate.set(key, list)
  return false
}

security.post('/2fa/recovery-request', ah(async (_req, res) => {
  const email = String((_req.body ?? {}).email ?? '').trim().toLowerCase()
  if (!/^\S+@\S+\.\S+$/.test(email)) return err(res, 422, 'VALIDATION', '邮箱格式不正确')
  const ip = _req.ip ?? ''
  if (recoveryLimited(`tfa-req|${ip}`, 3, 60_000)) return err(res, 429, 'RATE_LIMITED', '尝试过于频繁，请 1 分钟后再试')
  const user = await prisma.user.findUnique({ where: { email } })
  // 未注册用户/未开 2FA：统一回「已发送」（防枚举）
  if (!user?.totpEnabled) return res.json({ ok: true, sent: false })
  const last = recoveryCooldown.get(email) ?? 0
  if (Date.now() - last < RECOVERY_TTL_MS) return err(res, 429, 'RATE_LIMITED', '已发送过恢复码，请 15 分钟后再试')
  const r = await sendRecoveryCode(email)
  if (!r.ok) return err(res, 503, 'SMTP_DISABLED', '邮件服务不可用，暂时无法发送恢复码')
  recoveryCooldown.set(email, Date.now())
  logActivity(_req, { action: 'tfa_recovery', object: '两步验证恢复码', result: 'ok', detail: { step: 'request', email } })
  res.json({ ok: true, sent: r.sent, mode: r.mode, dev: (r as { dev?: Record<string, unknown> }).dev })
}))

security.post('/2fa/recovery-confirm', ah(async (_req, res) => {
  const { email, code } = (_req.body ?? {}) as { email?: string; code?: string }
  if (!email || !code) return err(res, 422, 'VALIDATION', 'email 与 code 必填')
  const emailKey = String(email).trim().toLowerCase()
  const ip = _req.ip ?? ''
  if (recoveryLimited(`tfa-confirm|${emailKey}|${ip}`, 5, 60_000)) return err(res, 429, 'RATE_LIMITED', '尝试过于频繁，请 1 分钟后再试')
  const user = await prisma.user.findUnique({ where: { email: emailKey } })
  if (!user?.totpEnabled) return err(res, 409, 'CONFLICT', '该账户未开启两步验证')
  // 消费一次性恢复码（输错作废）
  const target = await prisma.mailCode.findFirst({
    where: { email: user.email, purpose: 'tfa-recovery', usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  if (!target) return err(res, 401, 'AUTH_REQUIRED', '恢复码错误或已过期（输错一次即作废，请重新获取）')
  const codeNorm = String(code).trim().toUpperCase()
  if (sha256(codeNorm) !== target.tokenHash) {
    await prisma.mailCode.update({ where: { id: target.id }, data: { usedAt: new Date() } })
    return err(res, 401, 'AUTH_REQUIRED', '恢复码错误或已过期（输错一次即作废，请重新获取）')
  }
  await prisma.mailCode.update({ where: { id: target.id }, data: { usedAt: new Date() } })
  // 安全托底：关闭 2FA + 撤销全部会话 + 留痕（作为重大安全事件）
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: '', totpEnabled: false } })
  await prisma.session.deleteMany({ where: { userId: user.id } })
  logActivity(_req, { action: 'tfa_reset', object: '两步验证', result: 'ok', detail: { via: 'email-recovery', email: user.email } })
  res.json({ ok: true, message: '两步验证已安全重置，请使用邮箱密码登录，并重新绑定验证器' })
}))

/* ===== 帮助与反馈（需求 26）：通过邮件发送反馈，默认收件邮箱来自账户设置 ===== */

security.post('/feedback', ah(async (_req, res) => {
  const b = (_req.body ?? {}) as { subject?: string; content?: string; to?: string }
  const subject = String(b.subject ?? '').trim().slice(0, 120)
  const content = String(b.content ?? '').trim().slice(0, 5000)
  const to = String(b.to ?? '').trim().slice(0, 200)
  if (!subject || !content) return err(res, 422, 'VALIDATION', 'subject 与 content 必填')
  const st = smtpStatus()
  if (!st.ok && !st.demo) return err(res, 503, 'SMTP_DISABLED', st.reason ?? '邮件服务不可用')
  const mail = await sendMail({
    to: to || 'cloudletter@localhost',
    subject: `【云笺集·反馈】${subject}`,
    text: `来自用户 ${_req.user!.email} 的反馈：\n\n${content}`,
  })
  if (!mail.sent) return err(res, 503, 'SMTP_DISABLED', mail.reason ?? '邮件服务不可用')
  if (st.demo) return res.json({ ok: true, sent: true, mode: 'demo', dev: { mailFile: mail.demoPath } })
  res.json({ ok: true, sent: mail.sent, mode: 'smtp' })
}))