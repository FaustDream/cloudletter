/**
 * 个人工作台路由（框架：六类模块统一 REST CRUD，单人管理员）。
 * - plan     今日计划：text/level/note/done
 * - checkin  习惯打卡：name/emoji/desc/log/streak
 * - ledger   记账本：kind/cat/amount/note/date
 * - goals    长期目标：name/emoji/desc/current/target/unit
 * - notes    速记/灵感笔记：title/body/type(灵感|计划)/mood(标签)/date/done
 * - worktask 工作计划：date/text/note/done/doneAt
 */
import { Router } from 'express'
import os from 'node:os'
import fs from 'node:fs'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { ymdLocal } from '../util-date'
import { planDrop, postDrop } from '../game'
import { validateBody, v, type FieldSpec } from '../middleware/validate'
import { log, CLIENT_LOG_LEVELS, type LogLevel } from '../logger'
import { logActivity } from '../services/activity'

export const workbench = Router()
workbench.use(requireAuth)

/* ============================================================
   数据与存储：数据导入（完整迁移能力）。
   格式：cloudletter-backup JSON（含 kind / version / modules）。
   校验 → 冲突策略（skip 保留现有 / overwrite 覆盖）→ 事务提交，失败整体回滚。
   ============================================================ */
const IMPORT_MODULES = ['plan', 'checkin', 'ledger', 'goals', 'notes', 'worktask'] as const
const IMPORT_MODEL: Record<string, string> = {
  plan: 'planItem', checkin: 'checkinItem', ledger: 'ledgerEntry',
  goals: 'goalItem', notes: 'noteItem', worktask: 'workTask',
}

workbench.post('/data/import', ah(async (req, res) => {
  const b = (req.body ?? {}) as { bundle?: unknown; conflict?: string }
  const conflict = b.conflict === 'overwrite' ? 'overwrite' : 'skip'
  const bundle = b.bundle as { kind?: string; version?: number; modules?: Record<string, Array<Record<string, unknown>>> } | null
  if (!bundle || bundle.kind !== 'cloudletter-backup' || !bundle.modules || typeof bundle.modules !== 'object') {
    return err(res, 422, 'VALIDATION', '文件格式不正确（缺少 kind=cloudletter-backup 或 modules）')
  }
  const names = Object.keys(bundle.modules)
  const invalid = names.filter((n) => !(IMPORT_MODEL as Record<string, string>)[n])
  if (invalid.length) return err(res, 422, 'VALIDATION', `存在不支持的模块: ${invalid.join(', ')}`)
  const counts: Record<string, { total: number; added: number; skipped: number }> = {}
  // 先全量校验（类型/必填），再提交：任何模块失败即回滚，绝不半途写入
  const plan: Array<{ model: string; rows: Array<Record<string, unknown>> }> = []
  for (const [name, rows] of Object.entries(bundle.modules)) {
    if (!Array.isArray(rows)) return err(res, 422, 'VALIDATION', `模块 ${name} 的数据不是数组`)
    const cleanRows = rows.filter((r): r is Record<string, unknown> => r && typeof r === 'object')
    counts[name] = { total: cleanRows.length, added: 0, skipped: 0 }
    plan.push({ model: IMPORT_MODEL[name], rows: cleanRows })
  }
  const saved = await prisma.$transaction(async (tx) => {
    const result: Record<string, number> = {}
    for (const { model, rows } of plan) {
      result[model] = 0
      for (const row of rows) {
        // 服务端字段白名单：只导入业务字段，忽略 id/createdAt 等内部标识（避免主键冲突）
        const safe: Record<string, unknown> = {}
        for (const k of Object.keys(row)) {
          if (['id', 'createdAt', 'updatedAt', 'streak', 'postId', 'tagId'].includes(k)) continue
          if (typeof row[k] === 'string' || typeof row[k] === 'number' || typeof row[k] === 'boolean') {
            if (String(row[k]).length > 100_000) continue
            safe[k] = row[k]
          }
        }
        if (Object.keys(safe).length === 0) continue
        // 冲突策略：skip = 按业务唯一字段判重（不同模型不同）→ 跳过；overwrite = 直接新建副本
        if (conflict === 'skip') {
          const uniq = uniqKey(model, safe)
          if (uniq) {
            const hit = await (tx as any)[model].findFirst({ where: uniq })
            if (hit) { counts[modelNameFor(model)]!.skipped++; continue }
          }
        }
        try {
          await (tx as any)[model].create({ data: safe })
          result[model]++
          counts[modelNameFor(model)]!.added++
        } catch { counts[modelNameFor(model)]!.skipped++ }
      }
    }
    return result
  })
  logActivity(req, { action: 'data_import', object: '工作台数据', detail: { conflict, counts, applied: saved } })
  res.json({ ok: true, counts, saved })
}))

