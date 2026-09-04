/**
 * 集成与链接：API 凭据 + Webhook（正式开发）。
 * - API 凭据：名称/作用域，密钥仅创建时展示一次（库内只存哈希+展示前缀），支持撤销
 * - Webhook：URL/事件/启用停用/请求签名（HMAC-SHA256）/调用日志（失败重试 2 次指数退避）
 * - 敏感信息（密钥/签名）一律不回显明文
 */
import { Router } from 'express'
import crypto from 'node:crypto'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { logActivity } from '../services/activity'

export const integrations = Router()
integrations.use(requireAuth)

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** 生成完整 API 密钥：clk_<12位随机>，库内存哈希 */
function issueApiKey(): { full: string; prefix: string; keyHash: string } {
  const secret = crypto.randomBytes(18).toString('base64url')
  const prefix = 'clk_' + crypto.randomBytes(6).toString('hex')
  return { full: `${prefix}_${secret}`, prefix, keyHash: sha256(`${prefix}_${secret}`) }
}

/* ===== API 凭据 ===== */

integrations.get('/api-credentials', ah(async (_req, res) => {
  const rows = await prisma.apiCredential.findMany({ orderBy: { createdAt: 'desc' } })
  res.json({
    items: rows.map((r) => ({
      id: r.id, name: r.name, prefix: r.prefix, scopes: JSON.parse(r.scopes || '[]'),
      lastUsedAt: r.lastUsedAt, revokedAt: r.revokedAt, createdAt: r.createdAt,
    })),
  })
}))

integrations.post('/api-credentials', ah(async (_req, res) => {
  const b = (_req.body ?? {}) as { name?: string; scopes?: string[] }
  const name = String(b.name ?? '').trim().slice(0, 60)
  if (!name) return err(res, 422, 'VALIDATION', '请输入凭据名称')
  const scopes = Array.isArray(b.scopes) ? b.scopes.filter((s) => typeof s === 'string').map((s) => s.slice(0, 40)).slice(0, 20) : []
  const { full, prefix, keyHash } = issueApiKey()
  const r = await prisma.apiCredential.create({
    data: { name, prefix, keyHash, scopes: JSON.stringify(scopes) },
  })
  logActivity(_req, { action: 'api_cred_create', object: name, target: r.id, detail: { scopes } })
  // 明文密钥只在本次响应中出现一次
  res.json({ ok: true, id: r.id, name, prefix, scopes, key: full })
}))

integrations.delete('/api-credentials/:id', ah(async (_req, res) => {
  try {
    const r = await prisma.apiCredential.update({
      where: { id: _req.params.id },
      data: { revokedAt: new Date() },
    })
    logActivity(_req, { action: 'api_cred_revoke', object: r.name, target: r.id, result: 'ok' })
    res.json({ ok: true })
  } catch {
    return err(res, 404, 'NOT_FOUND', '凭据不存在')
  }
}))

/* ===== Webhook ===== */

const WEBHOOK_EVENTS = ['post.published', 'post.created', 'post.updated', 'post.deleted'] as const

integrations.get('/webhooks', ah(async (_req, res) => {
  const rows = await prisma.webhook.findMany({ orderBy: { createdAt: 'desc' } })
  res.json({
    items: rows.map((r) => ({
      id: r.id, name: r.name, url: r.url, events: JSON.parse(r.events || '[]'),
      hasSecret: !!r.secret, enabled: r.enabled,
      lastStatus: r.lastStatus, lastError: r.lastError, lastSentAt: r.lastSentAt, createdAt: r.createdAt,
    })),
  })
}))

integrations.post('/webhooks', ah(async (_req, res) => {
  const b = (_req.body ?? {}) as { name?: string; url?: string; events?: string[]; secret?: string }
  const name = String(b.name ?? '').trim().slice(0, 60)
  const url = String(b.url ?? '').trim()
  if (!name) return err(res, 422, 'VALIDATION', '请输入 Webhook 名称')
  let u: URL
  try { u = new URL(url) } catch { return err(res, 422, 'VALIDATION', 'URL 格式不正确（需 http/https）') }
  if (!/^https?:$/.test(u.protocol)) return err(res, 422, 'VALIDATION', 'URL 格式不正确（需 http/https）')
  const events = (Array.isArray(b.events) ? b.events : [])
    .filter((e): e is string => typeof e === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(e))
  if (events.length === 0) return err(res, 422, 'VALIDATION', '至少选择一个订阅事件')
  const secret = String(b.secret ?? '').slice(0, 64)
  const r = await prisma.webhook.create({
    data: { name, url: url.slice(0, 500), events: JSON.stringify(events), secret },
  })
  logActivity(_req, { action: 'webhook_create', object: name, target: r.id, detail: { url, events } })
  res.json({ ok: true, id: r.id, events })
}))

