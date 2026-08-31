/**
 * 框架层 · 布局 Shell：三态侧边栏（常驻展开 / 图标轨道 / 悬停悬浮）+ 头像菜单 + 内容区。
 * 需求 1：手动切换（底部按钮）/ 快捷键（⌘/Ctrl + B）/ 悬停预览 三条触达路径共存；
 *         状态持久化 localStorage，窄屏自动降级为图标轨道。
 * 需求 3：侧边栏底部内嵌头像菜单（个人中心浮层）。
 * 需求 6：导航入口统一为「设置」，账户并入设置中心。
 */
import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth'
import { Icon } from './Icon'
import { FxEngine } from './FxEngine'
import { AvatarMenu } from './AvatarMenu'
import { BackToTop } from './BackToTop'
import type { ReactNode } from 'react'

interface NavItem {
  to: string
  label: string
  icon: string
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '内容',
    items: [
      { to: '/', label: '云笺', icon: 'home' },
      { to: '/posts', label: '文章', icon: 'file' },
      { to: '/notes', label: '灵感笔记', icon: 'book' },
      { to: '/organize', label: '组织', icon: 'grid' },
      { to: '/search', label: '检索', icon: 'search' },
    ],
  },
  {
    title: '日常',
    items: [{ to: '/daily', label: '日常', icon: 'flame' }, { to: '/goals-home', label: '目标', icon: 'target' }],
  },
  {
    title: '记账',
    items: [{ to: '/ledger', label: '记账本', icon: 'wallet' }],
  },
  {
    title: '系统',
    items: [{ to: '/settings', label: '设置', icon: 'setting' }],
  },
]

type SbMode = 'pinned' | 'collapsed'
const SB_KEY = 'cl_sidebar'
const NARROW_W = 1240 // 小于该宽度自动降级为图标轨道

export function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const { user } = useAuth()
  const inLogin = loc.pathname === '/login'

  // ---- 需求 1：侧边栏三态 ----
  const [mode, setMode] = useState<SbMode>(() => (localStorage.getItem(SB_KEY) === 'collapsed' ? 'collapsed' : 'pinned'))
  const [narrow, setNarrow] = useState(window.innerWidth < NARROW_W)
  const [peek, setPeek] = useState(false)
  const enterTimer = useRef<number | undefined>(undefined)
  const leaveTimer = useRef<number | undefined>(undefined)

  const effective = narrow ? 'collapsed' : mode
  const expanded = effective === 'pinned' || peek

  useEffect(() => {
    const onResize = () => {
      const n = window.innerWidth < NARROW_W
      setNarrow(n)
      if (n) setPeek(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const toggleMode = () => {
    const next: SbMode = effective === 'pinned' ? 'collapsed' : 'pinned'
    if (narrow) return
    setMode(next)
    setPeek(false)
    localStorage.setItem(SB_KEY, next)
  }

  // 快捷键：⌘/Ctrl + B（输入场景不生效，避免误触）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
        e.preventDefault()
        toggleMode()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 悬停悬浮：进入 120ms 延迟（hover intent）/ 离开 350ms 延迟（防抖）
  const startPeek = () => {
    clearTimeout(leaveTimer.current)
    if (peek) return
    enterTimer.current = window.setTimeout(() => setPeek(true), 120)
  }
  const stopPeek = () => {
    clearTimeout(enterTimer.current)
    leaveTimer.current = window.setTimeout(() => setPeek(false), 350)
  }

  const nav = useMemo(
    () => (
      <nav className="nav" aria-label="主导航">
        {GROUPS.map((g, i) => (
          <div key={i}>
            <div className="nav-sep">{g.title}</div>
            {g.items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === '/'}
                title={it.label}
                className={({ isActive }) => `navi ${isActive ? 'active' : ''}`}
                onClick={() => setPeek(false)}
              >
                <Icon name={it.icon} />
                <span>{it.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    ),
    [],
  )

  if (inLogin) return <>{children}</>

  return (
    <div className={`wb-layout ${effective}${peek ? ' peeking' : ''}`}>
      <FxEngine />
      <aside
        className={`sidebar ${effective}${peek ? ' peek' : ''}`}
        onMouseEnter={effective === 'collapsed' ? startPeek : undefined}
        onMouseLeave={effective === 'collapsed' ? stopPeek : undefined}
      >
        <div className="brand">
          <div className="logo">
            <Icon name="pen" size={22} />
          </div>
          <div className="brand-tx">
            <h1>云笺集</h1>
            <p>CLOUDLETTER</p>
          </div>
        </div>
        {nav}
        <div className="sb-ctrl">
          <button className="sb-toggle" onClick={toggleMode} aria-expanded={expanded}
            title={effective === 'pinned' ? '折叠侧边栏（⌘/Ctrl + B）' : '展开侧边栏（⌘/Ctrl + B）'}>
            <Icon name={effective === 'pinned' ? 'panelFold' : 'panel'} size={17} />
          </button>
          <span className="sb-hotkey">⌘B</span>
          {peek && <span className="sb-peek-hint">松开移出自动收起</span>}
        </div>
        <div className="foot">
          {user ? (
            <AvatarMenu size={expanded ? 'lg' : 'sm'} align="left" />
          ) : (
            <NavLink to="/login" className="foot-login">登录账户</NavLink>
          )}
        </div>
      </aside>
      <main className="main">
        <div className="screen">{children}</div>
      </main>
      {/* 全局回到顶部：滚动下滑即出现，内容不足一屏自动隐藏 */}
      <BackToTop />
    </div>
  )
}