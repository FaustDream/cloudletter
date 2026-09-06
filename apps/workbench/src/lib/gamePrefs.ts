/**
 * 游戏化功能开关（设置 → 游戏）：讨伐 / 经验升级 默认关闭，待优化或更完整方案后再放出。
 * localStorage 持久化（cl_game_prefs），各页面实时读取 + storage 事件跨页同步。
 */
export interface GamePrefs {
  /** 讨伐模式：总览讨伐卡 / 3D 宇宙讨伐入口 */
  battle: boolean
  /** 经验与等级：等级徽标 / 升级庆祝 / 掉落口径展示 */
  xp: boolean
}

const KEY = 'cl_game_prefs'

export function readGamePrefs(): GamePrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as Partial<GamePrefs>
      return { battle: p.battle === true, xp: p.xp === true }
    }
  } catch { /* 记录损坏按默认处理 */ }
  return { battle: false, xp: false }
}

export function writeGamePrefs(p: GamePrefs): void {
  localStorage.setItem(KEY, JSON.stringify(p))
}
