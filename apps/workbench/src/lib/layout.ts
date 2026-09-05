/**
 * 显示风格偏好（设置·偏好 写入 localStorage，页面渲染时读取；灵感笔记页页头可即点即换）
 * 时间线布局（位置显示）：
 *   river 河流蜿蜒（默认）/ axis 居中轴线 / list 单列列表
 * 灵感笔记风格：
 *   card 卡片网格（默认）/ list 列表行 / timeline 纵向时间线 / masonry 瀑布流 / sticky 便利贴
 * 颜色统一沿用主蓝 + 语义色设计系统，仅改变布局与视觉组织。
 */
export type TimelineLayout = 'river' | 'axis' | 'list'
export type NoteStyle = 'card' | 'list' | 'timeline' | 'masonry' | 'sticky'

const TL_LAYOUTS: TimelineLayout[] = ['river', 'axis', 'list']
export const NOTE_STYLES: NoteStyle[] = ['card', 'list', 'timeline', 'masonry', 'sticky']

/** 笔记布局中文名（页头切换器与设置入口共用） */
export const NOTE_STYLE_LABELS: Record<NoteStyle, string> = {
  card: '卡片', list: '列表', timeline: '时间线', masonry: '瀑布流', sticky: '便利贴',
}

export function timelineLayout(): TimelineLayout {
  const v = localStorage.getItem('cl_tl_layout') as TimelineLayout | null
  return v && TL_LAYOUTS.includes(v) ? v : 'river'
}

export function setTimelineLayout(v: TimelineLayout): void {
  localStorage.setItem('cl_tl_layout', v)
}

export function noteStyle(): NoteStyle {
  const v = localStorage.getItem('cl_note_style') as NoteStyle | null
  return v && NOTE_STYLES.includes(v) ? v : 'card'
}

export function setNoteStyle(v: NoteStyle): void {
  localStorage.setItem('cl_note_style', v)
}
