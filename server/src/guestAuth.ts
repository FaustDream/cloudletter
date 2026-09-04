/**
 * 访客会话认证（一次性授权派生）：Bearer GuestSession token，
 * 仅放行只读端点；授权撤销/过期即刻失效。
 */
import type { NextFunction, Request, Response } from 'express'
import { prisma } from './prisma'
import { hashToken, extractBearer } from './auth'

export interface GuestGrant {
  grantId: string
  scopes: string[]
  expiresAt: Date
  label: string
}

declare global {
  namespace Express {
    interface Request {
      guest?: GuestGrant
    }
  }
}

export async function requireGuest(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req)
  if (!token) {
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '授权访问已失效，请通过邮件链接重新进入', details: null } })
    return
  }
  const session = await prisma.guestSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { grant: true } })
  const now = new Date()
  if (!session || session.expiresAt < now || session.grant.revokedAt || session.grant.expiresAt < now) {
    res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: '授权访问无效或已过期', details: null } })
    return
  }
  let scopes: string[] = []
  try { scopes = JSON.parse(session.grant.scopes || '[]') } catch { /* 忽略损坏 */ }
  req.guest = { grantId: session.grant.id, scopes, expiresAt: session.grant.expiresAt, label: session.grant.label }
  next()
}

/** 范围闸门：guest token 未被授予该模块时 403 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.guest?.scopes.includes(scope)) {
      res.status(403).json({ error: { code: 'SCOPE_DENIED', message: '本次授权不包含该模块', details: null } })
      return
    }
    next()
  }
}
