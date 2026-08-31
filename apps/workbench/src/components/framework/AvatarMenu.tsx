/**
 * 框架层 · 头像菜单（需求 3）：个人中心浮层，一次点击聚合 账号/状态/通知/设置/写作空间/退出。
 * - 锚定触发按钮，视口不足自动上翻；Esc / 外部点击 / 路由切换 / 再点头像 关闭
 * - 键盘导航 ↑/↓/Enter/Esc + 焦点陷阱；打开时焦点落首个可交互项
 * - 未登录态收敛为「登录」占位
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth'
import { Icon } from './Icon'
import { confirmDialog } from './Modal'

export type Presence = 'online' | 'busy' | 'away' | 'invisible'
const PRESENCE: { id: Presence; label: string; color: string }[] = [
  { id: 'online', label: '在线', color: 'var(--ok)' },
  { id: 'busy', label: '忙碌', color: 'var(--danger)' },
  { id: 'away', label: '离开', color: 'var(--warn)' },
  { id: 'invisible', label: '隐身', color: 'var(--text-tertiary)' },
]
const PRES = (id: Presence) => PRESENCE.find((p) => p.id === id) ?? PRESENCE[0]

export function AvatarMenu({ size = 'lg', align = 'right', badge }: { size?: 'lg' | 'sm'; align?: 'left' | 'right'; badge?: string }) {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const [presence, setPresence] = useState<Presence>(() => (localStorage.getItem('cl_status') as Presence) || 'online')
  const boxRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const idxRef = useRef(0)

  async function logoutAll() {
    const ok = await confirmDialog({
      title: '退出登录',
      type: 'warning',
      description: '仅退出当前会话，本地数据（文章 / 计划 / 记账）全部保留。',
      confirmText: '退出',
    })
    if (!ok) return
    await logout()
    window.location.reload()
  }

  /** 菜单项集合：用于键盘导航与渲染（logout 单独放底部区） */
  const ITEMS: { id: string; label: string; icon: string; danger?: boolean; hint?: string; run: () => void }[] = [
    { id: 'account', label: '设置 · 账户', icon: 'user', hint: '我是谁 / 订阅 / 数据', run: () => nav('/settings') },
    { id: 'write', label: '写文章', icon: 'pen', hint: '文章列表与编辑', run: () => nav('/posts') },
    { id: 'console', label: '站点设置', icon: 'chart', hint: '外观 / 站点', run: () => nav('/settings?g=site') },
    { id: 'settings', label: '偏好设置', icon: 'setting', hint: '外观 / 语言', run: () => nav('/settings?g=prefs') },
    { id: 'shortcuts', label: '快捷键速查', icon: 'bolt', hint: '⌘ / Ctrl', run: () => nav('/settings?g=shortcuts') },
    { id: 'logout', label: '退出登录', icon: 'log', danger: true, hint: '保留数据', run: () => logoutAll() },
  ]

  const avatar = (user?.nickname?.trim() || user?.email?.slice(0, 1) || '云').slice(0, 1).toUpperCase()
  const pcol = PRES(presence).color

  const close = () => setOpen(false)
  const toggle = () => setOpen((o) => !o)

  /** Tab 焦点循环：仅在菜单内循环 */
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const el = menuRef.current
    if (!el) return
    const list = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled)'))
    if (!list.length) return
    const first = list[0]
    const last = list[list.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      menuRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
      // 视口不足自动上翻
      const m = menuRef.current
      if (m) {
        const r = m.getBoundingClientRect()
        setFlip(r.bottom > window.innerHeight - 12)
      }
    }, 40)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); return }
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
      e.preventDefault()
      const el = menuRef.current
      if (!el) return
      const list = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled)'))
      if (!list.length) return
      const d = e.key === 'ArrowDown' ? 1 : -1
      idxRef.current = (idxRef.current + d + list.length) % list.length
      list[idxRef.current].focus()
    }
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onScroll = () => setOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDoc)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDoc)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  // 路由切换即关闭
  useEffect(() => { setOpen(false) }, [loc.pathname])

  if (!user) {
    return (
      <div className={`am ${size}`}>
        <button className="avatar-trigger g" onClick={() => nav('/login')} aria-label="登录账户">
          <span className="ag-avatar">〈</span>
        </button>
      </div>
    )
  }

  return (
    <div className={`am ${size}`} ref={boxRef}>
      <button
        className={`avatar-trigger ${size}${open ? ' on' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="个人中心菜单"
      >
        <span className="ag-avatar">
          {avatar}
          <i className="ag-presence" style={{ background: pcol }} />
          {badge && <i className="ag-lv">{badge}</i>}
        </span>
        {size === 'lg' && (
          <span className="ag-tx">
            <b>{user.nickname || '未设置昵称'}</b>
            <em>{user.email}</em>
          </span>
        )}
        {size === 'lg' && (
          <span className={`ag-chev${open ? ' up' : ''}`}><Icon name="chev" size={14} /></span>
        )}
      </button>

      {open && (
        <div
          className={`am-menu ${align}${flip ? ' up' : ''}`}
          ref={menuRef}
          role="menu"
          aria-label="个人中心"
          onKeyDown={onMenuKey}
        >
          {/* 账号区 */}
          <button role="menuitem" className="am-head" onClick={() => { close(); nav('/settings') }}>
            <span className="am-h-av">{avatar}<i style={{ background: pcol }} /></span>
            <span className="am-h-tx">
              <b>{user.nickname || '未设置昵称'}</b>
              <em>{user.email}</em>
              <span className="am-h-sub">点击进入 设置 → 账户</span>
            </span>
          </button>

          {/* 状态切换 */}
          <div className="am-sec">
            <div className="am-sec-label">状态<em className="am-num">{PRES(presence).label}</em></div>
            <div className="am-status-grid">
              {PRESENCE.map((p) => (
                <button
                  key={p.id}
                  role="menuitemradio"
                  aria-checked={presence === p.id}
                  className={`am-st${presence === p.id ? ' on' : ''}`}
                  style={{ ['--pcol' as string]: p.color }}
                  onClick={() => { setPresence(p.id); localStorage.setItem('cl_status', p.id) }}
                >
                  <i />{p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 通知（后端未接通知中心，空态引导） */}
          <div className="am-sec">
            <div className="am-sec-label">通知<em className="am-num">0 未读</em></div>
            <div className="am-notify-empty">
              <span className="am-bell"><Icon name="bell" size={16} /></span>
              暂无新通知 · 通知中心为预留能力
            </div>
          </div>

          {/* 快捷入口 */}
          <div className="am-sec">
            {ITEMS.filter((i) => i.id !== 'logout').map((it) => (
              <button
                key={it.id}
                role="menuitem"
                className="am-item"
                onClick={() => { close(); it.run() }}
              >
                <Icon name={it.icon} size={15} />
                <span>{it.label}</span>
                {it.hint && <em className="am-hint">{it.hint}</em>}
              </button>
            ))}
          </div>

          {/* 退出 */}
          <div className="am-foot">
            <button role="menuitem" className="am-item danger" onClick={() => { close(); logoutAll() }}>
              <Icon name="log" size={15} />
              <span>退出登录</span>
              <em className="am-hint">保留数据</em>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}