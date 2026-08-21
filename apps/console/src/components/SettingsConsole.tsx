/**
 * 设置控制台主界面（§9）：六组设置（外观/布局/内容/阅读/交互/系统）。
 * 原则：只调参不编辑内容；改动写 SiteSetting.value(JSON) 按组持久化；
 * 保存后异步触发 build（§6.3），此处轮询构建状态展示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  api,
  type SiteSettings,
  type SettingsGroup,
  type MonitorInfo,
  type AuditItem,
} from '../api'
import { useAuth } from '../auth'

type Tab = SettingsGroup | 'system'

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: 'appearance', label: '外观', desc: '主题预设 · 强调色 · 玻璃模糊 · 动画' },
  { id: 'layout', label: '布局', desc: '首页模块排序/显隐 · 卡片密度 · 侧栏位置' },
  { id: 'content', label: '内容', desc: '博客/知识库开关 · 导航项 · 每页数量' },
  { id: 'reading', label: '阅读', desc: 'TOC · 阅读时长 · 代码主题 · 相关推荐' },
  { id: 'interaction', label: '交互', desc: '搜索范围 · ⌘K · 平滑滚动 · SEO' },
  { id: 'system', label: '系统', desc: '监控 · 审计日志 · 账户/2FA' },
]

const DEFAULTS: Required<SiteSettings> = {
  appearance: {
    theme: 'deepspace',
    accentColor: '#ff6b4a',
    glassBlur: 8,
    animations: true,
    fxBackground: true,
    fxReveal: true,
    fxGlow: true,
  },
  layout: {
    modules: [
      { id: 'hero', title: '首页主视觉', visible: true },
      { id: 'latest', title: '最新文章', visible: true },
      { id: 'featured', title: '精选', visible: true },
      { id: 'tagcloud', title: '标签云', visible: true },
      { id: 'timeline', title: '时间线', visible: true },
    ],
    density: 'comfortable',
    sidebarPos: 'left',
  },
  content: {
    blogEnabled: true,
    kbEnabled: true,
    pageSize: 10,
    navItems: [
      { name: '首页', link: '/' },
      { name: '归档', link: '/archives/' },
      { name: '关于', link: '/about/' },
    ],
  },
  reading: {
    toc: true,
    tocDepth: 3,
    readTime: true,
    codeTheme: 'github-dark',
    related: true,
    prevnext: true,
  },
  interaction: {
    searchScope: 'all',
    cmdk: true,
    smoothScroll: 60,
    rss: true,
    sitemap: true,
    seoTitle: '%s · 云笺集',
    seoDesc: '科幻数字花园：博客 · 知识库 · 技术文档',
  },
}

type BuildState = { text: string; ok: boolean } | null

export function SettingsConsole() {
  const { user, logout } = useAuth()
  const [tab, setTab] = useState<Tab>('appearance')
  const [settings, setSettings] = useState<Required<SiteSettings>>(DEFAULTS)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [build, setBuild] = useState<BuildState>(null)
  const buildTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api
      .get<SiteSettings>('/settings')
      .then((s) => setSettings({ ...DEFAULTS, ...s, appearance: { ...DEFAULTS.appearance, ...s.appearance }, layout: { ...DEFAULTS.layout, ...s.layout }, content: { ...DEFAULTS.content, ...s.content }, reading: { ...DEFAULTS.reading, ...s.reading }, interaction: { ...DEFAULTS.interaction, ...s.interaction } }))
      .catch(() => {})
  }, [])

  useEffect(() => () => { if (buildTimer.current) clearInterval(buildTimer.current) }, [])

  const patch = (group: SettingsGroup, p: Record<string, unknown>) => {
    setSettings((prev) => ({ ...prev, [group]: { ...prev[group], ...p } }) as Required<SiteSettings>)
    setDirty(true)
    setBuild(null)
  }

  /** 轮询构建状态（§6.3：queued/running → success/failed） */
  const watchBuild = (buildId: string) => {
    if (buildTimer.current) clearInterval(buildTimer.current)
    setBuild({ text: `构建中 ${buildId.slice(0, 8)}…`, ok: true })
    const t = setInterval(async () => {
      try {
        const j = await api.get<{ id: string; status: string }>(`/build/${buildId}`)
        if (j.status === 'success') {
          setBuild({ text: '构建成功，前台已更新', ok: true })
          clearInterval(t!)
          buildTimer.current = null
        } else if (j.status === 'failed') {
          setBuild({ text: '构建失败（保留上一版产物）', ok: false })
          clearInterval(t!)
          buildTimer.current = null
        }
      } catch {
        clearInterval(t!)
        buildTimer.current = null
      }
    }, 1500)
    buildTimer.current = t
  }

  const save = useCallback(async () => {
    if (tab === 'system') return
    setSaving(true)
    try {
      const r = await api.put<{ ok: boolean; buildId: string }>('/settings', {
        [tab]: settings[tab],
      })
      setDirty(false)
      if (r.buildId) watchBuild(r.buildId)
    } catch (e) {
      setBuild({ text: e instanceof Error ? e.message : String(e), ok: false })
    } finally {
      setSaving(false)
    }
  }, [tab, settings])

  return (
    <div className="console" data-zone="write">
      <header className="topbar">
        <div className="brand">
          云笺集 <span className="brand-sub">设置控制台</span>
        </div>
        <div className="spacer" />
        {build && <span className={`build-state ${build.ok ? 'ok' : 'bad'}`}>{build.text}</span>}
        <span className="user-chip">{user?.email}</span>
        <button className="btn" onClick={logout}>退出</button>
      </header>

      <div className="console-body">
        <nav className="console-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              <span className="nav-label">{t.label}</span>
              <span className="nav-desc">{t.desc}</span>
            </button>
          ))}
        </nav>

        <main className="console-main">
          {tab === 'appearance' && <AppearancePanel value={settings.appearance} patch={(p) => patch('appearance', p)} />}
          {tab === 'layout' && <LayoutPanel value={settings.layout} patch={(p) => patch('layout', p)} />}
          {tab === 'content' && <ContentPanel value={settings.content} patch={(p) => patch('content', p)} />}
          {tab === 'reading' && <ReadingPanel value={settings.reading} patch={(p) => patch('reading', p)} />}
          {tab === 'interaction' && <InteractionPanel value={settings.interaction} patch={(p) => patch('interaction', p)} />}
          {tab === 'system' && <SystemPanel />}

          {tab !== 'system' && (
            <div className="save-bar">
              <span className="dirty-hint">{dirty ? '有未保存的改动' : '已同步'}</span>
              <button className="btn primary" disabled={saving || !dirty} onClick={save}>
                {saving ? '保存中…' : '保存并触发构建'}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

/* ========== 通用控件 ========== */

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint && <span className="row-hint">{hint}</span>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  )
}

