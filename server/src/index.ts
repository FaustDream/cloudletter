/**
 * Cloudletter V2 · Node 服务（Express + Prisma，:3010）
 * 收敛后端：极简 API（文章/分类/标签/版本/搜索/设置 + 单管理员认证），无构建队列/备份/审计。
 * 中间件与错误包络均在 middleware/ 目录，本文件只做装配。
 */
import 'dotenv/config'
import express from 'express'
import { api } from './routes/index.js'
import { prisma } from './prisma.js'
import { uploadsDir, avatarsDir } from './config.js'
import { smtpStatus } from './mailer.js'
import { initSearchIndex, reindexAllSearch } from './search-index.js'
import { logInfo, logWarn, logError } from './logger.js'
import { securityHeaders } from './middleware/security.js'
import { requestLog } from './middleware/request-log.js'
import { rateLimit } from './middleware/rate-limit.js'
import { cors } from './middleware/cors.js'
import { payloadTooLarge, notFound, errorHandler } from './middleware/errors.js'

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

app.use(securityHeaders)
app.use(requestLog)
app.use(express.json({ limit: '2mb' }))
app.use(payloadTooLarge)
app.use('/api', rateLimit)
app.use(cors)

// 健康检查：服务宕机时公开站点静态产物仍可访问，此端点供探活（不暴露运行细节）
app.get('/healthz', (_req, res) => {
  res.json({ ok: true })
})

// API 路由在前（含 POST /api/v2/uploads 直传）
app.use('/api/v2', api)

// 上传图片静态托管兜底在前缀路由未命中的 GET（文件名含随机 hex 不可枚举；博客前台将来引用图片需公开可读）
app.use('/api/v2/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true }))
// 头像静态托管（/api/v2/avatars/*）
app.use('/api/v2/avatars', express.static(avatarsDir, { maxAge: '1d' }))

app.use(notFound)
app.use(errorHandler)

const server = app.listen(PORT, () => {
  logInfo('boot', `listening on :${PORT}（healthz /api/v2 已就绪）`, { port: PORT })
  // 全文索引就绪：建表 + 索引空时自动全量重建（首次升级/灾难恢复兜底）
  initSearchIndex()
    .then(async (ok) => {
      if (!ok) {
        logWarn('search', 'FTS5 不可用，检索将降级为 LIKE')
        return
      }
      const cnt = await prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM post_search`) as Array<{ n: number | bigint }>
      const postCnt = await prisma.post.count()
      if (Number(cnt[0]?.n ?? 0) === 0 && postCnt > 0) {
        const n = await reindexAllSearch()
        logInfo('search', `索引为空，已自动重建 ${n} 篇`)
      } else {
        logInfo('search', '全文索引就绪（FTS5 + 中文分词）')
      }
    })
    .catch((e) => {
      // 启动期索引初始化失败不应导致进程崩溃：记日志降级，后续可用 reindex 维护
      logError('search', e, { hint: '索引初始化失败，检索将降级' })
    })
  // 生产环境 SMTP 就绪性检查：不可用时验证码/解锁/重置邮件将全部 503
  if (process.env.NODE_ENV === 'production') {
    const smtp = smtpStatus()
    if (!smtp.ok) {
      logWarn('boot', `生产环境 SMTP 未就绪：${smtp.reason}（邮箱验证码/账户解锁/密码重置邮件将不可用）`)
    } else {
      logInfo('boot', 'SMTP 已就绪（TLS 校验通过），验证码/解锁/重置邮件将真实发送')
    }
  }
})

// 优雅退出：断开 Prisma，避免丢未 flush 的写
function shutdown(signal: string): void {
  logInfo('shutdown', `${signal} 收到，正在优雅退出…`)
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