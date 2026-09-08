/** /api/v2 客户端（§6 契约）：统一错误包络解析 + Bearer Token。
 *  领域类型（User/Post/Timeline/…）独立维护于 ./api-types，本文件 re-export 保持单一导入入口。 */
import { markLoginEpoch } from './lib/tour'
import type { ClientLogLevel, ServerStatus } from './api-types'

export type * from './api-types'

const TOKEN_KEY = 'cl_token'
const COOKIE_DAYS = 30

/** 从 cookie 读取 token（跨端口共享，localhost 下不同端口共享 cookie） */
function getCookieToken(): string | null {
  const match = document.cookie.match(new RegExp('(?:^|; )' + TOKEN_KEY + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookieToken(t: string | null): void {
  // 生产走 HTTPS 时追加 Secure（开发 http 下不设，避免 localhost cookie 无法回写）
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  if (t) {
    const expires = new Date(Date.now() + COOKIE_DAYS * 86400 * 1000).toUTCString()
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(t)}; path=/; expires=${expires}; SameSite=Lax${secure}`
  } else {
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0${secure}`
  }
}

export function getToken(): string | null {
  // 单一来源 = cookie（跨端口共享）；localStorage 仅作旧版本遗留读取兜底，不再写入
  return getCookieToken() || localStorage.getItem(TOKEN_KEY) || null
}
export function setToken(t: string | null): void {
  if (t) {
    // 清理旧 localStorage 副本，token 只留一份（减少 XSS 侧漏面）
    localStorage.removeItem(TOKEN_KEY)
    setCookieToken(t)
    // 所有登录路径的统一收口：写入登录会话标记（功能导览按「重新登录」弹出的依据）
    markLoginEpoch()
  } else {
    localStorage.removeItem(TOKEN_KEY)
    setCookieToken(null)
  }
}

export class ApiError extends Error {
  code: string
  status: number
  details: unknown
  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api/v2${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 会话过期/无效：清 token 回登录页（登录接口本身的 401 除外，避免误伤密码错误提示）
    if (res.status === 401 && !path.startsWith('/auth/')) {
      setToken(null)
      if (!location.pathname.startsWith('/login')) {
        location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`
      }
    }
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? `HTTP ${res.status}`, e?.details)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

/* ===== 日志上报 + 服务器实时状态（时间长河/节点宇宙排查与监控用） ===== */

/**
 * 客户端日志上报：火并忘（fire-and-forget），绝不因日志失败打断业务。
 * src 建议用模块名（universe / timeline / overview …），方便按源过滤日志目录。
 */
export function logClient(level: ClientLogLevel, src: string, message: string, extra?: Record<string, unknown>): void {
  try {
    void request('POST', '/workbench/client-log', { level, src, message, extra }).catch(() => {})
  } catch {
    /* 忽略上报异常 */
  }
}

export async function serverStatus(): Promise<ServerStatus> {
  return request<ServerStatus>('GET', '/workbench/server-status')
}

/** 图片直传（二进制 body，非 JSON；服务端 POST /uploads 兜底类型与大小校验） */
export async function uploadImage(file: Blob): Promise<{ url: string; bytes: number }> {
  const headers: Record<string, string> = { 'Content-Type': file.type || 'application/octet-stream' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch('/api/v2/uploads', { method: 'POST', headers, body: file })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } })?.error
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? `HTTP ${res.status}`, e?.details)
  }
  return data as { url: string; bytes: number }
}