/* ========== 外观（§9 appearance.*） ========== */

function AppearancePanel({
  value,
  patch,
}: {
  value: Required<SiteSettings>['appearance']
  patch: (p: Partial<Required<SiteSettings>['appearance']>) => void
}) {
  return (
    <>
      <Row label="主题预设" hint="控制前台全局基调">
        <select value={value.theme} onChange={(e) => patch({ theme: e.target.value as typeof value.theme })}>
          <option value="deepspace">深空</option>
          <option value="aurora">极光</option>
          <option value="cyber">赛博</option>
        </select>
      </Row>
      <Row label="强调色" hint="前台 CSS 变量 --accent2">
        <input type="color" value={value.accentColor} onChange={(e) => patch({ accentColor: e.target.value })} />
        <code className="color-code">{value.accentColor}</code>
      </Row>
      <Row label="玻璃模糊强度" hint={`backdrop-filter ${value.glassBlur}px`}>
        <input type="range" min={0} max={24} value={value.glassBlur} onChange={(e) => patch({ glassBlur: Number(e.target.value) })} />
      </Row>
      <Row label="动画总开关" hint="关闭后前台无过渡动效">
        <input type="checkbox" checked={value.animations} onChange={(e) => patch({ animations: e.target.checked })} />
      </Row>
      <Row label="背景动画" hint="星云流动（display 区）">
        <input type="checkbox" checked={value.fxBackground} disabled={!value.animations} onChange={(e) => patch({ fxBackground: e.target.checked })} />
      </Row>
      <Row label="滚动揭示" hint="元素进场动效">
        <input type="checkbox" checked={value.fxReveal} disabled={!value.animations} onChange={(e) => patch({ fxReveal: e.target.checked })} />
      </Row>
      <Row label="辉光特效" hint="Bloom / 霓虹光晕">
        <input type="checkbox" checked={value.fxGlow} disabled={!value.animations} onChange={(e) => patch({ fxGlow: e.target.checked })} />
      </Row>
    </>
  )
}

