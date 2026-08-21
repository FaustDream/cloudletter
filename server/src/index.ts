/**
 * 云笺集 · Node 服务（Express + Prisma，:3010）
 * 绞杀者模式（§6.3）：/api/v2/* 为新契约；旧 admin/server.cjs 端点由其自行承载，逐步下线。
 */
import 'dotenv/config'
import express from 'express'
import { v2 } from './routes/v2.js'
import { scheduleDailyBackup } from './services/backup.js'
import { prisma } from './prisma.js'

const PORT = parseInt(process.env.PORT || '3010', 10)
const app = express()

app.disable('x-powered-by')

// 🟡S4 安全头（手写 helmet 核心项，避免额外依赖；如需 CSP 请按部署域名扩展）
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  // 同源部署（/dev/* 反向代理）下不设 CORS；若前后端跨域，需在此显式白名单
  next()
})

app.use(express.json({ limit: '2mb' }))

// 健康检查（§14：服务宕机时公开站点静态产物仍可访问，此端点供探活）
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), time: new Date().toISOString() })
})

app.use('/api/v2', v2)

// 404 兜底
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在', details: null } })
})

// 统一错误包络（§6）。B1 修复后异步 rejected promise 都会汇聚到这里。
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[unhandled]', err)
  // 若响应已开始则交给 Express 默认处理，避免双重写
  if (res.headersSent) return
  res.status(500).json({ error: { code: 'INTERNAL', message: '服务器内部错误', details: null } })
})

const server = app.listen(PORT, () => {
  console.log(`[cloudletter-server] listening on :${PORT}`)
  console.log(`  healthz:  http://localhost:${PORT}/healthz`)
  console.log(`  api v2:   http://localhost:${PORT}/api/v2/*`)
  // 每日 03:00 自动备份（§11，保留最近 7 份）
  scheduleDailyBackup()
})

// 💭K1 优雅退出：SIGINT/SIGTERM 时断开 Prisma，避免丢未 flush 的写
function shutdown(signal: string): void {
  console.log(`[cloudletter-server] ${signal} 收到，正在优雅退出…`)
  server.close(() => {
    prisma
      .$disconnect()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  })
  // 兜底：10s 内未完成则强制退出
  setTimeout(() => process.exit(1), 10_000).unref?.()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
