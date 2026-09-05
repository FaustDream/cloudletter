/**
 * 组件主题变体系统（概念：骨架不变 · 样式抽离可切换）
 * 任何「骨架固定、外观可换」的组件都可接入：
 *   1. 在下方注册一组 ThemeVariant（id + 标签 + 说明 + 预览色）
 *   2. 组件根节点根据偏好渲染 data-theme={id}
 *   3. CSS 按 [data-theme='...'] 覆盖视觉层，骨架样式保持不变
 *   4. 设置·偏好 用带色块的 Dropdown/ThemeSelect 选择，写入 localStorage（cl_theme_<key>）
 * 后续新增组件主题：追加一个 Variant 列表 + 一组 CSS 变体即可，无需改动框架。
 */

export interface ThemeVariant {
  id: string
  label: string
  desc: string
  /** 设置面板里的预览色（可为渐变） */
  swatch: string
}

/** 日期选择胶囊主题（9 套 · 颜色沿用主蓝 + 语义色体系，无紫色） */
export const CAPSULE_THEMES: ThemeVariant[] = [
  { id: 'glass', label: '毛玻璃', desc: '默认 · 半透明玻璃', swatch: 'linear-gradient(135deg,#eaf2ff,#cfe2ff)' },
  { id: 'solid', label: '实心', desc: '纯色卡片 · 高对比', swatch: 'linear-gradient(135deg,#f4f8ff,#dfe9f8)' },
  { id: 'accent', label: '主蓝', desc: '品牌蓝高亮', swatch: 'linear-gradient(135deg,#4f8bff,#2f6fd6)' },
  { id: 'ink', label: '墨黑', desc: '深色描边 · 夜间友好', swatch: 'linear-gradient(135deg,#1c2a44,#0f1a2e)' },
  { id: 'aurora', label: '极光', desc: '蓝青渐变 · 炫彩', swatch: 'linear-gradient(135deg,#4f8bff,#38bdf8)' },
  { id: 'ocean', label: '深海', desc: '深蓝渐变 · 沉静', swatch: 'linear-gradient(135deg,#2563eb,#1e3a8a)' },
  { id: 'forest', label: '松林', desc: '墨绿渐变 · 自然', swatch: 'linear-gradient(135deg,#059669,#065f46)' },
  { id: 'mint', label: '薄荷', desc: '浅绿明快 · 清新', swatch: 'linear-gradient(135deg,#ecfdf6,#d4f4e6)' },
  { id: 'ivory', label: '白描边', desc: '纯白 + 蓝色描边', swatch: 'linear-gradient(135deg,#ffffff,#eef4ff)' },
]

/** 读取组件主题偏好；非法值回退到默认 */
export function readTheme(key: string, variants: ThemeVariant[], fallback: string): string {
  try {
    const v = localStorage.getItem(`cl_theme_${key}`)
    if (v && variants.some((x) => x.id === v)) return v
  } catch { /* 忽略 localStorage 异常 */ }
  return fallback
}

/** 写入组件主题偏好 */
export function writeTheme(key: string, value: string): void {
  localStorage.setItem(`cl_theme_${key}`, value)
}

/* ------------------------------------------------------------------
 * 按日期独立主题（续同一概念：骨架不变 · 样式抽离）
 * 每个日期可覆盖全局组件主题：cl_day_theme_<yyyy-mm-dd> = <themeId>
 * 未覆盖的日期自动「跟随全局」主题。
 * ------------------------------------------------------------------ */

/** 日期独立主题的 localStorage 键前缀 */
export const DAY_THEME_PREFIX = 'cl_day_theme_'

export function dayThemeKey(ymd: string): string {
  return `${DAY_THEME_PREFIX}${ymd}`
}

/** 读取某日期的独立主题；无覆盖时返回 null（跟随全局） */
export function readDayTheme(ymd: string): string | null {
  try {
    return localStorage.getItem(dayThemeKey(ymd))
  } catch {
    return null
  }
}

/** 为某日期写入独立主题；传 ''/null 即清除覆盖、恢复跟随全局 */
export function writeDayTheme(ymd: string, value: string | null): void {
  if (value && CAPSULE_THEMES.some((x) => x.id === value)) localStorage.setItem(dayThemeKey(ymd), value)
  else localStorage.removeItem(dayThemeKey(ymd))
}

/** 清除某日期的独立主题（恢复跟随全局） */
export function removeDayTheme(ymd: string): void {
  localStorage.removeItem(dayThemeKey(ymd))
}

/** 列出所有已设置独立主题的日期：{ ymd: themeId }（从旧到新） */
export function listDayThemes(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(DAY_THEME_PREFIX)) keys.push(k)
    }
    keys.sort()
    for (const k of keys) {
      const v = localStorage.getItem(k)
      if (v && CAPSULE_THEMES.some((x) => x.id === v)) out[k.slice(DAY_THEME_PREFIX.length)] = v
    }
  } catch { /* 忽略 localStorage 异常 */ }
  return out
}

