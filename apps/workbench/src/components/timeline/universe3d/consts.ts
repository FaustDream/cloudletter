/** 节点宇宙（Three.js）场景常量、纯工具与共享类型 —— 从 TimelineUniverse3d 拆出，场景闭包与 UI 子组件共用 */
import * as THREE from 'three'
import type { TimelineType } from '../timeline'

export const SKY = 0xdcebfa
/** 中心太阳（暖色） */
export const SUN_COLOR = 0xffa02e
export const SUN_GLOW = 0xffb35c
/** 语义关系连线配色 */
export const LINE_DATE = 0x6db8ff     // 同日期 · 中性蓝
export const LINE_TYPE = 0xffb066     // 同类型 · 琥珀
export const LINE_RADIAL = 0x8fb9e8   // 辐射
/** 高亮（选中关系）：暖金加粗 + 两端脉冲，一眼定位 */
export const HL_LINE = 0xffd76a
export const HL_PULSE = 0xffe08a
export const DIM = new THREE.Color(0x35415c) // 降光基调（更深，突出高亮）
export const SIZE_MIN = 0.9
export const SIZE_MAX = 2.4
export const SPEED_STEPS = [0, 0.55, 1, 1.7]
export const SPEED_LABEL = ['静止', '慢', '中', '快']
export const MAX_FLOAT = 3
/** 节点类型 → 表情（调皮一点） */
export const TYPE_EMOJI: Record<TimelineType, string> = {
  journal: '✍️', note: '💡', plan: '✅', checkin: '🔥', ledger: '💰', goal: '🎯', focus: '🍅',
}

export const ORBITS = [26, 42, 58]
export const LAYER_OF = (di: number) => (di === 0 ? 0 : di <= 6 ? 1 : 2)
export const SIZE_OF = [1.7, 1.15, 0.75]

/** HTML 转义（内容气泡 innerHTML 拼接用） */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

/** 内容气泡（DOM 直改零重渲染） */
export interface FloatBubble {
  id: number
  node: THREE.Mesh
  el: HTMLDivElement
  line: HTMLDivElement
  born: number
  dur: number
  paused: boolean
}

export interface PairInfo { kind: 'date' | 'type'; a: THREE.Mesh; b: THREE.Mesh }
