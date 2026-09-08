/**
 * 邮件/Feed 内链接的站点 origin（= 前端 SPA 所在地址，而非 API 地址）。
 * 此前直接取 API 请求的 Host 头拼链接：本地经 vite 代理（changeOrigin: true）
 * Host 被改写为后端端口，邮件里的 /login?reset=... 指向后端 → 应用级 404。
 * 优先级：WEB_ORIGIN env（服务器显式配置，最高）> 请求 Origin 头（浏览器 fetch
 * 天然携带 = 真实前端站点）> API 请求 Host（兼容 curl / API 直调，原行为兜底）。
 */
import type { IncomingHttpHeaders } from 'node:http'

/** webOrigin 的最小请求面（Express Request 结构兼容，便于单测构造） */
export interface OriginRequest {
  headers: IncomingHttpHeaders
  protocol: string
  get: (name: string) => string | undefined
}

/** 合法 origin：协议 + 主机[:端口]，不含路径/查询（IPv6 字面量带端口同样通过） */
const isOrigin = (s: string): boolean => /^https?:\/\/[^\s/]+$/i.test(s)

/** 归一化：去首尾空白与尾部斜杠 */
const norm = (s: string | undefined): string => String(s ?? '').trim().replace(/\/+$/, '')

export function webOrigin(req: OriginRequest): string {
  const env = norm(process.env.WEB_ORIGIN ?? '')
  if (env && isOrigin(env)) return env
  const header = norm(req.headers.origin as string | undefined)
  if (header && isOrigin(header)) return header
  return `${req.protocol}://${req.get('host') || 'localhost:3015'}`
}