/** 清除全部日期独立主题（全部恢复跟随全局） */
export function clearDayThemes(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(DAY_THEME_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch { /* 忽略 localStorage 异常 */ }
}

/** 按主题 id 取标签（未知 id 返回原文） */
export function themeLabel(id: string, variants: ThemeVariant[] = CAPSULE_THEMES): string {
  return variants.find((x) => x.id === id)?.label ?? id
}

/* ------------------------------------------------------------------
 * 组件布局主题变体（每个"骨架固定、外观/布局可换"的组件，单独一组变体）
 * 后续原则：每增加一个"骨架不变 · 样式可换"的区域，追加一组 ThemeVariant[]
 * 同一个概念：默认+N个变体，设置下拉选择，骨架不变，仅样式变量换
 * ------------------------------------------------------------------ */

/** 灵感笔记网格布局风格（card / list / timeline）已在 lib/layout.ts */

/** 日常卡片背景主题 */
export const DAILY_CARD_THEMES: ThemeVariant[] = [
  { id: 'default', label: '标准', desc: '白卡+浅分栏 · 默认', swatch: 'linear-gradient(135deg, #ffffff, #f8faff)' },
  { id: 'glass', label: '毛玻璃', desc: '高透磨砂模糊', swatch: 'linear-gradient(135deg, rgba(255,255,255,.6), rgba(240,245,255,.3))' },
  { id: 'accent', label: '主蓝', desc: '品牌蓝背景', swatch: 'linear-gradient(135deg, #4f8bff, #2f6fd6)' },
  { id: 'forest', label: '墨绿', desc: '绿色系背景', swatch: 'linear-gradient(135deg, #059669, #065f46)' },
  { id: 'ocean', label: '深蓝', desc: '沉静蓝背景', swatch: 'linear-gradient(135deg, #2563eb, #1e3a8a)' },
]

/** 检索结果卡片背景主题 */
export const SEARCH_CARD_THEMES: ThemeVariant[] = [
  { id: 'plain', label: '纯白', desc: '白底黑线 · 默认', swatch: 'linear-gradient(135deg, #ffffff, #ffffff)' },
  { id: 'subtle', label: '浅灰', desc: '浅灰块不突兀', swatch: 'linear-gradient(135deg, #fafbff, #f5f8ff)' },
  { id: 'glass', label: '毛玻璃', desc: '高透磨砂', swatch: 'linear-gradient(135deg, rgba(255,255,255,.5), rgba(240,245,255,.2))' },
  { id: 'nested', label: '嵌套', desc: '嵌套底色', swatch: 'linear-gradient(135deg, var(--surface-nested), var(--surface-nested))' },
]

/** 目标列表行主题 */
export const GOALS_ROW_THEMES: ThemeVariant[] = [
  { id: 'flat', label: '纯色', desc: '白底单条 · 默认', swatch: 'linear-gradient(135deg, #ffffff, #f8faff)' },
  { id: 'border', label: '描边', desc: '细边框白底', swatch: 'linear-gradient(135deg, #ffffff, #ffffff)' },
  { id: 'glass', label: '毛玻璃', desc: '半透磨砂', swatch: 'linear-gradient(135deg, rgba(255,255,255,.5), rgba(240,245,255,.2))' },
  { id: 'stripe', label: '条纹', desc: '左侧色条', swatch: 'linear-gradient(135deg, #f5f8ff 0, #f5f8ff 98%, var(--accent) 98%, var(--accent) 100%)' },
]

/** 文章列表布局风格（PostsPage 列表 / 卡片）已在 PostsPage 支持，这里是背景主题变体 */
export const POST_LIST_THEMES: ThemeVariant[] = [
  { id: 'clean', label: '清爽', desc: '纯白白底 · 默认', swatch: 'linear-gradient(135deg, #ffffff, #ffffff)' },
  { id: 'card', label: '卡片', desc: '圆角卡片阴影', swatch: 'linear-gradient(135deg, #ffffff, #f8faff)' },
  { id: 'subtle', label: '浅灰', desc: '浅灰块层次', swatch: 'linear-gradient(135deg, #fafbff, #f5f8ff)' },
]

/** 番茄专注主题（时间球 / 循环点的配色，设置·偏好 → 番茄专注 切换） */
export const POMODORO_THEMES: ThemeVariant[] = [
  { id: 'blue', label: '主蓝', desc: '品牌蓝 · 默认', swatch: 'linear-gradient(135deg,#4f8bff,#2f6fd6)' },
  { id: 'tomato', label: '番茄红', desc: '经典番茄红', swatch: 'linear-gradient(135deg,#ff5a4d,#e23b2f)' },
  { id: 'orange', label: '活力橙', desc: '暖橙更有动力', swatch: 'linear-gradient(135deg,#ff9f43,#f7752b)' },
  { id: 'forest', label: '墨绿', desc: '自然专注绿', swatch: 'linear-gradient(135deg,#059669,#065f46)' },
  { id: 'ocean', label: '深海', desc: '沉静深蓝', swatch: 'linear-gradient(135deg,#2563eb,#1e3a8a)' },
  { id: 'gold', label: '琥珀', desc: '暖金琥珀', swatch: 'linear-gradient(135deg,#f5b04b,#d98a24)' },
  { id: 'mint', label: '薄荷', desc: '清新浅绿', swatch: 'linear-gradient(135deg,#2dd4a7,#0ea47f)' },
]

/** 所有布局主题预存，便于遍历配置 */
export const LAYOUT_THEMES: { key: string; label: string; variants: ThemeVariant[] }[] = [
  { key: 'dailyCard', label: '日常卡片', variants: DAILY_CARD_THEMES },
  { key: 'searchCard', label: '检索卡片', variants: SEARCH_CARD_THEMES },
  { key: 'goalsRow', label: '目标行', variants: GOALS_ROW_THEMES },
  { key: 'postList', label: '文章列表', variants: POST_LIST_THEMES },
]

/** 读取布局主题偏好 */
export function readLayoutTheme(key: string, variants: ThemeVariant[], fallback: string): string {
  return readTheme(`layout_${key}`, variants, fallback)
}

/** 写入布局主题偏好 */
export function writeLayoutTheme(key: string, value: string): void {
  writeTheme(`layout_${key}`, value)
}
