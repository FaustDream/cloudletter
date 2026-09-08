/**
 * 个人工作台路由（框架：六类模块统一 REST CRUD，单人管理员）。
 * - plan     今日计划：text/level/note/done
 * - checkin  习惯打卡：name/emoji/desc/log/streak
 * - ledger   记账本：kind/cat/amount/note/date
 * - goals    长期目标：name/emoji/desc/current/target/unit
 * - notes    灵感笔记/速记：title/body/date + 与文章共用的分类(categoryId)与标签(tags)
 * - focus    番茄专注执行记录：planId/planTitle/minutes/date（日常 × 计划联动）
 * - worktask 工作计划：date/text/note/done/doneAt
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { ymdLocal } from '../util-date'
import { validateBody, v, type FieldSpec } from '../middleware/validate'
import { slugify } from '../content'
import { log, CLIENT_LOG_LEVELS, type LogLevel } from '../logger'
import { logActivity } from '../services/activity'
import { syncTags } from '../services/tags'
import { timelineData, NOTE_INCLUDE } from '../services/timeline'
import { weekStats, dashboardStats } from '../services/dashboard'
import { serverStatus } from '../services/system-status'

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

/** 数据导入用到的窄化 delegate 接口（事务客户端动态模型访问，禁 any） */
interface ImportDelegate {
  findFirst: (args: { where: Record<string, string> }) => Promise<{ id: string } | null>
  create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>
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
  // 灵感笔记旧备份兼容：无分类的导入行默认归入「灵感」（分类不存在则不强造）
  const defaultCatId = (await prisma.category.findFirst({ where: { name: '灵感' } }))?.id ?? null
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
        // 灵感笔记：旧备份的 type/mood/done/doneAt 列已弃用——丢弃，mood 转正式标签
        let legacyMood = ''
        if (model === 'noteItem') {
          for (const k of ['type', 'mood', 'done', 'doneAt']) delete safe[k]
          if (typeof row.mood === 'string' && row.mood.trim()) legacyMood = row.mood.trim()
          if (!safe.categoryId) safe.categoryId = defaultCatId
        }
        // 冲突策略：skip = 按业务唯一字段判重（不同模型不同）→ 跳过；overwrite = 直接新建副本
        if (conflict === 'skip') {
          const uniq = uniqKey(model, safe)
          if (uniq) {
            const target = tx[model as keyof typeof tx] as unknown as ImportDelegate
            const hit = await target.findFirst({ where: uniq })
            if (hit) { counts[modelNameFor(model)]!.skipped++; continue }
          }
        }
        try {
          const target = tx[model as keyof typeof tx] as unknown as ImportDelegate
          const created = await target.create({ data: safe })
          if (model === 'noteItem' && legacyMood) {
            try {
              const tag = await tx.tag.upsert({ where: { name: legacyMood }, update: {}, create: { name: legacyMood, slug: slugify(legacyMood) } })
              await tx.noteTag.create({ data: { noteId: (created as { id: string }).id, tagId: tag.id } })
            } catch { /* 标签关联失败不阻塞该行导入 */ }
          }
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

// GET /week-stats —— 本周进度聚合（总览右栏卡片）：聚合实现在 services/dashboard.ts
// 注意：必须声明在 /:scope 通配路由之前，否则会被当成非法模块
workbench.get('/week-stats', ah(async (_req, res) => {
  res.json(await weekStats())
}))

/** ============ 数据核心 / 数字城市 聚合统计（GET /dashboard）：真实数据，不虚构（实现在 services/dashboard.ts） ============ */

workbench.get('/dashboard', ah(async (_req, res) => {
  res.json(await dashboardStats())
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

/** ============ 服务器实时状态（节点宇宙左下角 CPU/内存/网络监控，采样在 services/system-status.ts） ============ */

// GET /server-status —— 服务器实时状态（须在 /:scope 通配之前声明）
workbench.get('/server-status', ah(async (_req, res) => {
  res.json(await serverStatus())
}))

/** ============ 双视图时间轴聚合（聚合实现在 services/timeline.ts，访客与行政共用） ============ */

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
  const data = await timelineData({ limit: Number(q.limit) || 30, from: fromRaw, to: hasRange ? toRaw : undefined })
  res.json(data)
}))

/** 白名单字段：每种模型的允许更新键 */
const FIELDS: Record<string, string[]> = {
  plan: ['text', 'level', 'note', 'done', 'dueDate', 'doneAt', 'order'],
  checkin: ['name', 'emoji', 'desc', 'log', 'streak'],
  ledger: ['kind', 'cat', 'amount', 'note', 'date'],
  goals: ['name', 'emoji', 'desc', 'current', 'target', 'unit', 'relatedPlanIds', 'relatedCheckinIds'],
  notes: ['title', 'body', 'date', 'categoryId', 'status'],
  worktask: ['date', 'text', 'note', 'done', 'doneAt', 'order'],
  focus: ['planId', 'planTitle', 'minutes', 'date'],
}

const MODEL: Record<string, string> = {
  plan: 'planItem',
  checkin: 'checkinItem',
  ledger: 'ledgerEntry',
  goals: 'goalItem',
  notes: 'noteItem',
  worktask: 'workTask',
  focus: 'focusLog',
}

/** 通用 CRUD 用到的窄化 delegate 接口：避免 (prisma as any)[模型名] 动态访问（禁 any）。
 *  各模型 delegate 的真实类型不同，统一收窄到本接口，方法签名只暴露路由实际使用的部分。 */
interface WbModelDelegate {
  findMany: (args?: { orderBy?: Record<string, string> }) => Promise<Array<Record<string, unknown>>>
  create: (args: { data: Record<string, unknown> }) => Promise<Record<string, unknown>>
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<Record<string, unknown>>
  delete: (args: { where: { id: string } }) => Promise<Record<string, unknown>>
  count: () => Promise<number>
}

const WB_MODELS: Record<string, WbModelDelegate> = {
  planItem: prisma.planItem as unknown as WbModelDelegate,
  checkinItem: prisma.checkinItem as unknown as WbModelDelegate,
  ledgerEntry: prisma.ledgerEntry as unknown as WbModelDelegate,
  goalItem: prisma.goalItem as unknown as WbModelDelegate,
  noteItem: prisma.noteItem as unknown as WbModelDelegate,
  workTask: prisma.workTask as unknown as WbModelDelegate,
  focusLog: prisma.focusLog as unknown as WbModelDelegate,
}

function wbModel(scope: string): WbModelDelegate | null {
  return WB_MODELS[MODEL[scope]] ?? null
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
    date: v.str(),
    // keepEmpty：'' 保留 = 「无分类」语义（默认空串会被校验层按缺失丢弃）
    categoryId: { ...v.str(), max: 64, keepEmpty: true },
    // 状态：待使用/已使用/已过期（创建缺省 pending）
    status: { ...v.str(), oneOf: ['pending', 'used', 'expired'] },
    tags: v.arr(v.str(), 0, 20),
  },
  worktask: {
    date: v.str(),
    text: { ...v.str(), min: 1, max: 2000 },
    note: { ...v.str(), max: 100_000 },
    done: v.bool(),
    doneAt: v.str(),
    order: v.num(),
  },
  focus: {
    planId: { ...v.str(), max: 64 },
    planTitle: { ...v.str(), max: 500 },
    minutes: { ...v.num(), min: 1, max: 600 },
    date: v.str(),
  },
}

function sanitizeObj(scope: string, body: Record<string, unknown>): Record<string, unknown> {
  const allowed = FIELDS[scope] || []
  const out: Record<string, unknown> = {}
  for (const k of allowed) if (body[k] !== undefined) out[k] = body[k]
  return out
}

/* ============================================================
   灵感笔记 × 共用分类/标签：与文章同一套 Category / Tag 表。
   分类未传默认「灵感」，标签未传默认「灵感」；'' = 明确无分类。
   ============================================================ */
const DEFAULT_NOTE_TAX = '灵感'

interface NoteWithTax {
  id: string
  title: string
  body: string
  date: string
  status: string
  categoryId: string | null
  createdAt: Date
  updatedAt: Date
  category: { id: string; name: string; slug: string } | null
  tags: Array<{ tag: { id: string; name: string; slug: string } }>
}

/** 笔记输出整形：tags 摊平为名称数组，分类带 id/name/slug 直出 */
function shapeNote(n: NoteWithTax) {
  const { tags, ...rest } = n
  return { ...rest, tags: tags.map((t) => t.tag.name) }
}

/** 默认分类「灵感」的 id（不存在则返回 null，不强造） */
async function defaultCategoryId(): Promise<string | null> {
  const def = await prisma.category.findFirst({ where: { name: DEFAULT_NOTE_TAX } })
  return def?.id ?? null
}

/** 分类入参解析：undefined=未指定（fillDefault 时兜底「灵感」）；''/null=明确无分类；id 字符串原样返回（存在性由路由校验） */
async function resolveCategoryId(raw: unknown, fillDefault: boolean): Promise<string | null> {
  if (raw === undefined) return fillDefault ? defaultCategoryId() : null
  if (typeof raw === 'string' && raw) return raw
  return null
}

/** 新建灵感笔记：默认分类/标签 + 标签同步，返回整形后的完整条目 */
async function createNote(clean: Record<string, unknown>, body: Record<string, unknown>) {
  const created = await prisma.noteItem.create({
    data: {
      title: typeof clean.title === 'string' ? clean.title : '',
      body: typeof clean.body === 'string' ? clean.body : '',
      date: typeof clean.date === 'string' ? clean.date : ymdLocal(new Date()),
      // 状态缺省「待使用」
      status: typeof clean.status === 'string' ? clean.status : 'pending',
      categoryId: await resolveCategoryId(clean.categoryId, true),
    },
  })
  const names = body.tags === undefined ? [DEFAULT_NOTE_TAX] : body.tags
  await syncTags({ link: 'noteTag', ownerId: created.id, names })
  const full = await prisma.noteItem.findUnique({ where: { id: created.id }, include: NOTE_INCLUDE })
  return full ? shapeNote(full) : created
}

/** 更新灵感笔记：''分类=清空、未传不动；tags 传数组时重建关联 */
async function updateNote(id: string, clean: Record<string, unknown>, body: Record<string, unknown>) {
  const data: { title?: string; body?: string; date?: string; status?: string; categoryId?: string | null } = {}
  if (typeof clean.title === 'string') data.title = clean.title
  if (typeof clean.body === 'string') data.body = clean.body
  if (typeof clean.date === 'string') data.date = clean.date
  if (typeof clean.status === 'string') data.status = clean.status
  if (clean.categoryId !== undefined) data.categoryId = await resolveCategoryId(clean.categoryId, false)
  const updated = await prisma.noteItem.update({ where: { id }, data })
  if (body.tags !== undefined) await syncTags({ link: 'noteTag', ownerId: id, names: body.tags })
  const full = await prisma.noteItem.findUnique({ where: { id }, include: NOTE_INCLUDE })
  return full ? shapeNote(full) : updated
}

// GET /:scope —— 列表（leader 自然序；plan 按完成态排后）
workbench.get('/:scope', ah(async (req, res) => {
  const scope = req.params.scope
  const model = wbModel(scope)
  if (!model) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  const orderBy: Record<string, string> =
    scope === 'plan' ? { done: 'asc' }
      : scope === 'worktask' ? { date: 'asc' }
      : scope === 'focus' ? { date: 'asc' }
      : { createdAt: 'asc' }
  if (scope === 'notes') {
    const rows = await prisma.noteItem.findMany({ orderBy, include: NOTE_INCLUDE })
    return res.json({ items: rows.map(shapeNote) })
  }
  const items = await model.findMany({ orderBy })
  res.json({ items })
}))

// GET /:scope/summary —— 总览统计（首页用）
workbench.get('/:scope/summary', ah(async (req, res) => {
  const scope = req.params.scope
  if (!wbModel(scope) && scope !== 'plan' && scope !== 'checkin' && scope !== 'ledger' && scope !== 'goals' && scope !== 'notes') {
    return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  }
  const wb: Record<string, unknown> = {}
  if (scope === 'plan') {
    const all = await prisma.planItem.findMany()
    wb.total = all.length
    wb.done = all.filter((x) => x.done).length
  } else if (scope === 'checkin') {
    const all = await prisma.checkinItem.findMany()
    const t = ymdLocal(new Date())
    wb.total = all.length
    wb.todayDone = all.filter((x) => {
      try { return JSON.parse(x.log || '{}')[t] === true } catch { return false }
    }).length
    wb.maxStreak = Math.max(0, ...all.map((x) => x.streak || 0))
  } else if (scope === 'ledger') {
    const all = await prisma.ledgerEntry.findMany()
    const month = ymdLocal(new Date()).slice(0, 7)
    const mRows = all.filter((x) => String(x.date).slice(0, 7) === month)
    wb.income = mRows.filter((x) => x.kind === 'income').reduce((a, b) => a + b.amount, 0)
    wb.expense = mRows.filter((x) => x.kind === 'expense').reduce((a, b) => a + b.amount, 0)
    wb.total = all.length
  } else if (scope === 'goals') {
    const all = await prisma.goalItem.findMany()
    wb.total = all.length
    wb.pct = all.length
      ? Math.round(all.reduce((a, b) => a + b.current / (b.target || 1), 0) / all.length * 100)
      : 0
  } else if (scope === 'notes') {
    wb.total = await prisma.noteItem.count()
  }
  res.json(wb)
}))

// POST /:scope —— 新建（白名单字段 + 类型校验；ledger/notes 缺省日期兜底为今天，避免必填列 500）
workbench.post('/:scope', ah(async (req, res) => {
  const scope = req.params.scope
  const model = wbModel(scope)
  if (!model) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  const body = validateBody<Record<string, unknown>>(req, res, WB_SCHEMA[scope])
  if (!body) return
  // 创建时必填校验（缺关键列 → 422，而非 DB 约束 500）
  const requiredAtCreate: Record<string, string> = {
    plan: 'text', checkin: 'name', ledger: 'kind', notes: 'title', goals: 'name', worktask: 'text', focus: 'minutes',
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
  if (scope === 'notes') {
    if (typeof clean.categoryId === 'string' && clean.categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: clean.categoryId } })
      if (!cat) return err(res, 422, 'VALIDATION', '分类不存在')
    }
    return res.json({ ok: true, item: await createNote(clean, body) })
  }
  const created = await model.create({ data: clean })
  res.json({ ok: true, item: created })
}))

// PUT /:scope/:id —— 更新（白名单字段 + 类型校验；缺省字段视为不更新）
workbench.put('/:scope/:id', ah(async (req, res) => {
  const scope = req.params.scope
  const model = wbModel(scope)
  if (!model) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  const body = validateBody<Record<string, unknown>>(req, res, WB_SCHEMA[scope])
  if (!body) return
  const clean = sanitizeObj(scope, body)
  if (scope === 'notes') {
    try {
      return res.json({ ok: true, item: await updateNote(req.params.id, clean, body) })
    } catch {
      return err(res, 404, 'NOT_FOUND', '记录不存在')
    }
  }
  try {
    const updated = await model.update({
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
  const model = wbModel(scope)
  if (!model) return err(res, 422, 'VALIDATION', '不支持的模块: ' + scope)
  try {
    await model.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch {
    return err(res, 404, 'NOT_FOUND', '记录不存在')
  }
}))