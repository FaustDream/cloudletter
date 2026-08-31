/**
 * 讨伐系统（游戏化 MVP）：
 * - 刷怪 = 把待办映射成怪物：未完成计划 → 怪物（P0=首领 / P1=精英怪 / P2=小怪），
 *   今日到期或逾期的影响者标记「危机」（crisis），置顶显示
 * - 打怪 = 完成任务：POST /battle/attack 真实落库 planItem.done/doneAt，不掉线、不双写，
 *   掉落 XP/金币与时间线口径完全一致（timeline 的 plan XP 同源）
 * - 战绩暂存于计划本身（done/doneAt）；后续扩展 BattleLog 表可做伤害数字与回放
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { ymdLocal } from '../util-date'
import { planDrop } from '../game'

export const battle = Router()
battle.use(requireAuth)

/** 怪物品级：由计划优先级映射（掉落走 planDrop 确定性随机，与时间线同口径） */
export const TIERS = {
  P0: { key: 'P0', label: '首领', emoji: '👹', hp: 3 },
  P1: { key: 'P1', label: '精英怪', emoji: '😈', hp: 2 },
  P2: { key: 'P2', label: '小怪', emoji: '🟢', hp: 1 },
} as const

export type TierKey = keyof typeof TIERS

export interface Monster {
  id: string
  name: string
  tier: TierKey
  tierLabel: string
  emoji: string
  hp: number
  /** 预告掉落（planDrop 确定性随机，击杀后与实际发放一致） */
  xp: number
  gold: number
  note: string
  dueDate: string
  /** 今日到期或已逾期：置顶 + 红标 */
  crisis: boolean
}

/** 把未完成计划映射成今日讨伐列表（独立导出，供单测覆盖映射规则） */
export function toMonsters(
  plans: Array<{ id: string; text: string; level: string; note: string; dueDate: string }>,
  today: string,
): Monster[] {
  const out: Monster[] = []
  for (const p of plans) {
    const tier: TierKey = p.level === 'P0' ? 'P0' : p.level === 'P1' ? 'P1' : 'P2'
    const t = TIERS[tier]
    const drop = planDrop(p.id, p.level)
    const due = (p.dueDate || '').slice(0, 10)
    out.push({
      id: p.id,
      name: p.text || '（未命名怪物）',
      tier,
      tierLabel: t.label,
      emoji: t.emoji,
      hp: t.hp,
      xp: drop.xp,
      gold: drop.gold,
      note: p.note || '',
      dueDate: due,
      crisis: !!due && due <= today,
    })
  }
  // 危机（今日到期/逾期）置顶，再按威胁度降序
  return out.sort((a, b) => (a.crisis === b.crisis ? b.hp - a.hp : a.crisis ? -1 : 1))
}

// GET /battle/today —— 今日讨伐列表（未完成计划 = 存活怪物）
battle.get('/today', ah(async (req, res) => {
  const plans = await prisma.planItem.findMany({
    where: { done: false },
    orderBy: [{ level: 'asc' }, { createdAt: 'asc' }],
  })
  const monsters = toMonsters(plans, ymdLocal(new Date()))
  res.json({
    date: ymdLocal(new Date()),
    monsters,
    alive: monsters.length,
    crisis: monsters.filter((m) => m.crisis).length,
  })
}))

// POST /battle/attack —— 攻击（= 完成对应任务，真实落库）
battle.post('/attack', ah(async (req, res) => {
  const planId = String((req.body ?? {}).planId ?? '')
  if (!planId) return err(res, 422, 'VALIDATION', 'planId 必填')
  const plan = await prisma.planItem.findUnique({ where: { id: planId } })
  if (!plan) return err(res, 404, 'NOT_FOUND', '怪物已消失（任务不存在）')
  // 条件更新原子落完成态：并发/双击重复攻击只有一次生效（避免 TOCTOU 双份掉落）
  const updated = await prisma.planItem.updateMany({
    where: { id: plan.id, done: false },
    data: { done: true, doneAt: new Date().toISOString() },
  })
  if (updated.count === 0) return err(res, 409, 'CONFLICT', '该怪物已被讨伐（任务已完成）')
  const tier: TierKey = plan.level === 'P0' ? 'P0' : plan.level === 'P1' ? 'P1' : 'P2'
  const t = TIERS[tier]
  const drop = planDrop(plan.id, plan.level)
  res.json({
    ok: true,
    slain: { name: plan.text, tier, emoji: t.emoji },
    drop,
  })
}))