function modelNameFor(model: string): string {
  return Object.entries(IMPORT_MODEL).find(([, m]) => m === model)?.[0] ?? model
}

/** 各模型的业务唯一键（用于导入判重） */
function uniqKey(_model: string, row: Record<string, unknown>): Record<string, string> | null {
  // 通用：无稳定唯一键的模型以「原始文本+日期」近似（避免重复导入）
  if (typeof row.text === 'string' && row.text) return { text: row.text }
  if (typeof row.title === 'string' && row.title && typeof row.date === 'string') return { title: row.title, date: row.date }
  if (typeof row.name === 'string' && row.name) return { name: row.name }
  if (typeof row.url === 'string' && row.url) return { url: row.url }
  return null
}

// GET /week-stats —— 本周进度聚合（总览右栏卡片）：周一~周日，按服务器本地时区
// 注意：必须声明在 /:scope 通配路由之前，否则会被当成非法模块
workbench.get('/week-stats', ah(async (req, res) => {
  const now = new Date()
  const diff = (now.getDay() + 6) % 7 // 周一=0
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff)
  const days = Array.from({ length: 7 }, (_, i) => ymdLocal(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)))
  const w0 = days[0]
  const w1 = days[6]
  const inWeek = (d?: string | null) => !!d && d >= w0 && d <= w1

  // 拉取范围收敛到本周窗口：避免"全表拉取仅算 7 天"的无效读取
  const [plans, checkins, ledgers, posts] = await Promise.all([
    prisma.planItem.findMany({
      where: { OR: [{ dueDate: { gte: w0, lte: w1 } }, { createdAt: { gte: monday } }] },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.checkinItem.findMany(),
    prisma.ledgerEntry.findMany({ where: { date: { gte: w0, lte: w1 } } }),
    prisma.post.findMany({ where: { createdAt: { gte: monday } }, select: { id: true, createdAt: true } }),
  ])

  // 习惯打卡：本周打卡天数（≤7）+ 跨周累计最长连续（成就徽章）
  const checkDays = new Set<string>()
  for (const c of checkins) {
    try {
      const log = JSON.parse(c.log || '{}') as Record<string, boolean>
      for (const d of days) if (log[d] === true) checkDays.add(d)
    } catch { /* 忽略损坏的 log */ }
  }
  const maxStreak = checkins.reduce((m, c) => Math.max(m, c.streak || 0), 0)

  // 文章：本周有创建动作的覆盖天数（≤7）——本地时区取日期，与全站口径一致
  const postDays = new Set(
    posts.filter((p) => inWeek(ymdLocal(p.createdAt))).map((p) => ymdLocal(p.createdAt)),
  )

  // 记账：本周有记录的天数（≤7）
  const ledgerDays = new Set(
    ledgers.filter((l) => inWeek(String(l.date || ''))).map((l) => String(l.date).slice(0, 10)),
  )

  // 计划：dueDate 落在本周（无 dueDate 且本周创建也算）→ 完成度
  const wPlans = plans.filter((p) => {
    if (p.dueDate) return inWeek(p.dueDate)
    return p.createdAt && inWeek(ymdLocal(p.createdAt))
  })
  const plansTotal = wPlans.length
  const plansDone = wPlans.filter((p) => p.done).length

  // 平均完成率：四行各自完成度的均值（无数据行跳过）
  const ratios = [
    checkDays.size / 7,
    Math.min(postDays.size, 7) / 7,
    ledgerDays.size / 7,
    plansTotal ? plansDone / plansTotal : 0,
  ].filter((r) => r > 0)
  const avg = Math.round((ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0) * 100)

  res.json({
    week: { start: w0, end: w1, daysElapsed: diff + 1, daysRemain: 7 - (diff + 1) },
    checks: { days: checkDays.size, total: 7, maxStreak },
    posts: { days: Math.min(postDays.size, 7), total: 7 },
    ledger: { days: ledgerDays.size, total: 7 },
    plans: { done: plansDone, total: plansTotal },
    avg,
  })
}))

