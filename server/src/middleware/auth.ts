/**
 * 认证与 RBAC 中间件（§6 / §11）
 * 会话：Bearer Token，30 分钟无操作过期（§11），活动即续期。
 */
import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../prisma'
import { generateToken } from '../crypto'

export interface AuthUser {
  id: string
  email: string
  role: string
  totpEnabled: boolean
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      sessionId?: string
    }
  }
}

const SESSION_TTL_MS = 30 * 60 * 1000

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({ data: { token, userId, expiresAt } })
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  return { token, expiresAt }
}

/** 临时 token（2FA 二次验证用，5 分钟有效，内存态即可） */
const tempTokens = new Map<string, { userId: string; expires: number }>()

export function issueTempToken(userId: string): string {
  const t = generateToken(24)
  tempTokens.set(t, { userId, expires: Date.now() + 5 * 60 * 1000 })
  return t
}

export function consumeTempToken(t: string): string | null {
  const e = tempTokens.get(t)
  if (!e) return null
  tempTokens.delete(t)
  if (e.expires < Date.now()) return null
  return e.userId
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
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } })
  if (!session || session.expiresAt < new Date()) {
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '会话无效或已过期', details: null } })
    return
  }
  // 活动续期（30 分钟无操作过期）
  await prisma.session.update({
    where: { id: session.id },
    data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  })
  req.user = {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role,
    totpEnabled: session.user.totpEnabled,
  }
  req.sessionId = session.id
  next()
}

const ROLE_RANK: Record<string, number> = { viewer: 0, author: 1, editor: 2, admin: 3 }

/** RBAC：要求至少某角色（§11 四级 admin/editor/author/viewer） */
export function requireRole(minRole: 'admin' | 'editor' | 'author' | 'viewer') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '未登录', details: null } })
      return
    }
    const rank = ROLE_RANK[req.user.role] ?? -1
    if (rank < ROLE_RANK[minRole]) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '权限不足', details: null } })
      return
    }
    next()
  }
}
