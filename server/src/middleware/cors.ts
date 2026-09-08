/**
 * 极简 CORS：只有显式白名单来源才回 CORS 头（不反射任意 Origin）。
 * 白名单 = 生产环境 CORS_ORIGINS 逗号分隔列表；非生产默认放行 localhost:3000-3079 供开发多端口使用。
 */
import type { Request, Response, NextFunction } from 'express'

function buildCorsAllowlist(): Set<string> {
  const set = new Set<string>()
  if (process.env.NODE_ENV !== 'production') {
    for (let p = 3000; p < 3080; p++) set.add(`http://localhost:${p}`)
  }
  for (const o of String(process.env.CORS_ORIGINS ?? '').split(',')) {
    const v = o.trim()
    if (v) set.add(v)
  }
  return set
}

const corsAllowlist = buildCorsAllowlist()

export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin
  if (origin && corsAllowlist.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
}