/** /api/v2 领域类型（§4/§6 瘦身版）：请求工具（./api）与各页面/组件共用，独立维护避免 api.ts 臃肿 */

/* ========== 账户与认证 ========== */

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

/* ========== 文章 / 分类 / 标签 ========== */

export type PostStatus = 'draft' | 'published'

export interface Category {
  id: string
  name: string
  slug: string
  description: string | null
  /** 灵感笔记与文章共用分类，计数含两边 */
  _count?: { posts: number; notes: number }
}

export interface Tag {
  id: string
  name: string
  slug: string
  /** 灵感笔记与文章共用标签，计数含两边 */
  _count?: { posts: number; notes: number }
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
  /** 封面图 URL（frontmatter.cover，卡片视图展示） */
  cover?: string
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
  /** 快照来源：manual=手动保存，auto=自动保存 */
  kind?: string
}

export interface RevDetail extends RevMeta {
  content: string
}

/* ========== 工作台模块（/workbench/:scope） ========== */

export type WbScope = 'plan' | 'checkin' | 'ledger' | 'goals' | 'notes' | 'worktask' | 'focus'

export interface PlanItem {
  id: string
  text: string
  level: 'P0' | 'P1' | 'P2' | 'P4'
  note: string
  done: boolean
  dueDate: string
  doneAt: string
  order: number
  createdAt: string
  updatedAt: string
}

/** 番茄专注执行记录（日常 × 计划联动）：选定计划专注后落一条 */
export interface FocusLog {
  id: string
  /** 关联的今日计划 id，空 = 自由专注 */
  planId: string
  /** 计划名快照 */
  planTitle: string
  minutes: number
  date: string
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

/** 速记弹窗的记录模式（仅 UI 概念）：灵感=灵感笔记；计划=直接进今日计划 */
export type NoteType = 'inspiration' | 'plan'

/** 灵感笔记状态：pending=待使用 / used=已使用 / expired=已过期 */
export type NoteStatus = 'pending' | 'used' | 'expired'

export interface NoteItem {
  id: string
  title: string
  body: string
  date: string
  /** 灵感状态：待使用（默认）/ 已使用 / 已过期 */
  status: NoteStatus
  /** 与文章共用的分类（null = 未分类） */
  categoryId: string | null
  category?: { id: string; name: string; slug: string } | null
  /** 与文章共用的标签名 */
  tags: string[]
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

export type TimelineType = 'journal' | 'note' | 'plan' | 'checkin' | 'ledger' | 'goal' | 'focus'

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

/* ========== 服务器实时状态（/workbench/server-status） ========== */

export interface ServerStatus {
  cpu: number
  mem: { used: number; total: number; percent: number }
  net: { up: number; down: number } | null
  ts: number
}

export type ClientLogLevel = 'info' | 'warn' | 'error' | 'debug'