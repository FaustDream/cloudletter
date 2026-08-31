/**
 * 路由工具：错误包络 + 异步 handler 包装（替代旧的 wrapAsyncRouter hack）。
 */
import type { NextFunction, Request, Response } from 'express'

export function err(
  res: Response,
  status: number,
  code: string,
  message: string,
  details: unknown = null,
): void {
  res.status(status).json({ error: { code, message, details } })
}

/** 把 async handler 的 rejected promise 交给 Express 错误中间件 */
export const ah =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next)
  }