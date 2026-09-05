/** /api/v2 客户端（§6 契约）：统一错误包络解析 + Bearer Token */
import { markLoginEpoch } from './lib/tour'

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

/* ===== 日志上报 + 服务器实时状态（时间长河/节点宇宙排查与监控用） ===== */

export type ClientLogLevel = 'info' | 'warn' | 'error' | 'debug'

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

export interface ServerStatus {
  cpu: number
  mem: { used: number; total: number; percent: number }
  net: { up: number; down: number } | null
  ts: number
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
    const e = (data as any)?.error
    throw new ApiError(res.status, e?.code ?? 'UNKNOWN', e?.message ?? `HTTP ${res.status}`, e?.details)
  }
  return data as { url: string; bytes: number }
}

/* ========== 类型（§4/§6 瘦身版） ========== */

export interface User {
  id: string
  email: string
  nickname?: string
  lastLoginAt?: string | null
  lastLoginIp?: string
  lastLoginAgent?: string
  avatar?: string
  avatarFrame?: string
  avatarBadge?: string
}

export type PostStatus = 'draft' | 'published'

export interface Category {
  id: string
  name: string
  slug: string
  description: string | null
  _count?: { posts: number }
}

export interface Tag {
  id: string
  name: string
  slug: string
  _count?: { posts: number }
}

export interface PostListItem {
  id: string
  slug: string
  title: string
  status: PostStatus
  summary: string
  updatedAt: string
  publishedAt: string | null
  category: { name: string; slug: string } | null
  tags: string[]
  chars: number
  readMin: number
}

export interface PostDetail {
  id: string
  slug: string
  title: string
  summary: string
  status: PostStatus
  rawMarkdown: string
  frontmatter: string
  categoryId: string | null
  category: Category | null
  tags: string[]
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

export interface RevMeta {
  id: string
  version: number
  createdAt: string
}

export interface RevDetail extends RevMeta {
  content: string
}

/* ========== 工作台模块（/workbench/:scope） ========== */

export type WbScope = 'plan' | 'checkin' | 'ledger' | 'goals' | 'notes' | 'worktask'

export interface PlanItem {
  id: string
  text: string
  level: 'P0' | 'P1' | 'P2'
  note: string
  done: boolean
  dueDate: string
  doneAt: string
  order: number
  createdAt: string
  updatedAt: string
}

export interface CheckinItem {
  id: string
  name: string
  emoji: string
  /** 习惯说明（Markdown，编辑器内核维护） */
  desc: string
  /** {"YYYY-MM-DD": true} 逐日打卡记录 */
  log: string
  streak: number
  createdAt: string
  updatedAt: string
}

export interface LedgerEntry {
  id: string
  kind: 'income' | 'expense'
  cat: string
  amount: number
  note: string
  date: string
  createdAt: string
}

export interface GoalItem {
  id: string
  name: string
  emoji: string
  desc: string
  current: number
  target: number
  unit: string
  relatedPlanIds: string
  relatedCheckinIds: string
  createdAt: string
  updatedAt: string
}

/** 速记类型（NoteItem.type）：灵感 | 计划 */
export type NoteType = 'inspiration' | 'plan'

export interface NoteItem {
  id: string
  title: string
  body: string
  /** 规范类型（inspiration=灵感 | plan=计划）；mood 为自由标签 */
  type: NoteType
  mood: string
  date: string
  done: boolean
  doneAt: string
  createdAt: string
  updatedAt: string
}

/** 工作计划任务（周一~周五工作安排） */
export interface WorkTask {
  id: string
  date: string // YYYY-MM-DD
  text: string
  note: string
  done: boolean
  doneAt: string
  order: number
  createdAt: string
  updatedAt: string
}

export type WbItem = PlanItem | CheckinItem | LedgerEntry | GoalItem | NoteItem

/* ========== 双视图时间轴（/workbench/timeline） ========== */

export type TimelineType = 'journal' | 'note' | 'plan' | 'checkin' | 'ledger' | 'goal'

export interface TimelineNode {
  id: string
  t: TimelineType
  title: string
  sub: string
  date: string
  xp?: number
  gold?: number
  tags?: string[]
  /** 精确时间（ISO），用于跨天排序/实时流 */
  ts?: string
}

export interface TimelineDay {
  date: string
  xp: number
  gold: number
  items: TimelineNode[]
}

/** 数据核心 / 数字城市：真实数据聚合统计（GET /workbench/dashboard） */
export interface DashboardStats {
  totals: Record<TimelineType | 'posts' | 'worktask', number>
  chars: number
  plan: { total: number; done: number }
  worktask: { total: number; done: number }
  checkin: { total: number; today: number; checkedDays: number; maxStreak: number }
  goal: { total: number; pct: number }
  ledger: { total: number; income: number; expense: number; monthIncome: number; monthExpense: number }
  posts: { total: number; published: number }
  asOf: string
}