/** ============ 数据核心 / 数字城市 聚合统计（GET /dashboard）：真实数据，不虚构 ============ */

workbench.get('/dashboard', ah(async (_req, res) => {
  const today = ymdLocal(new Date())
  const month = today.slice(0, 7)
  const [posts, plans, checkins, ledgers, goals, notes, worktasks] = await Promise.all([
    prisma.post.findMany({ select: { id: true, status: true, charCount: true } }),
    prisma.planItem.findMany(),
    prisma.checkinItem.findMany(),
    prisma.ledgerEntry.findMany(),
    prisma.goalItem.findMany(),
    prisma.noteItem.findMany(),
    prisma.workTask.findMany(),
  ])
  // X X 习惯：逐日打卡总量 + 今日打卡 + 最大连续
  let checkedDays = 0
  let todayCheckins = 0
  let maxStreak = 0
  for (const c of checkins) {
    maxStreak = Math.max(maxStreak, c.streak || 0)
    try {
      const log = JSON.parse(c.log || '{}') as Record<string, boolean>
      for (const [d, v] of Object.entries(log)) if (v === true) checkedDays++
      if (log[today] === true) todayCheckins++
    } catch { /* 忽略损坏 log */ }
  }
  // 记账：收入 / 支出（本月 + 累计）
  const sum = (rows: typeof ledgers, k: 'income' | 'expense', filter?: (d: string) => boolean) =>
    rows.filter((r) => r.kind === k && (!filter || filter(r.date))).reduce((a, r) => a + (r.amount || 0), 0)
  const inMonth = (d: string) => String(d).slice(0, 7) === month
  const goalsPct = goals.length
    ? Math.round(goals.reduce((a, g) => a + g.current / (g.target || 1), 0) / goals.length * 100)
    : 0
  res.json({
    totals: {
      journal: posts.filter((p) => p.status === 'published').length,
      posts: posts.length,
      note: notes.length,
      plan: plans.length,
      checkin: checkins.length,
      ledger: ledgers.length,
      goal: goals.length,
      worktask: worktasks.length,
    },
    chars: posts.reduce((a, p) => a + (p.charCount || 0), 0),
    plan: { total: plans.length, done: plans.filter((p) => p.done).length },
    worktask: { total: worktasks.length, done: worktasks.filter((w) => w.done).length },
    checkin: { total: checkins.length, today: todayCheckins, checkedDays, maxStreak },
    goal: { total: goals.length, pct: goalsPct },
    ledger: {
      total: ledgers.length,
      income: sum(ledgers, 'income'),
      expense: sum(ledgers, 'expense'),
      monthIncome: sum(ledgers, 'income', inMonth),
      monthExpense: sum(ledgers, 'expense', inMonth),
    },
    posts: { total: posts.length, published: posts.filter((p) => p.status === 'published').length },
    asOf: new Date().toISOString(),
  })
}))

/** ============ 前端客户端日志上报（时间长河/节点宇宙异常与错误统一落盘排查） ============ */

workbench.post('/client-log', ah(async (req, res) => {
  const b = (req.body ?? {}) as { level?: unknown; src?: unknown; message?: unknown; extra?: unknown }
  const level = String(b.level ?? 'info')
  if (!CLIENT_LOG_LEVELS.has(level)) return err(res, 422, 'VALIDATION', 'level 非法')
  const src = String(b.src ?? 'client').slice(0, 60)
  const message = String(b.message ?? '').slice(0, 2000)
  const extra = b.extra && typeof b.extra === 'object' ? (b.extra as Record<string, unknown>) : undefined
  log(level as LogLevel, src, message || '(空)', extra)
  res.json({ ok: true })
}))

/** ============ 服务器实时状态（节点宇宙左下角 CPU/内存/网络监控） ============ */

interface NetSample { rx: number; tx: number }
interface StatusSnapshot {
  cpu: number
  mem: { used: number; total: number; percent: number }
  net: { up: number; down: number } | null
}

