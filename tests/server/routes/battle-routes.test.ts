/**
 * 讨伐系统单测（最小功能）：
 * - toMonsters 纯映射：优先级 → 品级、掉落与 planDrop 同口径、危机置顶、空名兜底
 * - /battle/today 只列未完成；/battle/attack 真实落库完成 + 掉落一致；重复攻击 409
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { startTestApp, type TestApp } from '@server/test-utils'
import { planDrop } from '@server/game'
import type * as Battle from '@server/routes/battle'

vi.mock('@server/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    requireAuth: async (_req: any, _res: any, next: any): Promise<void> => {
      _req.user = { id: 't1', email: 't@test' }
      next()
    },
  }
})

let app: TestApp
let battle: typeof Battle

async function inject(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(app.base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

beforeAll(async () => {
  app = await startTestApp()
  battle = await import('@server/routes/battle')
})

afterAll(async () => {
  await app.close()
  await app.prisma.$disconnect()
})

describe('任务 → 怪物映射（toMonsters）', () => {
  const TODAY = '2026-08-30'
  const mk = (over: Partial<{ id: string; text: string; level: string; note: string; dueDate: string }>) => ({
    id: 'x', text: '任务', level: 'P2', note: '', dueDate: '', ...over,
  })

  it('P0/P1/P2 → 首领/精英怪/小怪，掉落与时间线同口径', () => {
    const ms = battle.toMonsters(
      [mk({ id: 'a', level: 'P0' }), mk({ id: 'b', level: 'P1' }), mk({ id: 'c', level: 'P2' })],
      TODAY,
    )
    expect(ms.map((m) => m.tier)).toEqual(['P0', 'P1', 'P2'])
    expect(ms.map((m) => m.hp)).toEqual([3, 2, 1])
    expect(ms.map((m) => m.xp)).toEqual([planDrop('a', 'P0').xp, planDrop('b', 'P1').xp, planDrop('c', 'P2').xp])
  })

  it('今日到期/逾期 → crisis 置顶；未来到期/无截止不标', () => {
    const ms = battle.toMonsters(
      [mk({ id: 'future', dueDate: '2026-09-15' }), mk({ id: 'none' }), mk({ id: 'overdue', dueDate: '2026-08-01' }), mk({ id: 'today', dueDate: TODAY })],
      TODAY,
    )
    expect(ms.slice(0, 2).map((m) => m.id).sort()).toEqual(['overdue', 'today'])
    expect(ms.every((m, i) => (i < 2 ? m.crisis : !m.crisis))).toBe(true)
  })

  it('空文本兜底「未命名怪物」；note 透传', () => {
    const ms = battle.toMonsters([mk({ text: '', note: '备注' })], TODAY)
    expect(ms[0].name).toBe('（未命名怪物）')
    expect(ms[0].note).toBe('备注')
  })
})

describe('/battle/today 与 /battle/attack', () => {
  it('今日列表只含未完成任务；攻击真实完成计划并按 planDrop 掉落', async () => {
    const created = await inject('POST', '/workbench/plan', { text: '讨伐目标', level: 'P0' })
    const planId = created.body.item.id

    const today = await inject('GET', '/battle/today')
    expect(today.status).toBe(200)
    expect(today.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today.body.monsters.some((m: any) => m.id === planId)).toBe(true)

    const atk = await inject('POST', '/battle/attack', { planId })
    expect(atk.status).toBe(200)
    expect(atk.body.drop).toEqual(planDrop(planId, 'P0'))
    expect(atk.body.slain.tier).toBe('P0')

    const plan = (await inject('GET', '/workbench/plan')).body.items.find((x: any) => x.id === planId)
    expect(plan.done).toBe(true)
    expect(plan.doneAt).toBeTruthy()
    expect(((await inject('GET', '/battle/today')).body.monsters).some((m: any) => m.id === planId)).toBe(false)
  })

  it('重复攻击 409；未知任务 404；缺 planId 422', async () => {
    const created = await inject('POST', '/workbench/plan', { text: '再讨伐', level: 'P1' })
    const planId = created.body.item.id
    expect((await inject('POST', '/battle/attack', { planId })).status).toBe(200)
    expect((await inject('POST', '/battle/attack', { planId })).status).toBe(409)
    expect((await inject('POST', '/battle/attack', { planId: 'nope' })).status).toBe(404)
    expect((await inject('POST', '/battle/attack', {})).status).toBe(422)
  })
})
