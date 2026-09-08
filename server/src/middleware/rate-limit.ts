/**
 * 全局限流中间件（每 IP 滑动窗口）：防止暴力扫描/接口滥用拖垮服务。
 * 登录/发码等敏感接口另有更严格的专用限流，此为粗粒度兜底。
 */
import type { Request, Response, NextFunction } from 'express'

const RATE_MAX = parseInt(process.env.RATE_LIMIT_MAX || '240', 10) // 默认 240 次/分钟
const RATE_WINDOW_MS = 60_000
const rateBuckets = new Map<string, number[]>()

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = String(req.ip || req.socket.remoteAddress || 'unknown')
  const now = Date.now()
  const list = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (list.length >= RATE_MAX) {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试', details: null } })
    return
  }
  list.push(now)
  rateBuckets.set(ip, list)
  next()
}

// 周期性清场：过期窗口的桶整体删除，防止 Map 随来源增长
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of rateBuckets) {
    const live = list.filter((t) => now - t < RATE_WINDOW_MS)
    if (live.length === 0) rateBuckets.delete(k)
    else rateBuckets.set(k, live)
  }
}, 5 * 60 * 1000).unref?.()