/* ========== 布局（§9 layout.*） ========== */

function LayoutPanel({
  value,
  patch,
}: {
  value: Required<SiteSettings>['layout']
  patch: (p: Partial<Required<SiteSettings>['layout']>) => void
}) {
  const move = (i: number, dir: -1 | 1) => {
    const modules = [...value.modules]
    const j = i + dir
    if (j < 0 || j >= modules.length) return
    ;[modules[i], modules[j]] = [modules[j], modules[i]]
    patch({ modules })
  }
  const setModule = (i: number, p: Partial<{ title: string; visible: boolean }>) => {
    const modules = value.modules.map((m, k) => (k === i ? { ...m, ...p } : m))
    patch({ modules })
  }
  return (
    <>
      <div className="section-title">首页模块（拖拽排序 → 用上下移按钮）</div>
      {value.modules.map((m, i) => (
        <div key={m.id} className="module-row">
          <code className="module-id">{m.id}</code>
          <input
            className="module-title"
            value={m.title}
            onChange={(e) => setModule(i, { title: e.target.value })}
          />
          <label className="module-vis">
            <input type="checkbox" checked={m.visible} onChange={(e) => setModule(i, { visible: e.target.checked })} />
            显示
          </label>
          <button className="btn slim" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button className="btn slim" disabled={i === value.modules.length - 1} onClick={() => move(i, 1)}>↓</button>
        </div>
      ))}
      <Row label="卡片密度" hint="首页/列表卡片留白">
        <select value={value.density} onChange={(e) => patch({ density: e.target.value as typeof value.density })}>
          <option value="comfortable">宽松</option>
          <option value="compact">紧凑</option>
        </select>
      </Row>
      <Row label="侧栏位置" hint="文章页 TOC 侧栏">
        <select value={value.sidebarPos} onChange={(e) => patch({ sidebarPos: e.target.value as typeof value.sidebarPos })}>
          <option value="left">左侧</option>
          <option value="right">右侧</option>
        </select>
      </Row>
    </>
  )
}

/* ========== 内容（§9 content.*） ========== */

