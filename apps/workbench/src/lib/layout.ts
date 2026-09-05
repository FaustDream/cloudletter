/**
 * 显示风格偏好（localStorage 持久化；各页面页头切换器即点即换）。
 * 时间线布局（位置显示）：river 河流蜿蜒（默认）/ axis 居中轴线 / list 单列列表
 * 灵感笔记风格：card 卡片网格（默认）/ list 列表行 / timeline 纵向时间线 / sticky 便利贴
 * 目标三页风格：card 舒适（默认）/ compact 紧凑 / group 分组
 *   - 长期目标分组：未开始 / 进行中 / 已完成
 *   - 今日计划分组：P0 紧急 / P1 重要 / P2 一般
 *   - 习惯打卡分组：今日已打 / 今日未打
 * 颜色统一沿用主蓝 + 语义色设计系统，仅改变布局与视觉组织。
 */
export type TimelineLayout = 'river' | 'axis' | 'list'
export type NoteStyle = 'card' | 'list' | 'timeline' | 'sticky'
export type GoalStyle = 'card' | 'compact' | 'group'
export type PlanStyle = 'card' | 'compact' | 'group'
export type CheckinStyle = 'card' | 'compact' | 'group'

const TL_LAYOUTS: TimelineLayout[] = ['river', 'axis', 'list']
export const NOTE_STYLES: NoteStyle[] = ['card', 'list', 'timeline', 'sticky']

/** 笔记布局中文名（页头切换器与设置入口共用） */
export const NOTE_STYLE_LABELS: Record<NoteStyle, string> = {
  card: '卡片', list: '列表', timeline: '时间线', sticky: '便利贴',
}
export const GOAL_STYLE_LABELS: Record<GoalStyle, string> = {
  card: '舒适', compact: '紧凑', group: '分组',
}
export const PLAN_STYLE_LABELS: Record<PlanStyle, string> = GOAL_STYLE_LABELS
export const CHECKIN_STYLE_LABELS: Record<CheckinStyle, string> = GOAL_STYLE_LABELS

/** 读取布局偏好：非法值回退默认 */
export function readLayout<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = localStorage.getItem(key) as T | null
  return v && allowed.includes(v) ? v : fallback
}

/** 写入布局偏好 */
export function writeLayout(key: string, v: string): void {
  localStorage.setItem(key, v)
}

export function timelineLayout(): TimelineLayout {
  return readLayout('cl_tl_layout', TL_LAYOUTS, 'river')
}

export function setTimelineLayout(v: TimelineLayout): void {
  writeLayout('cl_tl_layout', v)
}

export function noteStyle(): NoteStyle {
  return readLayout('cl_note_style', NOTE_STYLES, 'card')
}

export function setNoteStyle(v: NoteStyle): void {
  writeLayout('cl_note_style', v)
}

/** 目标三页布局偏好（cl_goals_layout / cl_plan_layout / cl_checkin_layout） */
export function goalStyle(): GoalStyle {
  return readLayout('cl_goals_layout', ['card', 'compact', 'group'] as const, 'card')
}
export function setGoalStyle(v: GoalStyle): void {
  writeLayout('cl_goals_layout', v)
}
export function planStyle(): PlanStyle {
  return readLayout('cl_plan_layout', ['card', 'compact', 'group'] as const, 'card')
}
export function setPlanStyle(v: PlanStyle): void {
  writeLayout('cl_plan_layout', v)
}
export function checkinStyle(): CheckinStyle {
  return readLayout('cl_checkin_layout', ['card', 'compact', 'group'] as const, 'card')
}
export function setCheckinStyle(v: CheckinStyle): void {
  writeLayout('cl_checkin_layout', v)
}