/** CPU 采样：tick 计数差值 / 总差值（两次采样间隔 sleep 保证分辨率） */
function sysCpuSample(): { idle: number; total: number } {
  let idle = 0, total = 0
  for (const c of os.cpus()) {
    idle += c.times.idle
    for (const t of Object.values(c.times)) total += t
  }
  return { idle, total }
}

/** 网络字节计数（Linux /proc/net/dev；非 Linux 返回 null） */
function sysNetBytes(): NetSample | null {
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf-8')
    let rx = 0, tx = 0
    for (const line of raw.split('\n').slice(2)) {
      // 每行格式: iface: rx_bytes rx_packets ... tx_bytes ...（rx 第1个数字，tx 第9个数字）
      const m = line.match(/:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/)
      if (!m) continue
      rx += Number(m[1]); tx += Number(m[2])
    }
    return { rx, tx }
  } catch {
    return null
  }
}

/** 状态采样缓存：TTL 1.1s，避免多前端轮询时重复做耗时采样 */
let statusCache: { data: StatusSnapshot; t: number } | null = null

async function sampleSnapshot(): Promise<StatusSnapshot> {
  const now = Date.now()
  if (statusCache && now - statusCache.t < 1100) return statusCache.data

  const aCpu = sysCpuSample()
  const aNet = sysNetBytes()
  await new Promise((r) => setTimeout(r, 120))
  const bCpu = sysCpuSample()
  const bNet = sysNetBytes()

  const cpuIdle = bCpu.idle - aCpu.idle
  const cpuTotal = bCpu.total - aCpu.total
  const mem = os.totalmem() - os.freemem()

  let net: { up: number; down: number } | null = null
  if (aNet && bNet && bNet.tx >= aNet.tx && bNet.rx >= aNet.rx) {
    const dt = 0.12 // 采样间隔秒
    net = { up: (bNet.rx - aNet.rx) / dt / 1024, down: (bNet.tx - aNet.tx) / dt / 1024 } // KB/s
  }

  const data: StatusSnapshot = {
    cpu: cpuTotal > 0 ? Math.min(100, Math.max(0, ((cpuTotal - cpuIdle) / cpuTotal) * 100)) : 0,
    mem: { used: mem, total: os.totalmem(), percent: Math.round((mem / os.totalmem()) * 100) },
    net,
  }
  statusCache = { data, t: Date.now() }
  return data
}

// 定时清理状态缓存（避免常驻，但上限就一个条目，仅防极端场景）
setInterval(() => { statusCache = null }, 60_000).unref?.()

// GET /server-status —— 服务器实时状态（须在 /:scope 通配之前声明）
workbench.get('/server-status', ah(async (_req, res) => {
  const snap = await sampleSnapshot()
  res.json({
    cpu: Math.round(snap.cpu * 10) / 10,
    mem: { used: snap.mem.used, total: snap.mem.total, percent: snap.mem.percent },
    net: snap.net ? { up: Math.round(snap.net.up), down: Math.round(snap.net.down) } : null,
    ts: Date.now(),
  })
}))

/** ============ 双视图时间轴聚合（按天混排：文章/笔记/计划/习惯/记账/目标） ============ */

type TNodeType = 'journal' | 'note' | 'plan' | 'checkin' | 'ledger' | 'goal'
interface TNode { id: string; t: TNodeType; title: string; sub: string; date: string; xp?: number; gold?: number; tags?: string[]; ts?: string }
interface TDay { date: string; xp: number; gold: number; items: TNode[] }

