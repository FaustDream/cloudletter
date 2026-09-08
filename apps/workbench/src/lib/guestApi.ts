/**
 * 访客 API 客户端（一次性授权访问）：与主 api.ts 同构的 fetch 包装，
 * token 存 cookie cl_gtoken（与 cl_token 隔离，避免串会话）。
 */
const GTOKEN_KEY = 'cl_gtoken'

export function getGuestToken(): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + GTOKEN_KEY + '=([^;]*)'))
  return m ? decodeURIComponent(m[1]) : null
}

export function setGuestToken(t: string | null): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  if (t) {
    const expires = new Date(Date.now() + 7 * 86400 * 1000).toUTCString()
    document.cookie = `${GTOKEN_KEY}=${encodeURIComponent(t)}; path=/; expires=${expires}; SameSite=Lax${secure}`
  } else {
    document.cookie = `${GTOKEN_KEY}=; path=/; max-age=0${secure}`
  }
}

export class GuestApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getGuestToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api/v2${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = (data as { error?: { message?: string } }).error
    throw new GuestApiError(res.status, e?.message ?? `HTTP ${res.status}`)
  }
  return data as T
}

export const guestApi = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
}

/** 授权范围 → 展示名（与服务端 SCOPE_LABEL 同口径） */
export const SCOPE_LABELS: Record<string, string> = {
  timeline: '时间流',
  posts: '文章',
  notes: '速记',
  workplan: '工作计划',
  plan: '今日计划',
}