function ContentPanel({
  value,
  patch,
}: {
  value: Required<SiteSettings>['content']
  patch: (p: Partial<Required<SiteSettings>['content']>) => void
}) {
  const setNav = (i: number, p: Partial<{ name: string; link: string }>) =>
    patch({ navItems: value.navItems.map((n, k) => (k === i ? { ...n, ...p } : n)) })
  return (
    <>
      <Row label="博客" hint="公开站点博客入口">
        <input type="checkbox" checked={value.blogEnabled} onChange={(e) => patch({ blogEnabled: e.target.checked })} />
      </Row>
      <Row label="知识库" hint="文件夹树浏览入口">
        <input type="checkbox" checked={value.kbEnabled} onChange={(e) => patch({ kbEnabled: e.target.checked })} />
      </Row>
      <Row label="每页数量" hint="列表分页大小">
        <input
          type="number"
          min={1}
          max={50}
          value={value.pageSize}
          onChange={(e) => patch({ pageSize: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
        />
      </Row>
      <div className="section-title">导航项</div>
      {value.navItems.map((n, i) => (
        <div key={i} className="module-row">
          <input className="module-title" value={n.name} placeholder="名称" onChange={(e) => setNav(i, { name: e.target.value })} />
          <input className="module-title" value={n.link} placeholder="/link" onChange={(e) => setNav(i, { link: e.target.value })} />
          <button
            className="btn slim"
            onClick={() => patch({ navItems: value.navItems.filter((_, k) => k !== i) })}
          >
            删除
          </button>
        </div>
      ))}
      <button className="btn slim" onClick={() => patch({ navItems: [...value.navItems, { name: '新导航', link: '/' }] })}>
        + 新增导航项
      </button>
    </>
  )
}

/* ========== 阅读（§9 reading.*） ========== */

function ReadingPanel({
  value,
  patch,
}: {
  value: Required<SiteSettings>['reading']
  patch: (p: Partial<Required<SiteSettings>['reading']>) => void
}) {
  return (
    <>
      <Row label="目录（TOC）" hint="阅读舱侧边目录">
        <input type="checkbox" checked={value.toc} onChange={(e) => patch({ toc: e.target.checked })} />
      </Row>
      <Row label="目录层级" hint="h1 ~ hN">
        <input
          type="number"
          min={1}
          max={4}
          value={value.tocDepth}
          onChange={(e) => patch({ tocDepth: Math.max(1, Math.min(4, Number(e.target.value) || 3)) })}
        />
      </Row>
      <Row label="阅读时长" hint="按字数估算">
        <input type="checkbox" checked={value.readTime} onChange={(e) => patch({ readTime: e.target.checked })} />
      </Row>
      <Row label="代码块主题" hint="Shiki 辉光主题">
        <select value={value.codeTheme} onChange={(e) => patch({ codeTheme: e.target.value })}>
          <option value="github-dark">github-dark</option>
          <option value="one-dark-pro">one-dark-pro</option>
          <option value="aurora-x">aurora-x</option>
          <option value="catppuccin-mocha">catppuccin-mocha</option>
        </select>
      </Row>
      <Row label="相关推荐" hint="按标签/反链">
        <input type="checkbox" checked={value.related} onChange={(e) => patch({ related: e.target.checked })} />
      </Row>
      <Row label="上下篇导航" hint="系列连续翻页">
        <input type="checkbox" checked={value.prevnext} onChange={(e) => patch({ prevnext: e.target.checked })} />
      </Row>
    </>
  )
}

/* ========== 交互（§9 interaction.*） ========== */

function InteractionPanel({
  value,
  patch,
}: {
  value: Required<SiteSettings>['interaction']
  patch: (p: Partial<Required<SiteSettings>['interaction']>) => void
}) {
  return (
    <>
      <Row label="搜索范围" hint="⌘K 检索的内容域">
        <select value={value.searchScope} onChange={(e) => patch({ searchScope: e.target.value as typeof value.searchScope })}>
          <option value="all">全站</option>
          <option value="blog">仅博客</option>
          <option value="note">仅笔记</option>
        </select>
      </Row>
      <Row label="⌘K 命令面板" hint="关闭后前台无 ⌘K 入口">
        <input type="checkbox" checked={value.cmdk} onChange={(e) => patch({ cmdk: e.target.checked })} />
      </Row>
      <Row label="平滑滚动强度" hint={`Lenis ${value.smoothScroll}%`}>
        <input type="range" min={0} max={100} value={value.smoothScroll} onChange={(e) => patch({ smoothScroll: Number(e.target.value) })} />
      </Row>
      <Row label="RSS" hint="/rss.xml">
        <input type="checkbox" checked={value.rss} onChange={(e) => patch({ rss: e.target.checked })} />
      </Row>
      <Row label="Sitemap" hint="/sitemap-index.xml">
        <input type="checkbox" checked={value.sitemap} onChange={(e) => patch({ sitemap: e.target.checked })} />
      </Row>
      <Row label="SEO 标题模板" hint="%s 会被页名替换">
        <input type="text" value={value.seoTitle} onChange={(e) => patch({ seoTitle: e.target.value })} />
      </Row>
      <Row label="SEO 描述">
        <input type="text" value={value.seoDesc} onChange={(e) => patch({ seoDesc: e.target.value })} />
      </Row>
    </>
  )
}

/* ========== 系统（§9 system.*：monitor/audit/账户） ========== */

function SystemPanel() {
  const { user } = useAuth()
  const [mon, setMon] = useState<MonitorInfo | null>(null)
  const [audit, setAudit] = useState<AuditItem[]>([])

  useEffect(() => {
    api.get<MonitorInfo>('/monitor').then(setMon).catch(() => {})
    api.get<{ items: AuditItem[] }>('/audit?size=20').then((r) => setAudit(r.items)).catch(() => {})
  }, [])

  const uptime = mon ? formatUptime(mon.uptime) : '—'
  return (
    <>
      <div className="section-title">监控</div>
      <div className="stat-grid">
        <Stat label="运行时长" value={uptime} />
        <Stat label="内存" value={mon ? `${mon.memoryMB} MB` : '—'} />
        <Stat label="文章总数" value={mon ? String(mon.posts.total) : '—'} />
        <Stat label="已发布" value={mon ? String(mon.posts.published) : '—'} />
        <Stat label="草稿" value={mon ? String(mon.posts.drafts) : '—'} />
        <Stat label="活跃会话" value={mon ? String(mon.activeSessions) : '—'} />
      </div>

      <div className="section-title">账户</div>
      <Row label="邮箱"><code>{user?.email}</code></Row>
      <Row label="角色"><code>{user?.role}</code></Row>
      <Row label="两步验证（TOTP）">
        <span className={user?.totpEnabled ? 'ok-text' : 'warn-text'}>
          {user?.totpEnabled ? '已启用' : '未启用'}
        </span>
      </Row>

      <div className="section-title">备份与回滚（§11）</div>
      <BackupPanel />

      <div className="section-title">最近审计日志</div>
      <div className="audit-list">
        {audit.length === 0 && <div className="empty">暂无记录</div>}
        {audit.map((a) => (
          <div key={a.id} className="audit-row">
            <code className="audit-action">{a.action}</code>
            <span className="audit-user">{a.user?.email ?? '—'}</span>
            <span className="audit-time">{new Date(a.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

/* ========== 备份 / 回滚（§11） ========== */

interface BackupItem {
  name: string
  size: number
  createdAt: string
}

function BackupPanel() {
  const [items, setItems] = useState<BackupItem[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => {
    api.get<{ items: BackupItem[] }>('/backup').then((r) => setItems(r.items)).catch(() => {})
  }
  useEffect(load, [])

  const create = async () => {
    setBusy(true)
    setMsg('')
    try {
      const r = await api.post<{ name: string; size: number }>('/backup')
      setMsg(`已创建备份 ${r.name}（${(r.size / 1024).toFixed(1)} KB）`)
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const rollback = async (name: string) => {
    if (!window.confirm(`回滚到 ${name}？当前状态会先自动备份一份。回滚后需重启服务生效。`)) return
    setBusy(true)
    setMsg('')
    try {
      const r = await api.post<{ needRestart: boolean; safety: string }>(`/backup/${name}/rollback`)
      setMsg(`已回滚（回滚前快照：${r.safety}）。${r.needRestart ? '请重启服务使变更生效。' : ''}`)
      load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="backup-panel">
      <div className="backup-actions">
        <button className="btn primary" disabled={busy} onClick={create}>
          {busy ? '处理中…' : '立即备份'}
        </button>
        <span className="backup-hint">自动保留最近 7 份</span>
      </div>
      {msg && <div className="backup-msg">{msg}</div>}
      <div className="backup-list">
        {items.length === 0 && <div className="empty">暂无备份</div>}
        {items.map((b) => (
          <div key={b.name} className="backup-row">
            <code className="backup-name">{b.name}</code>
            <span className="backup-meta">{(b.size / 1024).toFixed(1)} KB · {new Date(b.createdAt).toLocaleString()}</span>
            <button className="btn slim" disabled={busy} onClick={() => rollback(b.name)}>
              回滚
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d}天${h}时${m}分` : h > 0 ? `${h}时${m}分` : `${m}分`
}
