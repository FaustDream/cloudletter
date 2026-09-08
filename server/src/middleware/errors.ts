/**
 * 统一错误包络中间件：请求体超限(413) / 路由未命中(404) / 兜底错误(500) + Prisma 已知错误码语义化。
 */
import type { Request, Response, NextFunction } from 'express'
import { logError } from '../logger'

/** 请求体超限（>2MB，如超大正文）→ 413 结构化响应，而不是 500。挂在 express.json 之后。 */
export function payloadTooLarge(err: Error | null, _req: Request, res: Response, next: NextFunction): void {
  if ((err as { type?: string } | null)?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体积超出限制（2MB），大文档请分段保存', details: null } })
    return
  }
  next(err)
}

/** 路由未命中兜底 */
export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在', details: null } })
}

/** 统一错误兜底（ah() 已把异步 reject 汇聚到此） */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const code = (err as { code?: unknown }).code
  // Prisma 已知错误码 → 结构化语义响应，绝不把原始消息透出
  if (code === 'P2025') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '资源不存在', details: null } })
    return
  }
  if (code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: '资源冲突或已存在', details: null } })
    return
  }
  if (code === 'P2003' || code === 'P2014') {
    res.status(422).json({ error: { code: 'VALIDATION', message: '关联资源不存在或约束冲突', details: null } })
    return
  }
  logError('http', err, { p: `${req.method} ${req.originalUrl}`, code })
  if (res.headersSent) return
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误', details: null } })
}