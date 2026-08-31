/**
 * Cloudletter V2 · Node 服务（Express + Prisma，:3010）
 * 收敛后端：极简 API（文章/分类/标签/版本/搜索/设置 + 单管理员认证），无构建队列/备份/审计。
 */
import 'dotenv/config'
import express from 'express'
import { api } from './routes/index.js'
import { prisma } from './prisma.js'
import { uploadsDir } from './config.js'
import { smtpStatus } from './mailer.js'
import { initSearchIndex, reindexAllSearch } from './search-index.js'

// 安全提示：ADMIN_PASSWORD 仅 pnpm seed 首次初始化使用，运行期 API 一律不读取明文口令。
// 若该配置仍留在 .env，说明初始管理员已创建后可将其移除，避免明文口令长期驻留。
if (process.env.ADMIN_PASSWORD) {
  console.warn('[security] 检测到 ADMIN_PASSWORD 仍存在：其仅用于 pnpm seed 首次初始化，创建管理员后建议从 .env 中移除')
}

const PORT = parseInt(process.env.PORT || '3010', 10)
const app = express()

app.disable('x-powered-by')

// 生产部署位于 nginx（同一台或信任的一跳代理）之后：信任首个代理，使 req.ip/限流拿到真实客户端 IP
app.set('trust proxy', 1)

// 安全头（V2 手写核心项；生产环境额外下发 CSP，开发/HMR 跳过以避免 inline 样式被拦）
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; " +
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    )
  }
  if (_req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

// 极简访问日志（method/path/status/耗时/字节），console 结构化单行，供 journald 采集
app.use((req, res, next) => {
  const t0 = Date.now()
  res.on('finish', () => {
    const ms = Date.now() - t0
    const ip = req.ip ?? req.socket.remoteAddress ?? '-'
    console.log(JSON.stringify({ t: 'req', ts: new Date().toISOString(), m: req.method, p: req.originalUrl, s: res.statusCode, ms, ip }))
  })
  next()
})

app.use(express.json({ limit: '2mb' }))

// 请求体超限（>2MB，如超大正文）→ 413 结构化响应，而不是 500
app.use((err: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if ((err as unknown as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '请求体积超出限制（2MB），大文档请分段保存', details: null } })
    return
  }
  next(err)
})

// 全局限流（每 IP 滑动窗口）：防止暴力扫描/接口滥用拖垮服务；
// 登录/发码等敏感接口另有更严格的专用限流，此为粗粒度兜底。
const RATE_MAX = parseInt(process.env.RATE_LIMIT_MAX || '240', 10) // 默认 240 次/分钟
const RATE_WINDOW_MS = 60_000
const rateBuckets = new Map<string, number[]>()
app.use('/api', (req, res, next) => {
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
})
// 周期性清场：过期窗口的桶整体删除，防止 Map 随来源增长
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of rateBuckets) {
    const live = list.filter((t) => now - t < RATE_WINDOW_MS)
    if (live.length === 0) rateBuckets.delete(k)
    else rateBuckets.set(k, live)
  }
}, 5 * 60 * 1000).unref?.()

// 极简 CORS：只有显式白名单来源才回 CORS 头（不反射任意 Origin）。
// 白名单 = 生产环境 CORS_ORIGINS 逗号分隔列表；非生产默认放行 localhost:3000-3079 供开发多端口使用。
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

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && corsAllowlist.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// 健康检查：服务宕机时公开站点静态产物仍可访问，此端点供探活（不暴露运行细节）
app.get('/healthz', (_req, res) => {
  res.json({ ok: true })
})

// API 路由在前（含 POST /api/v2/uploads 直传）
app.use('/api/v2', api)

// 上传图片静态托管兜底在前缀路由未命中的 GET（文件名含随机 hex 不可枚举；博客前台将来引用图片需公开可读）
app.use('/api/v2/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true }))

// 404 兜底
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在', details: null } })
})

// 统一错误包络（ah() 已把异步 reject 汇聚到此）
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
  console.error('[unhandled]', err)
  if (res.headersSent) return
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误', details: null } })
})

const server = app.listen(PORT, () => {
  console.log(`[cloudletter-server] listening on :${PORT}`)
  console.log(`  healthz:  http://localhost:${PORT}/healthz`)
  console.log(`  api v2:   http://localhost:${PORT}/api/v2/*`)
  // 全文索引就绪：建表 + 索引空时自动全量重建（首次升级/灾难恢复兜底）
  initSearchIndex()
    .then(async (ok) => {
      if (!ok) {
        console.warn('[search] FTS5 不可用，检索将降级为 LIKE')
        return
      }
      const cnt = await prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM post_search`) as Array<{ n: number | bigint }>
      const postCnt = await prisma.post.count()
      if (Number(cnt[0]?.n ?? 0) === 0 && postCnt > 0) {
        const n = await reindexAllSearch()
        console.log(`[search] 索引为空，已自动重建 ${n} 篇`)
      } else {
        console.log('[search] 全文索引就绪（FTS5 + 中文分词）')
      }
    })
    .catch((e) => {
      // 启动期索引初始化失败不应导致进程崩溃：记日志降级，后续可用 reindex 维护
      console.error('[search] 索引初始化失败，检索将降级:', e instanceof Error ? e.message : e)
    })
  // 生产环境 SMTP 就绪性检查：不可用时验证码/解锁/重置邮件将全部 503
  if (process.env.NODE_ENV === 'production') {
    const smtp = smtpStatus()
    if (!smtp.ok) {
      console.warn(`[security] 生产环境 SMTP 未就绪：${smtp.reason}（邮箱验证码/账户解锁/密码重置邮件将不可用）`)
    } else {
      console.log('[mail]    SMTP 已就绪（TLS 校验通过），验证码/解锁/重置邮件将真实发送')
    }
  }
})

// 优雅退出：断开 Prisma，避免丢未 flush 的写
function shutdown(signal: string): void {
  console.log(`[cloudletter-server] ${signal} 收到，正在优雅退出…`)
  server.close(() => {
    prisma
      .$disconnect()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
  setTimeout(() => process.exit(1), 10_000).unref?.()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))