integrations.put('/webhooks/:id', ah(async (_req, res) => {
  const b = (_req.body ?? {}) as { name?: string; url?: string; events?: string[]; secret?: string; enabled?: boolean }
  const data: Record<string, unknown> = {}
  if (typeof b.name === 'string' && b.name.trim()) data.name = b.name.trim().slice(0, 60)
  if (typeof b.url === 'string' && b.url.trim()) {
    try { new URL(b.url.trim()) } catch { return err(res, 422, 'VALIDATION', 'URL 格式不正确') }
    data.url = b.url.trim().slice(0, 500)
  }
  if (Array.isArray(b.events)) {
    const ev = b.events.filter((e): e is string => typeof e === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(e))
    if (ev.length === 0) return err(res, 422, 'VALIDATION', '至少选择一个订阅事件')
    data.events = JSON.stringify(ev)
  }
  if (typeof b.secret === 'string') data.secret = b.secret.slice(0, 64)
  if (typeof b.enabled === 'boolean') data.enabled = b.enabled
  try {
    const before = await prisma.webhook.findUnique({ where: { id: _req.params.id } })
    if (!before) return err(res, 404, 'NOT_FOUND', 'Webhook 不存在')
    const r = await prisma.webhook.update({ where: { id: _req.params.id }, data })
    logActivity(_req, { action: 'webhook_update', object: r.name, target: r.id, detail: { fields: Object.keys(data) } })
    res.json({ ok: true })
  } catch { return err(res, 404, 'NOT_FOUND', 'Webhook 不存在') }
}))

integrations.delete('/webhooks/:id', ah(async (_req, res) => {
  try {
    const r = await prisma.webhook.delete({ where: { id: _req.params.id } })
    logActivity(_req, { action: 'webhook_delete', object: r.name, target: r.id })
    res.json({ ok: true })
  } catch { return err(res, 404, 'NOT_FOUND', 'Webhook 不存在') }
}))

integrations.get('/webhooks/:id/calls', ah(async (_req, res) => {
  const calls = await prisma.webhookCall.findMany({
    where: { webhookId: _req.params.id },
    orderBy: { sentAt: 'desc' },
    take: 50,
  })
  res.json({
    items: calls.map((c) => ({
      id: c.id, event: c.event, status: c.status, error: c.error, sentAt: c.sentAt.toISOString(),
    })),
  })
}))

/** 测试送达：发送一条示例事件 */
integrations.post('/webhooks/:id/test', ah(async (_req, res) => {
  const wh = await prisma.webhook.findUnique({ where: { id: _req.params.id } })
  if (!wh) return err(res, 404, 'NOT_FOUND', 'Webhook 不存在')
  const payload = { event: 'test.ping', at: new Date().toISOString(), origin: 'cloudletter' }
  const status = await dispatchWebhookSafe(wh.id, wh.url, 'test.ping', payload, wh.secret)
  res.json({ ok: status >= 200 && status < 300, status, message: status >= 200 && status < 300 ? '测试送达成功' : `送达失败（HTTP ${status}）` })
}))

/** 派发事件到匹配的 Webhook（失败自动重试 2 次，指数退避；含签名） */
export async function dispatchWebhookSafe(
  webhookId: string,
  url: string,
  event: string,
  payload: Record<string, unknown>,
  secret: string,
): Promise<number> {
  const body = JSON.stringify({ event, ...payload })
  const signature = secret
    ? `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
    : ''
  const doSend = async (): Promise<{ status: number; error: string }> => {
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), 10_000)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'cloudletter-webhook/2.0',
          ...(signature ? { 'x-cloudletter-signature': signature } : {}),
        },
        body,
        signal: ac.signal,
      })
      clearTimeout(timer)
      const text = await res.text().catch(() => '')
      return { status: res.status, error: res.status >= 200 && res.status < 300 ? '' : text.slice(0, 200) }
    } catch (e: any) {
      return { status: 0, error: String(e?.message ?? e ?? '网络错误').slice(0, 200) }
    }
  }
  let attempt = 1
  let out = await doSend()
  while (attempt < 3 && out.status !== 200 && !(out.status >= 200 && out.status < 300)) {
    await new Promise((r) => setTimeout(r, attempt * 1000)) // 指数退避
    out = await doSend()
    attempt++
  }
  await prisma.webhookCall.create({
    data: { webhookId, event, payload: JSON.stringify(payload).slice(0, 24_000), status: out.status, error: out.error },
  })
  await prisma.webhook.update({
    where: { id: webhookId },
    data: { lastStatus: out.status, lastError: out.error, lastSentAt: new Date() },
  })
  return out.status
}

/** 事件分发入口（posts 等路由调用）：找启用且订阅了该事件的 webhook */
export async function emitWebhookEvent(event: string, payload: Record<string, unknown>): Promise<void> {
  const hooks = await prisma.webhook.findMany({ where: { enabled: true } })
  await Promise.all(
    hooks
      .filter((h) => (JSON.parse(h.events || '[]') as string[]).includes(event))
      .map((h) => dispatchWebhookSafe(h.id, h.url, event, payload, h.secret)),
  )
}