/**
 * 功能导览（tips）展示策略：新账户必弹、每次重新登录后首次进入弹一次，同一登录会话内不重复。
 * 会话界定：登录成功时由 api.setToken 统一写入 cl_login_epoch；刷新页面/重开浏览器不算重新登录。
 * 关闭分两档：session（本次会话不再弹）/ forever（永不弹，设置页清偏好也保留）。
 * store 参数默认 localStorage，测试可注入内存实现。
 */
export type TourScope = 'session' | 'forever'
export interface TourRecord {
  scope: TourScope
  /** 关闭时的登录会话标记；scope 为 forever 时无意义 */
  epoch: string
}

export const LOGIN_EPOCH_KEY = 'cl_login_epoch'
const TOUR_KEY = 'cl_org_tour'
const LEGACY_TOUR_KEY = 'cl_org_toured'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 登录成功时刻写入新会话标记（api.setToken 统一收口，勿在页面里散调） */
export const markLoginEpoch = (store: Store = localStorage): void => {
  store.setItem(LOGIN_EPOCH_KEY, String(Date.now()))
}

export const readLoginEpoch = (store: Store = localStorage): string =>
  store.getItem(LOGIN_EPOCH_KEY) ?? ''

export const loadTourRecord = (store: Store = localStorage): TourRecord | null => {
  try {
    const raw = store.getItem(TOUR_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as TourRecord
      if (parsed && (parsed.scope === 'session' || parsed.scope === 'forever')) return parsed
    }
  } catch {
    /* 记录损坏按未关闭处理 */
  }
  // 旧版「关过即永久记忆」迁移：视为永不提示，尊重当时的关闭意愿
  if (store.getItem(LEGACY_TOUR_KEY) === '1') return { scope: 'forever', epoch: '' }
  return null
}

export const saveTourRecord = (scope: TourScope, epoch: string, store: Store = localStorage): void => {
  store.setItem(TOUR_KEY, JSON.stringify({ scope, epoch }))
  store.removeItem(LEGACY_TOUR_KEY)
}

export const shouldShowTour = (record: TourRecord | null, epoch: string): boolean => {
  if (!record) return true // 从未关闭过 → 新账户/新设备必弹
  if (record.scope === 'forever') return false
  return record.epoch !== epoch // session：仅同一登录会话内隐藏，重新登录后换 epoch 再弹
}
