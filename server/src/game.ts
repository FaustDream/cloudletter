/**
 * 游戏化奖励口径（时间线 / 讨伐 / 未来玩法共用）：
 * - 奖励只发给「完成态」：已发布文章、已完成计划（草稿 / 未完成一律 0）
 * - 计划奖励按计划 id 做确定性伪随机（同 id 恒定、不同 id 分布在档位区间内），
 *   保证「完成时刻的随机掉落」与「时间线回溯展示」两边口径永远一致
 */

/** 字符串 → 32 位无符号散列（FNV-1a） */
function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** [min, max] 区间内按种子取值（种子相同 → 结果相同） */
function seededInRange(seed: number, min: number, max: number): number {
  const span = max - min
  return min + (seed % (span + 1))
}

export type PlanLevel = 'P0' | 'P1' | 'P2' | 'P4'

const PLAN_RANGES: Record<PlanLevel, { xp: [number, number]; gold: [number, number] }> = {
  P0: { xp: [35, 50], gold: [6, 10] },
  P1: { xp: [25, 38], gold: [4, 7] },
  P2: { xp: [8, 15], gold: [1, 3] },
  P4: { xp: [3, 6], gold: [0, 1] },
}

/** 计划完成掉落：等级档位 × 计划 id 确定性随机 */
export function planDrop(planId: string, level: string): { xp: number; gold: number } {
  const tier: PlanLevel = level === 'P0' ? 'P0' : level === 'P1' ? 'P1' : level === 'P4' ? 'P4' : 'P2'
  const r = PLAN_RANGES[tier]
  const s1 = hash32(`xp:${planId}`)
  const s2 = hash32(`gold:${planId}`)
  return { xp: seededInRange(s1, r.xp[0], r.xp[1]), gold: seededInRange(s2, r.gold[0], r.gold[1]) }
}

/** 文章奖励：仅已发布给固定奖励，草稿 0（写作过程不发奖，发布才算成绩） */
export function postDrop(published: boolean): number {
  return published ? 50 : 0
}