const ymd = (d?: string | Date | null): string => {
  if (!d) return ''
  // 本地时区取日期（个人工具单机部署）：避免 UTC 导致东八区 0-8 点的数据记到昨天
  return d instanceof Date ? ymdLocal(d) : String(d).slice(0, 10)
}
function safeJson(s: string): string[] {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** 时间轴聚合数据构建（workbench /timeline 与访客 /guest/timeline 共用）。
 *  from/to 仅在都传入时生效（自定义范围），否则按 limit 截取最近 N 天。 */
export async function timelineData(opts: { limit?: number; from?: string; to?: string }): Promise<{ days: TDay[]; range?: { from: string; to: string } }> {
  const limit = Math.min(90, Math.max(5, Number(opts.limit) || 30))
  const fromRaw = String(opts.from ?? '').trim()
  const toRaw = String(opts.to ?? '').trim()
  const hasRange = !!(fromRaw && toRaw)
  // 文章是唯一含大字段（rawMarkdown 镜像）的表：按窗口过滤 + 投影列，
  // 正文改用 charCount，不再把整篇镜像拉进内存
  const since = hasRange ? new Date(fromRaw + 'T00:00:00') : new Date(Date.now() - 90 * 864e5)
  const [posts, plans, checkins, ledgers, goals, notes, worktasks] = await Promise.all([
    prisma.post.findMany({
      where: { OR: [{ publishedAt: { gte: since } }, { updatedAt: { gte: since } }] },
      select: {
        id: true, slug: true, title: true, status: true, summary: true, charCount: true,
        publishedAt: true, updatedAt: true, createdAt: true,
        tags: { include: { tag: true } },
      },
    }),
    prisma.planItem.findMany(),
    prisma.checkinItem.findMany(),
    prisma.ledgerEntry.findMany(),
    prisma.goalItem.findMany(),
    prisma.noteItem.findMany(),
    prisma.workTask.findMany(),
  ])

  const dayMap = new Map<string, TDay>()
  const push = (date: string, node: TNode) => {
    const k = ymd(date)
    if (!k) return
    let day = dayMap.get(k)
    if (!day) { day = { date: k, xp: 0, gold: 0, items: [] }; dayMap.set(k, day) }
    day.xp += node.xp || 0
    day.gold += node.gold || 0
    day.items.push(node)
  }

  // 文章 → 日志（发布会徽章，草稿弱化）
  for (const p of posts) {
    const published = p.status === 'published'
    const date = published ? p.publishedAt || p.updatedAt : p.updatedAt || p.createdAt
    const chars = p.charCount || 0
    push(ymd(date), {
      id: 'post:' + p.id, t: 'journal',
      title: published ? p.title : `${p.title}（草稿）`,
      sub: `${published ? '发布' : '草稿'} · ${chars} 字${p.summary ? ' · ' + p.summary.slice(0, 60) : ''}`,
      date: ymd(date), xp: postDrop(published),
      tags: p.tags.map(x => x.tag.name).slice(0, 3),
      ts: date instanceof Date ? date.toISOString() : undefined,
    })
  }

// 灵感笔记 → 规范类型（type：inspiration|plan）决定节点类型；mood 为自由标签
for (const n of notes) {
  const isPlan = n.type === 'plan'
  push(n.date || ymd(n.createdAt), {
    id: 'note:' + n.id,
    t: isPlan ? 'plan' : 'note',
    title: (n.done ? '✅ ' : '') + (n.title || '（无标题）'),
    sub: n.body ? n.body.slice(0, 120) : (n.type === 'plan' ? '计划' : '灵感'),
    date: ymd(n.date), xp: 10,
    tags: [...(isPlan ? ['速记'] : []), ...(n.mood || '').trim() ? [(n.mood || '').trim()] : []],
    ts: n.createdAt ? n.createdAt.toISOString() : undefined,
  })
}

  // 今日计划 → 仅完成的条目进入时间轴（挂到完成日；XP/金币与讨伐掉落同口径）
  for (const p of plans) {
    if (!p.done) continue
    const date = ymd(p.doneAt) || ymd(p.updatedAt) || ymd(p.createdAt)
    const drop = planDrop(p.id, p.level)
    push(date, {
      id: 'plan:' + p.id, t: 'plan',
      title: `完成计划 ${p.level} · ${p.text}`,
      sub: p.note || `优先级 ${p.level}`,
      date, xp: drop.xp, gold: drop.gold,
      ts: p.updatedAt ? p.updatedAt.toISOString() : undefined,
    })
  }

  // 习惯打卡 → 展开逐日 log（{"YYYY-MM-DD": true}）
  for (const c of checkins) {
    let log: Record<string, boolean> = {}
    try { log = JSON.parse(c.log || '{}') } catch { /* 忽略损坏 log */ }
    for (const [d, v] of Object.entries(log)) {
      if (v !== true) continue
      push(d, {
        id: 'checkin:' + c.id + ':' + d, t: 'checkin',
        title: `${c.emoji || '✨'} ${c.name}`, sub: `习惯打卡 · 当前连续 ${c.streak || 0} 天`,
        date: d, xp: 15,
      })
    }
  }

  // 记账本 → 支出折算金币（演示游戏化收益，不落库）
  for (const l of ledgers) {
    const isInc = l.kind === 'income'
    const sign = isInc ? '+' : '-'
    const gold = l.kind === 'expense' ? Math.max(1, Math.min(4, Math.round(Math.abs(l.amount) / 30))) : 0
    push(l.date, {
      id: 'ledger:' + l.id, t: 'ledger',
      title: l.note || `${l.cat} · 一笔${isInc ? '收入' : '支出'}`,
      sub: `${sign}¥${Math.abs(l.amount).toFixed(2)} · ${l.cat}`,
      date: ymd(l.date), gold,
      tags: [l.cat],
      ts: l.createdAt ? l.createdAt.toISOString() : undefined,
    })
  }

  // 工作计划 → 仅完成任务进入时间轴（挂完成日，tag「工作」与个人计划区分）
  for (const w of worktasks) {
    if (!w.done) continue
    const date = ymd(w.doneAt) || ymd(w.updatedAt) || ymd(w.date) || ymd(w.createdAt)
    push(date, {
      id: 'worktask:' + w.id, t: 'plan',
      title: `完成工作计划 · ${w.text}`,
      sub: w.note ? w.note.slice(0, 120) : '工作计划',
      date, xp: 10,
      tags: ['工作'],
      ts: w.updatedAt ? w.updatedAt.toISOString() : undefined,
    })
  }

  // 长期目标 → 仅在关联计划完成 / 关联习惯打卡当天出现（"进度 +1"）
  const planById = new Map(plans.map(p => [p.id, p]))
  const checkinById = new Map(checkins.map(c => [c.id, c]))
  for (const g of goals) {
    const seen = new Set<string>()
    const pushGoal = (d: string) => {
      if (seen.has(d)) return
      seen.add(d)
      const pct = Math.round((g.current / (g.target || 1)) * 100)
      push(d, {
        id: 'goal:' + g.id + ':' + d, t: 'goal',
        title: `${g.emoji || '🎯'} 目标「${g.name}」进度 +1`,
        sub: `${g.current} / ${g.target}${g.unit ? ' ' + g.unit : ''} · ${pct}%`,
        date: d, xp: 20,
      })
    }
    for (const pid of safeJson(g.relatedPlanIds)) {
      const pl = planById.get(pid)
      if (pl && pl.done) pushGoal(ymd(pl.doneAt) || ymd(pl.updatedAt))
    }
    for (const cid of safeJson(g.relatedCheckinIds)) {
      const ck = checkinById.get(cid)
      if (!ck) continue
      try {
        const log = JSON.parse(ck.log || '{}') as Record<string, boolean>
        for (const [d, v] of Object.entries(log)) if (v === true) pushGoal(d)
      } catch { /* 忽略 */ }
    }
  }

  const allDays = [...dayMap.values()]
    .map(d => ({ ...d, items: d.items.sort((a, b) => (b.ts || b.date).localeCompare(a.ts || a.date)) }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((d) => (hasRange ? d.date >= fromRaw && d.date <= toRaw : true))
  const days = hasRange ? allDays : allDays.slice(0, limit)

  return { days, range: hasRange ? { from: fromRaw, to: toRaw } : undefined }
}

// GET /timeline —— 首屏双视图数据源
// 两种用法：
//   ?limit=N            最近 N 天（默认 30，上限 90）
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD   自定义时间范围（与 limit 互斥优先；范围上限 366 天）
workbench.get('/timeline', ah(async (req, res) => {
  const q = req.query as Record<string, string | undefined>
  const fromRaw = String(q.from ?? '').trim()
  const toRaw = String(q.to ?? '').trim()
  const hasRange = !!(fromRaw && toRaw)
  if (hasRange) {
    const re = /^\d{4}-\d{2}-\d{2}$/
    if (!re.test(fromRaw) || !re.test(toRaw)) {
      return err(res, 422, 'VALIDATION', 'from/to 格式须为 YYYY-MM-DD')
    }
    if (fromRaw > toRaw) {
      return err(res, 422, 'VALIDATION', 'from 不能晚于 to')
    }
    // 防滥用：范围跨度上限 366 天
    const span = (new Date(toRaw + 'T00:00:00').getTime() - new Date(fromRaw + 'T00:00:00').getTime()) / 864e5
    if (span > 366) {
      return err(res, 422, 'VALIDATION', '时间范围最多 366 天')
    }
  }
  const data = await timelineData({ limit: Number((req.query as any).limit) || 30, from: fromRaw, to: hasRange ? toRaw : undefined })
  res.json(data)
}))

/** 白名单字段：每种模型的允许更新键 */
const FIELDS: Record<string, string[]> = {
  plan: ['text', 'level', 'note', 'done', 'dueDate', 'doneAt', 'order'],
  checkin: ['name', 'emoji', 'desc', 'log', 'streak'],
  ledger: ['kind', 'cat', 'amount', 'note', 'date'],
  goals: ['name', 'emoji', 'desc', 'current', 'target', 'unit', 'relatedPlanIds', 'relatedCheckinIds'],
  notes: ['title', 'body', 'type', 'mood', 'date', 'done', 'doneAt'],
  worktask: ['date', 'text', 'note', 'done', 'doneAt', 'order'],
}

const MODEL: Record<string, string> = {
  plan: 'planItem',
  checkin: 'checkinItem',
  ledger: 'ledgerEntry',
  goals: 'goalItem',
  notes: 'noteItem',
  worktask: 'workTask',
}


/** 各 scope 写路径的字段类型校验（白名单之外的类型错误 → 422 而非 DB 500）。
 *  长度上限仅做防滥用兜底（远超正常使用），前端不再设 maxLength 硬限制。 */
const WB_SCHEMA: Record<string, Record<string, FieldSpec>> = {
  plan: {
    text: { ...v.str(), min: 1, max: 2000 },
    level: { ...v.str(), oneOf: ['P0', 'P1', 'P2'] },
    note: { ...v.str(), max: 100_000 },
    done: v.bool(),
    dueDate: v.str(),
    doneAt: v.str(),
    order: v.num(),
  },
  checkin: { name: { ...v.str(), min: 1, max: 200 }, emoji: { ...v.str(), max: 16 }, desc: { ...v.str(), max: 100_000 }, log: v.str(), streak: v.num() },
  ledger: {
    kind: { ...v.str(), oneOf: ['income', 'expense'] },
    cat: { ...v.str(), max: 50 },
    // 创建时必填由 POST 独立校验（amount 必填），更新允许部分字段
    amount: v.num(),
    note: { ...v.str(), max: 2000 },
    date: v.str(),
  },
  goals: {
    name: { ...v.str(), min: 1, max: 500 },
    emoji: { ...v.str(), max: 16 },
    desc: { ...v.str(), max: 100_000 },
    current: v.num(),
    target: v.num(),
    unit: { ...v.str(), max: 20 },
    relatedPlanIds: v.str(),
    relatedCheckinIds: v.str(),
  },
  notes: {
    title: { ...v.str(), max: 500 },
    body: { ...v.str(), max: 100_000 },
    type: { ...v.str(), oneOf: ['inspiration', 'plan'] },
    mood: { ...v.str(), max: 100 },
    date: v.str(),
    done: v.bool(),
    doneAt: v.str(),
  },
  worktask: {
    date: v.str(),
    text: { ...v.str(), min: 1, max: 2000 },
    note: { ...v.str(), max: 100_000 },
    done: v.bool(),
    doneAt: v.str(),
    order: v.num(),
  },
}

function sanitizeObj(scope: string, body: Record<string, unknown>): Record<string, unknown> {
  const allowed = FIELDS[scope] || []
  const out: Record<string, unknown> = {}
  for (const k of allowed) if (body[k] !== undefined) out[k] = body[k]
  return out
}

// GET /:scope —— 列表（leader 自然序；plan 按完成态排后）
workbench.get('/:scope', ah(async (req, res) => {
  const scope = req.params.scope
  if (!MODEL[scope]) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  const orderBy: Record<string, string> =
    scope === 'plan' ? { done: 'asc' }
      : scope === 'worktask' ? { date: 'asc' }
      : { createdAt: 'asc' }
  const items = await (prisma as any)[MODEL[scope]].findMany({ orderBy })
  res.json({ items })
}))

// GET /:scope/summary —— 总览统计（首页用）
workbench.get('/:scope/summary', ah(async (req, res) => {
  const scope = req.params.scope
  const model = (prisma as any)[MODEL[scope]]
  if (!model) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  const wb: Record<string, unknown> = {}
  if (scope === 'plan') {
    const all = await model.findMany()
    wb.total = all.length
    wb.done = all.filter((x: { done: boolean }) => x.done).length
  } else if (scope === 'checkin') {
    const all = await model.findMany()
    const t = ymdLocal(new Date())
    wb.total = all.length
    wb.todayDone = all.filter((x: { log: string }) => {
      try { return JSON.parse(x.log || '{}')[t] === true } catch { return false }
    }).length
    wb.maxStreak = Math.max(0, ...all.map((x: { streak: number }) => x.streak || 0))
  } else if (scope === 'ledger') {
    const all = await model.findMany()
    const month = ymdLocal(new Date()).slice(0, 7)
    const mRows = all.filter((x: { date: string }) => String(x.date).slice(0, 7) === month)
    wb.income = mRows.filter((x: { kind: string }) => x.kind === 'income').reduce((a: number, b: { amount: number }) => a + b.amount, 0)
    wb.expense = mRows.filter((x: { kind: string }) => x.kind === 'expense').reduce((a: number, b: { amount: number }) => a + b.amount, 0)
    wb.total = all.length
  } else if (scope === 'goals') {
    const all = await model.findMany()
    wb.total = all.length
    wb.pct = all.length
      ? Math.round(all.reduce((a: number, b: { current: number; target: number }) => a + b.current / (b.target || 1), 0) / all.length * 100)
      : 0
  } else if (scope === 'notes') {
    wb.total = await model.count()
  }
  res.json(wb)
}))

// POST /:scope —— 新建（白名单字段 + 类型校验；ledger/notes 缺省日期兜底为今天，避免必填列 500）
workbench.post('/:scope', ah(async (req, res) => {
  const scope = req.params.scope
  if (!MODEL[scope]) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  const body = validateBody<Record<string, unknown>>(req, res, WB_SCHEMA[scope])
  if (!body) return
  // 创建时必填校验（缺关键列 → 422，而非 DB 约束 500）
  const requiredAtCreate: Record<string, string> = {
    plan: 'text', checkin: 'name', ledger: 'kind', notes: 'title', goals: 'name', worktask: 'text',
  }
  const need = requiredAtCreate[scope]
  if (need && (body[need] === undefined || body[need] === '')) {
    return err(res, 422, 'VALIDATION', `缺少必填字段: ${need}`)
  }
  if (scope === 'ledger' && (body.amount === undefined || body.amount === null)) {
    return err(res, 422, 'VALIDATION', '缺少必填字段: amount')
  }
  if (scope === 'worktask' && (body.date === undefined || body.date === '')) {
    return err(res, 422, 'VALIDATION', '缺少必填字段: date')
  }
  const clean = sanitizeObj(scope, body)
  if ((scope === 'ledger' || scope === 'notes') && !clean.date) clean.date = ymdLocal(new Date())
  const created = await (prisma as any)[MODEL[scope]].create({ data: clean })
  res.json({ ok: true, item: created })
}))

// PUT /:scope/:id —— 更新（白名单字段 + 类型校验；缺省字段视为不更新）
workbench.put('/:scope/:id', ah(async (req, res) => {
  const scope = req.params.scope
  if (!MODEL[scope]) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  const body = validateBody<Record<string, unknown>>(req, res, WB_SCHEMA[scope])
  if (!body) return
  const clean = sanitizeObj(scope, body)
  try {
    const updated = await (prisma as any)[MODEL[scope]].update({
      where: { id: req.params.id },
      data: clean,
    })
    res.json({ ok: true, item: updated })
  } catch {
    return err(res, 404, 'NOT_FOUND', '记录不存在')
  }
}))

// DELETE /:scope/:id —— 删除
workbench.delete('/:scope/:id', ah(async (req, res) => {
  const scope = req.params.scope
  if (!MODEL[scope]) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  try {
    await (prisma as any)[MODEL[scope]].delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch {
    return err(res, 404, 'NOT_FOUND', '记录不存在')
  }
}))