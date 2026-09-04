/**
 * 可扩展主题系统（需求 15）：
 * - 内置主题（亮/暗/跟随系统 + 云笺蓝/墨绿/暖橙等成套主题）
 * - 自定义主题：用户编辑核心 CSS 变量（背景/表面/文字/主色/字体…），保存到 localStorage
 * - 统一主题配置结构 themeRegistry + 扩展接口（后续第三方主题按同一结构注册即可接入）
 * 应用方式：<html data-theme>（亮/暗 骨架）+ <html style="--var:value">（主题变量覆盖）
 */
export type ThemeBase = 'light' | 'dark' | 'auto'

export interface ThemeVars {
  '--bg'?: string
  '--bg-glow'?: string
  '--surface'?: string
  '--surface-2'?: string
  '--text'?: string
  '--text-2'?: string
  '--accent'?: string
  '--accent-2'?: string
  '--radius'?: string
  '--font'?: string
}

export interface CloudTheme {
  id: string
  label: string
  /** 骨架基础：亮色 / 暗色（跟随系统主题的特殊标记） */
  base: ThemeBase
  /** 套色主题在 base 之上覆盖的变量 */
  vars: Partial<Record<string, string>>
  /** 主题卡片预览色 */
  swatch: [string, string]
  /** 是否为第三方/自定义主题（仅自定义标记） */
  custom?: boolean
}

/** 内置主题注册表（扩展接口：push 新主题到该数组即可全局生效） */
export const THEME_REGISTRY: CloudTheme[] = [
  { id: 'default', label: '云笺蓝', base: 'light', vars: { '--accent': '#2f6df6', '--accent-2': '#3f9e7d' }, swatch: ['#2f6df6', '#3f9e7d'] },
  { id: 'default-dark', label: '暮色深蓝', base: 'dark', vars: {}, swatch: ['#131c2c', '#2f6df6'] },
  { id: 'ink', label: '墨韵灰', base: 'light', vars: { '--accent': '#334155', '--accent-2': '#64748b', '--bg': '#f5f5f4', '--surface': '#fafaf9', '--text': '#1c1917' }, swatch: ['#334155', '#64748b'] },
  { id: 'ink-dark', label: '子夜墨', base: 'dark', vars: { '--accent': '#94a3b8', '--accent-2': '#e2e8f0', '--text': '#e7e5e4', '--bg': '#0c0a09' }, swatch: ['#94a3b8', '#e2e8f0'] },
  { id: 'forest', label: '青藤绿', base: 'light', vars: { '--accent': '#059669', '--accent-2': '#0d9488', '--bg': '#f0fdf4', '--surface': '#f8faf8' }, swatch: ['#059669', '#0d9488'] },
  { id: 'forest-dark', label: '雾杉暗', base: 'dark', vars: { '--accent': '#34d399', '--accent-2': '#2dd4bf', '--text': '#d1fae5', '--bg': '#042f2e' }, swatch: ['#34d399', '#2dd4bf'] },
  { id: 'sunset', label: '落日橙', base: 'light', vars: { '--accent': '#ea580c', '--accent-2': '#c026d3', '--bg': '#fff7ed', '--surface': '#fffaf5' }, swatch: ['#ea580c', '#c026d3'] },
  { id: 'midnight', label: '星夜紫', base: 'dark', vars: { '--accent': '#8b5cf6', '--accent-2': '#6366f1', '--text': '#ede9fe', '--bg': '#150f2e' }, swatch: ['#8b5cf6', '#6366f1'] },
]

const CUSTOM_KEY = 'cl_theme_custom'
const THEME_KEY = 'cl_theme'
const CUSTOM_VAR_KEYS: Array<{ key: string; label: string }> = [
  { key: '--bg', label: '背景色' },
  { key: '--surface', label: '表面色（卡片）' },
  { key: '--text', label: '文字色' },
  { key: '--accent', label: '主色（强调）' },
  { key: '--accent-2', label: '辅色（渐变）' },
  { key: '--radius', label: '圆角（如 16px）' },
]

