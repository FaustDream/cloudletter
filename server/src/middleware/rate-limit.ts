/**
 * 认证限流（§11 / 🔴B2）：
 * - 内存态滑动窗口，按 IP + 账户(email) 双维度计数
 * - 认证失败（401）计数，超过阈值锁定 lockMs
 * - 成功（非 401）清零；窗口过期自动重置
 * 说明：单进程内存实现，满足单机部署；多实例场景应换 Redis 计数器。
 */
import type { NextFunction, Request, Response } from 'express'

interface Bucket {
  count: number
  resetAt: number
  lockUntil: number
}

const buckets = new Map<string, Bucket>()

/** 定期清理过期桶，防内存泄漏 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) {
    if (b.resetAt < now && b.lockUntil < now) buckets.delete(k)
  }
}, CLEANUP_INTERVAL_MS).unref?.()

export interface AuthRateLimitOptions {
  windowMs: number
  max: number
  lockMs: number
}

export function createAuthRateLimiter(opts: AuthRateLimitOptions) {
  const { windowMs, max, lockMs } = opts
  return function authRateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now()
    const ip = req.ip || req.socket.remoteAddress || 'unknown'
    const email = String(req.body?.email ?? '').toLowerCase().trim()
    // 账户维度优先（同一账户暴力尝试跨 IP 也会被锁定），无账户信息退回 IP 维度
    const key = email ? `user:${email}` : `ip:${ip}`

    let b = buckets.get(key)
    if (!b) {
      b = { count: 0, resetAt: now + windowMs, lockUntil: 0 }
      buckets.set(key, b)
    }
    if (b.resetAt < now) {
      b.count = 0
      b.resetAt = now + windowMs
    }

    if (b.lockUntil > now) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: '尝试次数过多，已临时锁定，请稍后再试',
          details: { retryAfterMs: b.lockUntil - now },
        },
      })
      return
    }

    // 响应完成后再计数：401 视为一次失败，成功则清零
    res.on('finish', () => {
      if (res.statusCode === 401) {
        b!.count++
        if (b!.count >= max) {
          b!.lockUntil = now + lockMs
          b!.count = 0
          b!.resetAt = now + windowMs
        }
      } else if (res.statusCode === 200) {
        b!.count = 0
      }
    })

    next()
  }
}
