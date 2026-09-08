/**
 * 访问日志中间件：method/path/status/耗时/字节，结构化单行进 logInfo（供 journald/日志目录采集）。
 */
import type { Request, Response, NextFunction } from 'express'
import { logInfo } from '../logger'

export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const t0 = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - t0
    const ip = req.ip ?? req.socket.remoteAddress ?? '-'
    logInfo('http', `${req.method} ${req.originalUrl} -> ${res.statusCode}`, { m: req.method, p: req.originalUrl, s: res.statusCode, ms, ip })
  })
  next()
}