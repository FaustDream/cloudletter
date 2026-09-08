/**
 * 时间轴聚合服务：把各模块数据按天混排为双视图共用的时间线（文章/笔记/计划/习惯/记账/目标/专注）。
 * 行政版 /workbench/timeline 与访客 /guest/timeline 共用同一聚合口径。
 * 奖励只发给「完成态」（已发布文章/已完成计划），与讨伐掉落同源（game.ts）。
 */
import { prisma } from '../prisma'
import { ymdLocal } from '../util-date'
import { planDrop, postDrop } from '../game'

export type TNodeType = 'journal' | 'note' | 'plan' | 'checkin' | 'ledger' | 'goal' | 'focus'
export interface TNode {
  id: string
  t: TNodeType
  title: string
  sub: string
  date: string
  xp?: number
  gold?: number
  tags?: string[]
  ts?: string
}
export interface TDay { date: string; xp: number; gold: number; items: TNode[] }

/** 灵感笔记 × 共用分类/标签：与文章同一套 Category / Tag 表 */
export const NOTE_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
} as const

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
  const [posts, plans, checkins, ledgers, goals, notes, worktasks, focusLogs] = await Promise.all([
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
    prisma.noteItem.findMany({ include: NOTE_INCLUDE }),
    prisma.workTask.findMany(),
    prisma.focusLog.findMany(),
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

  // 灵感笔记 → 与文章共用标签体系（tags 为正式标签名）；计划类速记已并入今日计划
  // 状态标识：非「待使用」的笔记在预览前加前缀（如 已使用 · …）
  const NOTE_STATUS_LABEL: Record<string, string> = { used: '已使用', expired: '已过期' }
  for (const n of notes) {
    const mark = NOTE_STATUS_LABEL[n.status]
    const sub = mark ? `${mark} · ${n.body ? n.body.slice(0, 120) : n.title || '灵感'}` : n.body ? n.body.slice(0, 120) : '灵感'
    push(n.date || ymd(n.createdAt), {
      id: 'note:' + n.id,
      t: 'note',
      title: n.title || '（无标题）',
      sub,
      date: ymd(n.date), xp: 10,
      tags: n.tags.map((x) => x.tag.name),
      ts: n.createdAt ? n.createdAt.toISOString() : undefined,
    })
  }

  // 番茄专注执行记录（日常 × 计划联动）→ 时间轴「专注」节点（不发 XP/金币，非游戏化范畴）
  for (const f of focusLogs) {
    push(f.date || ymd(f.createdAt), {
      id: 'focus:' + f.id,
      t: 'focus',
      title: `🍅 专注 ${f.minutes} 分钟`,
      sub: f.planTitle ? `计划 · ${f.planTitle}` : '自由专注',
      date: ymd(f.date), xp: 0,
      tags: ['专注'],
      ts: f.createdAt ? f.createdAt.toISOString() : undefined,
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