/** 用户自定义主题（编辑核心变量后保存） */
export interface CustomTheme {
  base: ThemeBase
  vars: Partial<Record<string, string>>
}

export function readCustomTheme(): CustomTheme | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as CustomTheme
    return v && typeof v === 'object' ? v : null
  } catch { return null }
}

export function writeCustomTheme(t: CustomTheme): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(t))
}

export function clearCustomTheme(): void {
  localStorage.removeItem(CUSTOM_KEY)
}

/** 当前激活的主题对象（注册表 + 自定义） */
export function activeCloudTheme(): CloudTheme | null {
  const id = localStorage.getItem('cl_cloud_theme') || 'default'
  if (id === 'custom') {
    const c = readCustomTheme()
    if (c) {
      return {
        id: 'custom', label: '自定义主题', base: c.base, vars: c.vars,
        swatch: [c.vars['--accent'] ?? '#2f6df6', c.vars['--accent-2'] ?? '#3f9e7d'], custom: true,
      }
    }
    return null
  }
  return THEME_REGISTRY.find((t) => t.id === id) ?? THEME_REGISTRY[0]
}

/** 保存当前套色主题（custom 需先 writeCustomTheme） */
export function saveCloudTheme(id: string): void {
  localStorage.setItem('cl_cloud_theme', id)
}

/** 解析某主题的亮/暗骨架 */
function baseDarkOf(t: CloudTheme): boolean {
  return t.base === 'dark' || (t.base === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches)
}

/** 应用主题：骨架（light/dark）+ 主题变量注入 <html style> */
export function applyCloudTheme(): void {
  const theme = activeCloudTheme()
  const css = document.documentElement.style
  // 先按用户基础偏好设置骨架（data-theme），套色覆盖其上的变量
  const pref = (localStorage.getItem(THEME_KEY) as ThemeBase) || 'auto'
  const darkNow = pref === 'dark' || (pref === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = darkNow ? 'dark' : 'light'
  // 注入主题变量
  css.removeProperty('--accent')
  css.removeProperty('--accent-glow')
  css.removeProperty('--accent-2')
  const vars: Record<string, string> = {}
  if (theme) {
    for (const [k, val] of Object.entries(theme.vars)) {
      if (!val) continue
      if (k === '--bg' || k === '--surface' || k === '--text' || k === '--radius') {
        vars[k] = val
        continue
      }
      if (k === '--accent') {
        vars['--accent'] = val
        vars['--accent-soft'] = colorMix(val, 0.12)
        vars['--accent-glow'] = `rgba(${hexToRgb(val)}, .35)`
        continue
      }
      if (k === '--accent-2') { vars['--accent-2'] = val; continue }
      vars[k] = val
    }
  }
  for (const [k, val] of Object.entries(vars)) css.setProperty(k, val)
}

/** 颜色 → rgba 字符串（用于 accent 的透明变体） */
function colorMix(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex).split(',').map(Number)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function hexToRgb(hex: string): string {
  let h = String(hex).trim().replace('#', '')
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(h)) return '47,109,246'
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

export { CUSTOM_VAR_KEYS }

export type ThemePref = ThemeBase
export type DensityPref = 'standard' | 'compact'

const media = window.matchMedia?.('(prefers-color-scheme: dark)')

export function applyTheme(pref: ThemePref): void {
  localStorage.setItem(THEME_KEY, pref)
  applyCloudTheme()
}

export function applyDensity(d: DensityPref): void {
  document.documentElement.dataset.density = d
}

/** 启动时应用持久化偏好；auto 模式跟随系统切换 */
export function initTheme(): void {
  const density = (localStorage.getItem('cl_density') as DensityPref) || 'standard'
  applyTheme((localStorage.getItem(THEME_KEY) as ThemePref) || 'auto')
  applyDensity(density)
  media?.addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) as ThemePref) === 'auto') applyCloudTheme()
  })
}

export function currentThemePref(): ThemePref {
  return (localStorage.getItem(THEME_KEY) as ThemePref) || 'auto'
}