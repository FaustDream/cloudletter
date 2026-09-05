/**
 * 框架层 · 布局 Shell：三态侧边栏（常驻展开 / 图标轨道 / 悬停抽屉）+ 头像菜单 + 内容区。
 * 需求 1：手动切换（底部按钮）/ 快捷键（⌘/Ctrl + B）/ 悬停预览 三条触达路径共存；
 *         状态持久化 localStorage，窄屏自动降级为图标轨道。
 * 需求 3：侧边栏底部内嵌头像菜单（个人中心浮层）。
 * 需求 6：导航入口统一为「设置」，账户并入设置中心。
 */
import { NavLink, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth'
import { Icon } from './Icon'
import { FxEngine } from './FxEngine'
import { AvatarMenu } from './AvatarMenu'
import { BackToTop } from './BackToTop'
import { QuickNoteModal } from '../timeline/QuickNoteModal'
import type { ReactNode } from 'react'

interface NavItem {
  to: string
  label: string
  icon: string
}

/** 导航平铺（去掉分组标题，减少层级干扰，功能本身即入口）。
 *  需求调整：统一顺序 = 云笺 / 灵感笔记 / 日常 / 文章 / 目标 / 分类标签 / 检索 / 记账本 / 设置。 */
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '云笺', icon: 'home' },
  { to: '/notes', label: '灵感笔记', icon: 'book' },
  { to: '/daily', label: '日常', icon: 'flame' },
  { to: '/posts', label: '文章', icon: 'file' },
  { to: '/goals-home', label: '目标', icon: 'target' },
  { to: '/organize', label: '分类标签', icon: 'grid' },
  { to: '/search', label: '检索', icon: 'search' },
  { to: '/ledger', label: '记账本', icon: 'wallet' },
  { to: '/settings', label: '设置', icon: 'setting' },
]

type SbMode = 'pinned' | 'collapsed'
const SB_KEY = 'cl_sidebar'
const NARROW_W = 1240 // 小于该宽度自动降级为图标轨道

export function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation()
  const { user } = useAuth()
  const inLogin = loc.pathname === '/login'

  // ---- 需求 3：侧边栏默认折叠；仅当用户在设置中主动选择「展开」后持久保持展开 ----
  const [mode, setMode] = useState<SbMode>(() => {
    const v = localStorage.getItem(SB_KEY)
    if (v === 'pinned' || v === 'collapsed') return v
    return 'collapsed' // 未设置过偏好 → 默认折叠
  })
  const [narrow, setNarrow] = useState(window.innerWidth < NARROW_W)
  const [peek, setPeek] = useState(false)
  const enterTimer = useRef<number | undefined>(undefined)
  const leaveTimer = useRef<number | undefined>(undefined)

  const effective = narrow ? 'collapsed' : mode

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
    closedAt.current = performance.now()
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

  // 悬停抽屉：进入 80ms 延迟（hover intent）/ 离开 350ms 延迟（防抖）
  // closedAt：程序化收起（点击导航/切换模式）的时刻——指针停在轨道上会因抽屉滑走而触发
  // 一次“凭空”的 mouseenter，450ms 抑制窗口避免关了又弹
  const closedAt = useRef(0)
  const closePeek = useCallback(() => {
    closedAt.current = performance.now()
    setPeek(false)
  }, [])
  const startPeek = () => {
    clearTimeout(leaveTimer.current)
    if (peek || performance.now() - closedAt.current < 450) return
    enterTimer.current = window.setTimeout(() => setPeek(true), 80)
  }
  const stopPeek = () => {
    clearTimeout(enterTimer.current)
    leaveTimer.current = window.setTimeout(() => setPeek(false), 350)
  }
  /** 指针移入抽屉：取消待执行的收起（抽屉滑入盖住轨道时，轨道会先收到 mouseleave） */
  const keepPeek = () => { clearTimeout(leaveTimer.current) }

  const nav = useMemo(
    () => (
      <nav className="nav" aria-label="主导航">
        {NAV_ITEMS.map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.to === '/'}
            title={it.label}
            className={({ isActive }) => `navi ${isActive ? 'active' : ''}`}
            onClick={closePeek}
          >
            <Icon name={it.icon} />
            <span>{it.label}</span>
          </NavLink>
        ))}
      </nav>
    ),
    [],
  )

  if (inLogin) return <>{children}</>

  return (
    <div className={`wb-layout ${effective}`}>
      <FxEngine />
      <aside
        className={`sidebar ${effective}`}
        onMouseEnter={effective === 'collapsed' ? startPeek : undefined}
        onMouseLeave={effective === 'collapsed' ? stopPeek : undefined}
      >
        <div className="brand" title="云笺集">
          <h1>云笺集</h1>
        </div>
        {nav}
        <div className="sb-ctrl">
          <button className="sb-toggle" onClick={toggleMode} aria-expanded={effective === 'pinned'}
            title={effective === 'pinned' ? '折叠侧边栏（⌘/Ctrl + B）' : '展开侧边栏（⌘/Ctrl + B）'}>
            <Icon name={effective === 'pinned' ? 'panelFold' : 'panel'} size={17} />
          </button>
          <span className="sb-hotkey">⌘B</span>
        </div>
        <div className="foot">
          {user ? (
            <AvatarMenu size={effective === 'pinned' ? 'lg' : 'sm'} align="left" />
          ) : (
            <NavLink to="/login" className="foot-login">登录账户</NavLink>
          )}
        </div>
      </aside>
      {/* 悬停抽屉：折叠态的整块展开浮层（始终挂载，靠 CSS 隐现）。
          仅动画 transform，由合成器线程执行——不触发 width 重排，重页面下也不掉帧 */}
      <aside
        className={`sidebar sb-drawer${peek ? ' open' : ''}`}
        aria-hidden={!peek}
        onMouseEnter={keepPeek}
        onMouseLeave={stopPeek}
      >
        <div className="brand" title="云笺集">
          <h1>云笺集</h1>
        </div>
        {nav}
        <div className="sb-ctrl">
          <button className="sb-toggle" onClick={toggleMode} aria-expanded={effective === 'pinned'}
            title="固定展开侧边栏（⌘/Ctrl + B）">
            <Icon name="panel" size={17} />
          </button>
          <span className="sb-hotkey">⌘B</span>
          {peek && <span className="sb-peek-hint">移出自动收起</span>}
        </div>
        <div className="foot">
          {user ? (
            <AvatarMenu size="lg" align="left" />
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
      {/* 速记：全局可用（任意页面 ⚡ 按钮唤起，Ctrl/⌘+N 快捷键） */}
      <QuickNoteModal />
    </div>
  )
}