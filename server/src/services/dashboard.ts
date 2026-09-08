/**
 * 工作台聚合统计服务：本周进度（总览右栏卡片）与数据核心/数字城市仪表盘（真实数据，不虚构）。
 * 聚合口径与/guest、/timeline 保持一致（本地时区取日期）。
 */
import { prisma } from '../prisma'
import { ymdLocal } from '../util-date'

/** 本周（周一~周日）进度聚合：总览右栏卡片（workbench /week-stats） */
export async function weekStats(): Promise<{
  week: { start: string; end: string; daysElapsed: number; daysRemain: number }
  checks: { days: number; total: 7; maxStreak: number }
  posts: { days: number; total: 7 }
  ledger: { days: number; total: 7 }
  plans: { done: number; total: number }
  avg: number
}> {
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

  return {
    week: { start: w0, end: w1, daysElapsed: diff + 1, daysRemain: 7 - (diff + 1) },
    checks: { days: checkDays.size, total: 7, maxStreak },
    posts: { days: Math.min(postDays.size, 7), total: 7 },
    ledger: { days: ledgerDays.size, total: 7 },
    plans: { done: plansDone, total: plansTotal },
    avg,
  }
}

/** 数据核心 / 数字城市聚合统计（workbench /dashboard）：真实数据，不虚构 */
export async function dashboardStats(): Promise<{
  totals: Record<string, number>
  chars: number
  plan: { total: number; done: number }
  worktask: { total: number; done: number }
  checkin: { total: number; today: number; checkedDays: number; maxStreak: number }
  goal: { total: number; pct: number }
  ledger: { total: number; income: number; expense: number; monthIncome: number; monthExpense: number }
  posts: { total: number; published: number }
  asOf: string
}> {
  const today = ymdLocal(new Date())
  const month = today.slice(0, 7)
  const [posts, plans, checkins, ledgers, goals, notes, worktasks, focusLogs] = await Promise.all([
    prisma.post.findMany({ select: { id: true, status: true, charCount: true } }),
    prisma.planItem.findMany(),
    prisma.checkinItem.findMany(),
    prisma.ledgerEntry.findMany(),
    prisma.goalItem.findMany(),
    prisma.noteItem.findMany(),
    prisma.workTask.findMany(),
    prisma.focusLog.findMany(),
  ])
  // 习惯：逐日打卡总量 + 今日打卡 + 最大连续
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
  return {
    totals: {
      journal: posts.filter((p) => p.status === 'published').length,
      posts: posts.length,
      note: notes.length,
      plan: plans.length,
      checkin: checkins.length,
      ledger: ledgers.length,
      goal: goals.length,
      worktask: worktasks.length,
      focus: focusLogs.length,
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
  }
}