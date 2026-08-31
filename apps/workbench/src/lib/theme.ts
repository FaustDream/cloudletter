/**
 * 主题与密度（真实生效，设置·偏好写入后全局应用）：
 * - 主题：light / dark / auto（跟随系统），写到 <html data-theme>，dark 由 CSS 变量覆盖
 * - 密度：standard / compact，写到 <html data-density>
 * 偏好持久化在 localStorage（cl_theme / cl_density），main.tsx 启动时应用。
 */
export type ThemePref = 'light' | 'dark' | 'auto'
export type DensityPref = 'standard' | 'compact'

const media = window.matchMedia?.('(prefers-color-scheme: dark)')

function isDark(pref: ThemePref): boolean {
  return pref === 'dark' || (pref === 'auto' && !!media?.matches)
}

export function applyTheme(pref: ThemePref): void {
  document.documentElement.dataset.theme = isDark(pref) ? 'dark' : 'light'
}

export function applyDensity(d: DensityPref): void {
  document.documentElement.dataset.density = d
}

/** 启动时应用持久化偏好；auto 模式跟随系统切换 */
export function initTheme(): void {
  const theme = (localStorage.getItem('cl_theme') as ThemePref) || 'light'
  const density = (localStorage.getItem('cl_density') as DensityPref) || 'standard'
  applyTheme(theme)
  applyDensity(density)
  media?.addEventListener('change', () => {
    if ((localStorage.getItem('cl_theme') as ThemePref) === 'auto') applyTheme('auto')
  })
}

export function currentThemePref(): ThemePref {
  return (localStorage.getItem('cl_theme') as ThemePref) || 'light'
}
