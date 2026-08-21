/** /api/v2 客户端（§6 契约）：统一错误包络解析 + Bearer Token */

const TOKEN_KEY = 'cl_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
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
    const e = (data as any)?.error
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

/* ========== 类型（§4/§6） ========== */

export interface User {
  id: string
  email: string
  role: string
  totpEnabled: boolean
}

/* ========== 站点设置（§9 六组） ========== */

export type SettingsGroup = 'appearance' | 'layout' | 'content' | 'reading' | 'interaction'

export interface AppearanceSettings {
  theme: 'deepspace' | 'aurora' | 'cyber'
  accentColor: string
  glassBlur: number
  animations: boolean
  fxBackground: boolean
  fxReveal: boolean
  fxGlow: boolean
}

export interface LayoutModule {
  id: string
  title: string
  visible: boolean
}

export interface LayoutSettings {
  modules: LayoutModule[]
  density: 'comfortable' | 'compact'
  sidebarPos: 'left' | 'right'
}

export interface NavItem {
  name: string
  link: string
}

export interface ContentSettings {
  blogEnabled: boolean
  kbEnabled: boolean
  pageSize: number
  navItems: NavItem[]
}

export interface ReadingSettings {
  toc: boolean
  tocDepth: number
  readTime: boolean
  codeTheme: string
  related: boolean
  prevnext: boolean
}

export interface InteractionSettings {
  searchScope: 'blog' | 'note' | 'all'
  cmdk: boolean
  smoothScroll: number
  rss: boolean
  sitemap: boolean
  seoTitle: string
  seoDesc: string
}

export interface SiteSettings {
  appearance?: AppearanceSettings
  layout?: LayoutSettings
  content?: ContentSettings
  reading?: ReadingSettings
  interaction?: InteractionSettings
}

/* ========== 系统组（§9 system：沿用现有 API） ========== */

export interface MonitorInfo {
  uptime: number
  memoryMB: number
  posts: { total: number; published: number; drafts: number; trashed: number }
  users: number
  activeSessions: number
  time: string
}

export interface AuditItem {
  id: string
  userId: string | null
  action: string
  detail: string
  createdAt: string
  user?: { email: string } | null
}
