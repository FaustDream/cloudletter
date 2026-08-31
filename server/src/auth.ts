/**
 * 认证（V2 极简版）：单管理员本地 session。已移除 RBAC 四级、2FA、临时 token、内存限流与审计。
 * 会话：Bearer Token，30 分钟无操作过期，活动即续期。
 */
import type { NextFunction, Request, Response } from 'express'
import crypto from 'node:crypto'
import { prisma } from './prisma'
import { generateToken } from './crypto'

/** Session token 库内只存哈希：DB 文件泄露时无法直接冒用会话 */
export const hashToken = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex')

export interface AuthUser {
  id: string
  email: string
  nickname: string
  lastLoginAt?: Date | null
  lastLoginIp?: string
  lastLoginAgent?: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

const SESSION_TTL_MS = 30 * 60 * 1000
/** “记住我”长会话：30 天 */
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000

export async function createSession(userId: string, remember = false): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_TTL_MS : SESSION_TTL_MS))
  await prisma.session.create({ data: { token: hashToken(token), userId, expiresAt, remembered: remember } })
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return { token, expiresAt }
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) return null
  return h.slice(7).trim()
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req)
  if (!token) {
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '未登录', details: null } })
    return
  }
  const session = await prisma.session.findUnique({ where: { token: hashToken(token) }, include: { user: true } })
  if (!session || session.expiresAt < new Date()) {
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '会话无效或已过期', details: null } })
    return
  }
  // 兜底：Session 关联的 User 已被删除（理论上 cascade 已移除，防御性处理避免 500）
  if (!session.user) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '会话无效或已过期', details: null } })
    return
  }
  // 活动续期：记住我的长会话按 30 天续，普通会话 30 分钟无操作过期。
  // 仅当剩余 TTL 不足一半时才写库续期，避免"每次请求都 UPDATE"造成的 SQLite 写放大
  const ttl = session.remembered ? REMEMBER_TTL_MS : SESSION_TTL_MS
  if (session.expiresAt.getTime() - Date.now() < ttl / 2) {
    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + ttl) },
    })
  }
  const { id, email, nickname, lastLoginAt, lastLoginIp, lastLoginAgent } = session.user
  req.user = { id, email, nickname, lastLoginAt, lastLoginIp, lastLoginAgent }
  next()
}