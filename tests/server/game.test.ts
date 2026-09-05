/**
 * 游戏化奖励口径单测（最小功能）：
 * - planDrop：确定性（同 id 恒定）、档位区间、未知等级兜底 P2
 * - postDrop：已发布 50 / 草稿 0
 */
import { describe, it, expect } from 'vitest'
import { planDrop, postDrop } from '@server/game'

describe('planDrop（计划完成掉落）', () => {
  it('同计划 id 结果恒定（时间线与讨伐两侧口径一致的前提）', () => {
    const a = planDrop('plan-001', 'P1')
    const b = planDrop('plan-001', 'P1')
    expect(a).toEqual(b)
  })

  it('各档位掉落落在区间内', () => {
    for (let i = 0; i < 30; i++) {
      const id = `seed-${i}`
      expect(planDrop(id, 'P0').xp).toBeGreaterThanOrEqual(35)
      expect(planDrop(id, 'P0').xp).toBeLessThanOrEqual(50)
      expect(planDrop(id, 'P0').gold).toBeGreaterThanOrEqual(6)
      expect(planDrop(id, 'P0').gold).toBeLessThanOrEqual(10)
      expect(planDrop(id, 'P1').xp).toBeGreaterThanOrEqual(25)
      expect(planDrop(id, 'P1').xp).toBeLessThanOrEqual(38)
      expect(planDrop(id, 'P2').xp).toBeGreaterThanOrEqual(8)
      expect(planDrop(id, 'P2').xp).toBeLessThanOrEqual(15)
      expect(planDrop(id, 'P2').gold).toBeGreaterThanOrEqual(1)
      expect(planDrop(id, 'P2').gold).toBeLessThanOrEqual(3)
    }
  })

  it('不同 id 结果有区分度（伪随机非常数）', () => {
    const drops = new Set(Array.from({ length: 20 }, (_, i) => planDrop(`k${i}`, 'P2').xp))
    expect(drops.size).toBeGreaterThan(1)
  })
})

describe('postDrop（文章奖励）', () => {
  it('已发布 50，草稿 0', () => {
    expect(postDrop(true)).toBe(50)
    expect(postDrop(false)).toBe(0)
  })
})
