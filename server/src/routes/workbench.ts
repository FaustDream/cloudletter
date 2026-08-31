/**
 * 个人工作台路由（框架：五类模块统一 REST CRUD，单人管理员）。
 * - plan   今日计划：text/level/note/done
 * - checkin 习惯打卡：name/emoji/log/streak
 * - ledger 记账本：kind/cat/amount/note/date
 * - goals  长期目标：name/emoji/current/target/unit
 * - notes  灵感笔记：title/body/mood/date
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { ymdLocal } from '../util-date'
import { planDrop, postDrop } from '../game'
import { validateBody, v, type FieldSpec } from '../middleware/validate'

export const workbench = Router()
workbench.use(requireAuth)

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

/** ============ 双视图时间轴聚合（按天混排：文章/笔记/计划/习惯/记账/目标） ============ */

type TNodeType = 'journal' | 'note' | 'plan' | 'checkin' | 'ledger' | 'goal'
/** 速记弹窗保存的灵感笔记，mood 字段暂存类型标签（日志/灵感/计划/习惯/记账/目标），聚合时映射回类型色 */
const TIMELINE_MOOD: Record<string, TNodeType> = {
  日志: 'journal', 灵感: 'note', 计划: 'plan', 习惯: 'checkin', 记账: 'ledger', 目标: 'goal',
}
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

// GET /timeline —— 首屏双视图数据源（默认最近 30 天，最多 90 天）
workbench.get('/timeline', ah(async (req, res) => {
  const limit = Math.min(90, Math.max(5, Number((req.query as any).limit) || 30))
  // 文章是唯一含大字段（rawMarkdown 镜像）的表：按 90 天窗口过滤 + 投影列，
  // 正文改用 charCount，不再把整篇镜像拉进内存
  const since = new Date(Date.now() - 90 * 864e5)
  const [posts, plans, checkins, ledgers, goals, notes] = await Promise.all([
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

  // 灵感笔记 → 按 mood 映射类型色（速记弹窗写入的即走这里）
  for (const n of notes) {
    push(n.date || ymd(n.createdAt), {
      id: 'note:' + n.id,
      t: TIMELINE_MOOD[(n.mood || '').trim()] || 'note',
      title: n.title || '（无标题）',
      sub: n.body ? n.body.slice(0, 120) : (n.mood || '灵感'),
      date: ymd(n.date), xp: 10,
      tags: (n.mood || '').trim() ? [(n.mood || '').trim()] : undefined,
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

  const days = [...dayMap.values()]
    .map(d => ({ ...d, items: d.items.sort((a, b) => (b.ts || b.date).localeCompare(a.ts || a.date)) }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)

  res.json({ days })
}))

/** 白名单字段：每种模型的允许更新键 */
const FIELDS: Record<string, string[]> = {
  plan: ['text', 'level', 'note', 'done', 'dueDate', 'doneAt', 'order'],
  checkin: ['name', 'emoji', 'log', 'streak'],
  ledger: ['kind', 'cat', 'amount', 'note', 'date'],
  goals: ['name', 'emoji', 'current', 'target', 'unit', 'relatedPlanIds', 'relatedCheckinIds'],
  notes: ['title', 'body', 'mood', 'date'],
}

const MODEL: Record<string, string> = {
  plan: 'planItem',
  checkin: 'checkinItem',
  ledger: 'ledgerEntry',
  goals: 'goalItem',
  notes: 'noteItem',
}

function m(req: { params: { scope?: string } }): 'planItem' | 'checkinItem' | 'ledgerEntry' | 'goalItem' | 'noteItem' {
  const scope = req.params.scope
  if (!scope || !MODEL[scope]) throw new Error('INVALID_SCOPE')
  return MODEL[scope] as 'planItem' | 'checkinItem' | 'ledgerEntry' | 'goalItem' | 'noteItem'
}

/** 各 scope 写路径的字段类型校验（白名单之外的类型错误 → 422 而非 DB 500） */
const WB_SCHEMA: Record<string, Record<string, FieldSpec>> = {
  plan: {
    text: { ...v.str(), min: 1, max: 500 },
    level: { ...v.str(), oneOf: ['P0', 'P1', 'P2'] },
    note: { ...v.str(), max: 2000 },
    done: v.bool(),
    dueDate: v.str(),
    doneAt: v.str(),
    order: v.num(),
  },
  checkin: { name: { ...v.str(), min: 1, max: 100 }, emoji: { ...v.str(), max: 16 }, log: v.str(), streak: v.num() },
  ledger: {
    kind: { ...v.str(), oneOf: ['income', 'expense'] },
    cat: { ...v.str(), max: 50 },
    // 创建时必填由 POST 独立校验（amount 必填），更新允许部分字段
    amount: v.num(),
    note: { ...v.str(), max: 500 },
    date: v.str(),
  },
  goals: {
    name: { ...v.str(), min: 1, max: 200 },
    emoji: { ...v.str(), max: 16 },
    current: v.num(),
    target: v.num(),
    unit: { ...v.str(), max: 20 },
    relatedPlanIds: v.str(),
    relatedCheckinIds: v.str(),
  },
  notes: { title: { ...v.str(), max: 200 }, body: { ...v.str(), max: 100_000 }, mood: { ...v.str(), max: 20 }, date: v.str() },
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
    scope === 'plan' ? { done: 'asc' } : { createdAt: 'asc' }
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
    plan: 'text', checkin: 'name', ledger: 'kind', notes: 'title', goals: 'name',
  }
  const need = requiredAtCreate[scope]
  if (need && (body[need] === undefined || body[need] === '')) {
    return err(res, 422, 'VALIDATION', `缺少必填字段: ${need}`)
  }
  if (scope === 'ledger' && (body.amount === undefined || body.amount === null)) {
    return err(res, 422, 'VALIDATION', '缺少必填字段: amount')
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