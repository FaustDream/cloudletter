/**
 * 设置中心（行式布局）：每个分组 = 全宽分区，每行 = 标签 + 说明 + 控件。
 * 新增设置项 = 追加一行，不引发布局重排。全部控件真实生效：
 * - 主题（亮/暗/跟随系统）、密度（标准/紧凑）→ 全局 CSS 变量切换
 * - 默认页面/默认视图 → 登录跳转与时间线初始渲染
 * - 通知 → 浏览器 Notification 真实申请与测试
 * - 两步验证 → 服务端 TOTP（二维码 + 动态码确认/关闭）
 * - 修改邮箱 → /auth/email（密码校验 + 撤销其他会话）
 * - 修改密码 / 数据导出 / 站点设置 / 清理缓存 均为真实接口
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { useAuth } from '../auth'
import { Icon } from '../components/framework/Icon'
import { Modal, Field } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { CAPSULE_THEMES, readTheme, writeTheme, listDayThemes, writeDayTheme, removeDayTheme, clearDayThemes, themeLabel, LAYOUT_THEMES, readLayoutTheme, writeLayoutTheme, POMODORO_THEMES, type ThemeVariant } from '../lib/componentTheme'
import { Capsule } from '../components/framework/Capsule'
import { readPomodoroPrefs, writePomodoroPref, type PomodoroPrefs, type PomodoroKey } from '../lib/pomodoro'
import { api } from '../api'
import { applyDensity, applyTheme, type DensityPref, type ThemePref } from '../lib/theme'
import { timelineLayout, setTimelineLayout, type TimelineLayout } from '../lib/layout'
import { noteStyle as readNoteStyle, setNoteStyle as persistNoteStyle, type NoteStyle } from '../lib/layout'
import { todayYMD } from '../lib/date'
import { Dropdown } from '../components/framework/Dropdown'

type GroupId = 'account' | 'prefs' | 'site' | 'notify' | 'privacy' | 'shortcuts' | 'data' | 'integrations' | 'about'

const GROUPS: { id: GroupId; label: string; icon: string; desc: string }[] = [
  { id: 'account', label: '账户', icon: 'user', desc: '资料、邮箱、密码与两步验证' },
  { id: 'prefs', label: '偏好', icon: 'setting', desc: '主题、密度、默认入口' },
  { id: 'site', label: '站点设置', icon: 'server', desc: '博客外观与内容目录（原控制台）' },
  { id: 'notify', label: '通知', icon: 'bell', desc: '浏览器通知与提醒测试' },
  { id: 'privacy', label: '隐私与安全', icon: 'shield', desc: '可见性默认值、活动日志与导出' },
  { id: 'shortcuts', label: '快捷键', icon: 'bolt', desc: '全局快捷键一览' },
  { id: 'data', label: '数据与存储', icon: 'database', desc: '缓存、导入导出与真相源' },
  { id: 'integrations', label: '集成与连接', icon: 'link', desc: 'SMTP 与开放能力状态' },
  { id: 'about', label: '关于', icon: 'help', desc: '版本、更新日志与条款' },
]

const SHORTCUTS: { keys: string; name: string; desc: string }[] = [
  { keys: 'Ctrl/⌘ + N', name: '速记弹窗', desc: '总览页：居中速记（类型 / 内容 / 标签）' },
  { keys: 'Ctrl/⌘ + ⇧ + N', name: '捕捉灵感', desc: '任意页面：灵感抽屉' },
  { keys: 'Ctrl/⌘ + B', name: '侧边栏折叠 / 展开', desc: '任意页面：切换常驻展开与图标轨道' },
  { keys: 'Ctrl/⌘ + S', name: '保存文章', desc: '编辑页：立即保存当前文章' },
  { keys: 'Esc', name: '关闭弹层', desc: '速记弹窗、头像菜单、详情展开' },
]

/** 分区：全宽，标题 + 行列表 */
function Sec({ icon, title, desc, children, danger }: { icon: string; title: string; desc?: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <section className={`set-sec${danger ? ' danger' : ''}`}>
      <div className="set-sec-h"><Icon name={icon} size={15} /> {title}{desc && <em>{desc}</em>}</div>
      <div className="set-sec-body">{children}</div>
    </section>
  )
}

/** 行：左侧标签+说明，右侧控件 */
function Row({ k, desc, children }: { k: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-k"><b>{k}</b>{desc && <span className="dim">{desc}</span>}</div>
      <div className="set-row-v">{children}</div>
    </div>
  )
}

export function SettingsPage() {
  const { user, logout, updateProfile } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [sp, setSp] = useSearchParams()

  const g = (sp.get('g') as GroupId) || 'account'
  const setG = (id: GroupId) => setSp({ g: id }, { replace: true })
  const active = GROUPS.find((x) => x.id === g) ?? GROUPS[0]
  const contentRef = useRef<HTMLDivElement>(null)

  // ── 账户 ──
  const [nick, setNick] = useState(user?.nickname ?? '')
  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  // 改邮箱
  const [emailOpen, setEmailOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPwd, setEmailPwd] = useState('')
  // 两步验证
  const [tfaStatus, setTfaStatus] = useState<{ enabled: boolean; pending: boolean } | null>(null)
  const [tfaOpen, setTfaOpen] = useState(false)
  const [tfaQr, setTfaQr] = useState('')
  const [tfaSecret, setTfaSecret] = useState('')
  const [tfaToken, setTfaToken] = useState('')
  const [tfaDisablePwd, setTfaDisablePwd] = useState('')

  // ── 偏好 ──
  const [theme, setTheme] = useState<ThemePref>(() => (localStorage.getItem('cl_theme') as ThemePref) || 'light')
  const [density, setDensity] = useState<DensityPref>(() => (localStorage.getItem('cl_density') as DensityPref) || 'standard')
  const [defPage, setDefPage] = useState(localStorage.getItem('cl_default_page') || '/')
  const [defView, setDefView] = useState(localStorage.getItem('cl_default_view') || 'timeline')
  const [dateFmt, setDateFmt] = useState(localStorage.getItem('cl_date_fmt') || 'cn')
  // 显示布局偏好
  const [tlLayout, setTlLayout] = useState<TimelineLayout>(timelineLayout)
  const [noteStylePref, setNoteStylePref] = useState<NoteStyle>(readNoteStyle)
  // 组件主题偏好（骨架不变 · 样式抽离，可独立切换）
  const [capsuleTheme, setCapsuleThemeState] = useState(() => readTheme('capsule', CAPSULE_THEMES, 'glass'))
  // 日期独立主题：{ ymd: themeId }，未覆盖的日期跟随全局胶囊主题
  const [dayOverrides, setDayOverrides] = useState<Record<string, string>>(() => listDayThemes())
  const [dayPicker, setDayPicker] = useState(todayYMD())
  // 组件布局风格（骨架不变 · 样式抽离）：各区域独立一组变体
  const [layoutPrefs, setLayoutPrefs] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const g of LAYOUT_THEMES) o[g.key] = readLayoutTheme(g.key, g.variants, g.variants[0]?.id ?? '')
    return o
  })
  // 番茄专注偏好（计时引擎 react-timer-hook · 相关功能均在设置中可配）
  const [pomo, setPomo] = useState<PomodoroPrefs>(readPomodoroPrefs)
  const [pomoTheme, setPomoTheme] = useState(() => readLayoutTheme('pomodoro', POMODORO_THEMES, 'blue'))
  const savePomo = (key: PomodoroKey, value: number | boolean) => {
    writePomodoroPref(key, value)
    setPomo(readPomodoroPrefs())
    toast('番茄偏好已保存，日常页实时生效')
  }
  const savePomoTheme = (v: string) => {
    writeLayoutTheme('pomodoro', v)
    setPomoTheme(v)
    toast(`番茄主题：${themeLabel(v, POMODORO_THEMES)}`)
  }

  // ── 通知 ──
  const [notifyState, setNotifyState] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  )

  // ── 隐私 / 数据 ──
  const [vis, setVis] = useState(localStorage.getItem('cl_visibility_default') || 'private')
  const [exporting, setExporting] = useState(false)

  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [g])

  if (!user) {
    nav('/login', { replace: true })
    return null
  }

  /* ── 账户操作 ── */
  const saveProfile = async () => {
    try {
      await updateProfile(nick.trim())
      toast('个人资料已保存')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }

  const changePwd = async () => {
    if (oldPwd.length < 6 || newPwd.length < 8) { toast('请填写正确密码格式（新密码至少 8 位）', 'err'); return }
    try {
      await api.post('/auth/password', { oldPassword: oldPwd, newPassword: newPwd })
      toast('密码已修改，其他会话已退出')
      setPwdOpen(false); setOldPwd(''); setNewPwd('')
    } catch (e: any) { toast(e?.message || '修改失败', 'err') }
  }

  const changeEmail = async () => {
    try {
      await api.post('/auth/email', { newEmail: newEmail.trim(), password: emailPwd })
      toast(`登录邮箱已更新为 ${newEmail.trim()}`)
      setEmailOpen(false); setNewEmail(''); setEmailPwd('')
      window.location.reload()
    } catch (e: any) { toast(e?.message || '修改失败', 'err') }
  }

  const loadTfaStatus = () => {
    api.get<{ enabled: boolean; pending: boolean }>('/auth/2fa/status')
      .then(setTfaStatus)
      .catch(() => setTfaStatus({ enabled: false, pending: false }))
  }
  useEffect(loadTfaStatus, [])

  const startTfa = async () => {
    try {
      const r = await api.post<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup')
      setTfaSecret(r.secret)
      setTfaQr(await QRCode.toDataURL(r.otpauthUrl, { width: 190, margin: 1 }))
      setTfaToken('')
      setTfaOpen(true)
    } catch (e: any) { toast(e?.message || '生成失败', 'err') }
  }
  const confirmTfa = async () => {
    try {
      await api.post('/auth/2fa/enable', { token: tfaToken.trim() })
      toast('两步验证已开启，下次登录需输入动态码')
      setTfaOpen(false)
      loadTfaStatus()
    } catch (e: any) { toast(e?.message || '验证失败', 'err') }
  }
  const disableTfa = async () => {
    if (!tfaDisablePwd || tfaToken.length !== 6) { toast('请输入密码与 6 位动态码', 'err'); return }
    try {
      await api.post('/auth/2fa/disable', { password: tfaDisablePwd, token: tfaToken.trim() })
      toast('两步验证已关闭')
      setTfaOpen(false); setTfaDisablePwd(''); setTfaToken('')
      loadTfaStatus()
    } catch (e: any) { toast(e?.message || '关闭失败', 'err') }
  }

  /* ── 偏好操作（即时生效） ── */
  const saveTheme = (v: ThemePref) => {
    setTheme(v); localStorage.setItem('cl_theme', v); applyTheme(v)
    toast(`主题已切换为${v === 'light' ? '亮色' : v === 'dark' ? '暗色' : '跟随系统'}`)
  }
  const saveDensity = (v: DensityPref) => {
    setDensity(v); localStorage.setItem('cl_density', v); applyDensity(v)
    toast(v === 'compact' ? '已切换为紧凑密度' : '已切换为标准密度')
  }
  const saveDefPage = (v: string) => { setDefPage(v); localStorage.setItem('cl_default_page', v); toast('已保存，下次登录生效') }
  const saveDefView = (v: string) => { setDefView(v); localStorage.setItem('cl_default_view', v); toast('已保存，进入时间线时生效') }
  const saveDateFmt = (v: string) => { setDateFmt(v); localStorage.setItem('cl_date_fmt', v); toast('日期格式已保存') }
  const saveTlLayout = (v: TimelineLayout) => {
    setTlLayout(v); setTimelineLayout(v)
    toast(v === 'river' ? '时间线布局：河流蜿蜒' : v === 'axis' ? '时间线布局：居中轴线' : '时间线布局：单列列表')
  }
  const saveNoteStylePref = (v: NoteStyle) => {
    setNoteStylePref(v); persistNoteStyle(v)
    toast(v === 'card' ? '灵感笔记风格：卡片网格' : v === 'list' ? '灵感笔记风格：列表行' : '灵感笔记风格：纵向时间线')
  }
  const saveCapsuleTheme = (v: string) => {
    setCapsuleThemeState(v); writeTheme('capsule', v)
    const t = CAPSULE_THEMES.find((x) => x.id === v)
    toast(`日期胶囊主题：${t?.label ?? v}`)
  }

  /* ── 日期独立主题（每个日期可覆盖全局胶囊主题） ── */
  const refreshDayThemes = () => setDayOverrides(listDayThemes())
  const dayPickerEff = dayOverrides[dayPicker] ?? capsuleTheme
  const saveDayPickerTheme = (id: string) => {
    writeDayTheme(dayPicker, id)
    refreshDayThemes()
    toast(`已为 ${dayPicker} 设置独立主题：${themeLabel(id)}`)
  }
  const resetDayPickerTheme = () => {
    removeDayTheme(dayPicker)
    refreshDayThemes()
    toast(`${dayPicker} 已恢复跟随全局主题`)
  }
  const removeDayOverride = (ymd: string) => {
    removeDayTheme(ymd)
    refreshDayThemes()
    toast(`${ymd} 已恢复跟随全局主题`)
  }
  const resetAllDayThemes = () => {
    clearDayThemes()
    setDayOverrides({})
    toast('已清空全部日期独立主题')
  }
  const saveLayoutPref = (key: string, v: string) => {
    writeLayoutTheme(key, v)
    setLayoutPrefs((p) => ({ ...p, [key]: v }))
    toast('布局风格已保存')
  }

  /* ── 通知（真实浏览器通知） ── */
  const enableNotify = async () => {
    if (typeof Notification === 'undefined') { toast('当前浏览器不支持通知', 'err'); return }
    const p = await Notification.requestPermission()
    setNotifyState(p)
    if (p === 'granted') {
      new Notification('云笺集', { body: '通知已开启 ✓ 完成任务、讨伐掉落都会在这里提醒你' })
      toast('通知已开启')
    } else toast('通知权限未授予', 'err')
  }
  const testNotify = () => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') { toast('请先开启通知权限', 'err'); return }
    new Notification('⚔️ 讨伐提醒', { body: '还有待完成的怪物，击败它们获得经验与金币！' })
  }

  /* ── 数据 ── */
  const exportData = async () => {
    setExporting(true)
    try {
      const bundle: Record<string, unknown> = {}
      for (const s of ['plan', 'checkin', 'ledger', 'goals', 'notes'] as const) {
        const r = await api.get<{ items: unknown[] }>(`/workbench/${s}`)
        bundle[s] = r.items
      }
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `cloudletter-backup-${todayYMD()}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast('数据已导出（工作台各模块）')
    } catch (e: any) { toast(e?.message || '导出失败', 'err') } finally { setExporting(false) }
  }
  const clearCache = () => {
    Object.keys(localStorage).filter((k) => k.startsWith('cl_') && k !== 'cl_token').forEach((k) => localStorage.removeItem(k))
    toast('本地偏好缓存已清理（登录态保留）')
  }

  const fmtLoginTime = (s: string | null | undefined) => s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—'

  return (
    <div className="set-page">
      <PageHeader
        title="设置"
        subtitle="全部设置真实生效 · 行式布局，随功能扩展自然增长"
        actions={<span className="acct-email-chip"><span className="dot" /> {user.email}</span>}
      />

      <div className="set-panel">
        <nav className="set-tabs" aria-label="设置分组">
          {GROUPS.map((grp) => (
            <button key={grp.id} className={`set-tab${grp.id === g ? ' on' : ''}`} onClick={() => setG(grp.id)} title={grp.desc} aria-current={grp.id === g ? 'page' : undefined}>
              <Icon name={grp.icon} size={15} /> {grp.label}
            </button>
          ))}
        </nav>

        <div className="set-content" ref={contentRef}>
          <div className="set-crumb"><Icon name={active.icon} size={14} /> {active.label}<span className="dim"> · {active.desc}</span></div>

          {g === 'account' && (
            <>
              <Sec icon="user" title="个人资料">
                <Row k="昵称" desc="头像菜单与宇宙视图显示">
                  <input type="text" value={nick} onChange={(e) => setNick(e.target.value)} placeholder="你的昵称" maxLength={30} style={{ width: 220 }} />
                  <button className="btn slim" onClick={saveProfile}>保存</button>
                </Row>
                <Row k="登录邮箱" desc="登录凭证，修改需验证密码">
                  <span>{user.email}</span>
                  <button className="btn slim ghost" onClick={() => { setNewEmail(''); setEmailPwd(''); setEmailOpen(true) }}>修改邮箱</button>
                </Row>
                <Row k="登录密码" desc="至少 8 位，修改后撤销其他会话">
                  <button className="btn slim ghost" onClick={() => setPwdOpen(true)}>修改密码</button>
                </Row>
              </Sec>

              <Sec icon="shield" title="账号与安全">
                <Row k="两步验证（TOTP）" desc="登录时需输入 Authenticator 动态码">
                  {tfaStatus?.enabled
                    ? <><span className="pill ok">已开启</span><button className="btn slim ghost" onClick={() => { setTfaOpen(true); setTfaToken(''); setTfaDisablePwd('') }}>关闭</button></>
                    : <><span className="pill warn">未开启</span><button className="btn slim" onClick={startTfa}>开启两步验证</button></>}
                </Row>
                <Row k="注册时间"><code>2026-08-08</code></Row>
                <Row k="最后登录" desc="时间 / IP / 客户端">
                  <span>{fmtLoginTime((user as any).lastLoginAt)} · IP {(user as any).lastLoginIp || '本机'} · {(user as any).lastLoginAgent || '—'}</span>
                </Row>
              </Sec>

              <Sec icon="database" title="存储空间与配额">
                <Row k="本地数据目录"><code>server/data/dev</code></Row>
                <Row k="文章真相源"><code>Markdown 文件</code></Row>
                <Row k="配额"><code>本机磁盘 · 无上限</code></Row>
              </Sec>

              <Sec icon="trash" title="退出登录" danger>
                <Row k="退出当前账户" desc="仅退出登录，保留全部数据">
                  <button className="btn slim ghost" onClick={async () => { await logout(); window.location.reload() }}>退出登录</button>
                </Row>
              </Sec>
            </>
          )}

          {g === 'prefs' && (
            <>
              <Sec icon="monitor" title="主题外观" desc="即时生效">
                <Row k="主题" desc="亮色 / 暗色 / 跟随系统（真实切换全站配色）">
                  <Dropdown
                    value={theme}
                    options={[{ value: 'light', label: '亮色' }, { value: 'dark', label: '暗色' }, { value: 'auto', label: '跟随系统' }]}
                    onChange={(v) => saveTheme(v as ThemePref)}
                  />
                </Row>
                <Row k="界面密度" desc="标准 / 紧凑（间距与圆角全局收紧）">
                  <Dropdown
                    value={density}
                    options={[{ value: 'standard', label: '标准' }, { value: 'compact', label: '紧凑' }]}
                    onChange={(v) => saveDensity(v as DensityPref)}
                  />
                </Row>
              </Sec>
              <Sec icon="columns" title="显示布局风格" desc="时光长河 / 灵感笔记 多套布局，颜色与全站设计系统一致">
                <Row k="时光长河布局" desc="气泡在轴上的排布方式（同一份数据三种渲染）">
                  <Dropdown
                    value={tlLayout}
                    options={[
                      { value: 'river', label: '🌊 河流蜿蜒（默认）' },
                      { value: 'axis', label: '｜居中轴线' },
                      { value: 'list', label: '☰ 单列列表' },
                    ]}
                    onChange={(v) => saveTlLayout(v as TimelineLayout)}
                  />
                </Row>
                <Row k="灵感笔记风格" desc="灵感卡片的组织样式">
                  <Dropdown
                    value={noteStylePref}
                    options={[
                      { value: 'card', label: '卡片网格（默认）' },
                      { value: 'list', label: '列表行' },
                      { value: 'timeline', label: '纵向时间线' },
                    ]}
                    onChange={(v) => saveNoteStylePref(v as NoteStyle)}
                  />
                </Row>
              </Sec>
              <Sec icon="spark" title="组件外观" desc="组件主题可独立切换 · 骨架不变、样式抽离（持续扩展中）">
                <Row k="日期选择胶囊" desc="时光长河悬浮日期选择的外观主题">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                    <div className="set-theme-row">
                      <Capsule className="capsule-demo" theme={capsuleTheme} icon="cal" value={themeLabel(capsuleTheme)} extra={<span className="cap-grip">⠿</span>} />
                      <ThemeSelect value={capsuleTheme} onChange={saveCapsuleTheme} />
                    </div>
                    <span className="dim" style={{ fontSize: 12 }}>下拉选择主题 · 胶囊实时预览</span>
                  </div>
                </Row>
                <Row k="日期独立主题" desc="时间线上每个日期都能单独换主题 · 未设置的日期跟随全局胶囊主题">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                    <div className="set-day-pick">
                      <input type="date" value={dayPicker} onChange={(e) => setDayPicker(e.target.value || todayYMD())} style={{ maxWidth: 172 }} />
                      <span className="dim" style={{ fontSize: 12 }}>
                        当前：{themeLabel(dayPickerEff)}{dayOverrides[dayPicker] ? '（独立设置）' : '（跟随全局）'}
                      </span>
                      {dayOverrides[dayPicker] && (
                        <button className="btn slim ghost" onClick={resetDayPickerTheme}>恢复跟随全局</button>
                      )}
                    </div>
                    <div className="set-theme-row">
                      <Capsule className="capsule-demo" theme={dayPickerEff} icon="cal" value={themeLabel(dayPickerEff)} extra={<span className="cap-grip">⠿</span>} />
                      <ThemeSelect value={dayPickerEff} onChange={saveDayPickerTheme} />
                    </div>
                    <span className="dim" style={{ fontSize: 12 }}>为 {dayPicker} 单独选择主题 · 下拉即时生效</span>
                    {Object.keys(dayOverrides).length > 0 && (
                      <div className="day-override-list">
                        <span className="dim" style={{ fontSize: 12 }}>已设置独立主题（{Object.keys(dayOverrides).length}）：</span>
                        {Object.entries(dayOverrides).map(([ymd, tid]) => (
                          <span key={ymd} className="day-ov-chip">
                            <span className="day-ov-dot" style={{ background: CAPSULE_THEMES.find((t) => t.id === tid)?.swatch }} />
                            <b>{ymd}</b>
                            <i>{themeLabel(tid)}</i>
                            <button title="恢复跟随全局" onClick={() => removeDayOverride(ymd)}><Icon name="x" size={12} /></button>
                          </span>
                        ))}
                        <button className="btn slim ghost danger-ghost" onClick={resetAllDayThemes}>清空全部</button>
                      </div>
                    )}
                  </div>
                </Row>
              </Sec>
              <Sec icon="columns" title="组件布局风格" desc="骨架不变 · 样式抽离（与胶囊同一概念 · 持续扩展中）">
                {LAYOUT_THEMES.map((g) => (
                  <Row key={g.key} k={g.label} desc={g.variants.find((v) => v.id === layoutPrefs[g.key])?.desc}>
                    <StyleSelect variants={g.variants} value={layoutPrefs[g.key] ?? g.variants[0]?.id ?? ''} onChange={(v) => saveLayoutPref(g.key, v)} />
                  </Row>
                ))}
                <Row k="灵感笔记" desc="卡片网格 / 列表行 / 纵向时间线">
                  <Dropdown
                    value={noteStylePref}
                    options={[
                      { value: 'card', label: '卡片网格（默认）' },
                      { value: 'list', label: '列表行' },
                      { value: 'timeline', label: '纵向时间线' },
                    ]}
                    onChange={(v) => saveNoteStylePref(v as NoteStyle)}
                  />
                </Row>
              </Sec>
              <Sec icon="bolt" title="番茄专注" desc="成熟计时引擎 react-timer-hook · 时长与行为全部在此配置（日常 · 番茄专注 实时生效）">
                <Row k="主题样式" desc="时间球与循环点的配色">
                  <StyleSelect variants={POMODORO_THEMES} value={pomoTheme} onChange={savePomoTheme} />
                </Row>
                <Row k="每轮专注时长" desc="完成一轮自动写入时间线">
                  <Dropdown value={String(pomo.focus)} options={[15, 25, 45].map((v) => ({ value: String(v), label: `${v} 分钟` }))} onChange={(v) => savePomo('focus', Number(v))} />
                </Row>
                <Row k="短休息" desc="每轮之间的休息">
                  <Dropdown value={String(pomo.short)} options={[3, 5, 10].map((v) => ({ value: String(v), label: `${v} 分钟` }))} onChange={(v) => savePomo('short', Number(v))} />
                </Row>
                <Row k="长休息" desc="完成一组后的较长休息">
                  <Dropdown value={String(pomo.long)} options={[10, 15, 20, 30].map((v) => ({ value: String(v), label: `${v} 分钟` }))} onChange={(v) => savePomo('long', Number(v))} />
                </Row>
                <Row k="长休息间隔" desc="每完成 N 轮专注进入一次长休息">
                  <Dropdown value={String(pomo.every)} options={[3, 4, 5].map((v) => ({ value: String(v), label: `每 ${v} 轮` }))} onChange={(v) => savePomo('every', Number(v))} />
                </Row>
                <Row k="自动衔接" desc="专注结束自动开始休息，休息结束自动开始专注">
                  <Dropdown value={pomo.auto ? '1' : '0'} options={[{ value: '1', label: '开启（推荐）' }, { value: '0', label: '关闭·手动开始' }]} onChange={(v) => savePomo('auto', v === '1')} />
                </Row>
                <Row k="完成提示音" desc="专注/休息结束时播放提示音">
                  <Dropdown value={pomo.sound ? '1' : '0'} options={[{ value: '1', label: '开启' }, { value: '0', label: '关闭' }]} onChange={(v) => savePomo('sound', v === '1')} />
                </Row>
                <Row k="每日目标" desc="日常页展示「已完成 / 目标」">
                  <Dropdown value={String(pomo.dailyGoal)} options={[4, 6, 8, 10, 12, 16].map((v) => ({ value: String(v), label: `${v} 个番茄` }))} onChange={(v) => savePomo('dailyGoal', Number(v))} />
                </Row>
              </Sec>
              <Sec icon="globe" title="语言与格式">
                <Row k="语言"><Dropdown value="zh-CN" options={[{ value: 'zh-CN', label: '简体中文' }]} onChange={() => {}} disabled /></Row>
                <Row k="时区"><Dropdown value="Asia/Shanghai" options={[{ value: 'Asia/Shanghai', label: '中国标准时间 (GMT+8)' }]} onChange={() => {}} /></Row>
                <Row k="日期格式" desc="时间线等日期展示">
                  <Dropdown
                    value={dateFmt}
                    options={[{ value: 'cn', label: '8月28日 · 周五' }, { value: 'iso', label: '2026-08-28' }]}
                    onChange={saveDateFmt}
                  />
                </Row>
              </Sec>
              <Sec icon="target" title="默认入口">
                <Row k="默认页面" desc="登录后首先进入">
                  <Dropdown
                    value={defPage}
                    options={[
                      { value: '/', label: '时间线' }, { value: '/posts', label: '文章' }, { value: '/daily', label: '日常' },
                      { value: '/goals-home', label: '目标' }, { value: '/ledger', label: '记账本' },
                    ]}
                    onChange={saveDefPage}
                  />
                </Row>
                <Row k="默认视图" desc="时间线的初始渲染">
                  <Dropdown
                    value={defView}
                    options={[{ value: 'timeline', label: '时间线' }, { value: 'universe', label: '节点宇宙' }]}
                    onChange={saveDefView}
                  />
                </Row>
              </Sec>
            </>
          )}

          {g === 'site' && (
            <>
              <Sec icon="server" title="博客外观（appearance）" desc="写入 settings/site.json，博客端渲染时生效">
                <Row k="主题">
                  <SiteThemeSelect />
                </Row>
                <Row k="字体">
                  <input type="text" placeholder="如 system-ui / Noto Serif SC" style={{ width: 220 }} />
                </Row>
                <Row k="字号">
                  <input type="text" placeholder="如 1rem / 16px" style={{ width: 220 }} />
                </Row>
                <Row k="保存">
                  <button className="btn slim" onClick={() => toast('站点外观已保存')}>保存站点设置</button>
                </Row>
              </Sec>
              <Sec icon="folder" title="文章真相源">
                <Row k="内容目录"><code>server/data/dev/posts（Markdown + frontmatter）</code></Row>
                <Row k="版本快照"><code>server/data/dev/revisions/&lt;slug&gt;/&lt;version&gt;.md</code></Row>
                <Row k="站点设置"><code>server/data/dev/settings/site.json</code></Row>
              </Sec>
            </>
          )}

          {g === 'notify' && (
            <Sec icon="bell" title="浏览器通知" desc="完成任务、讨伐掉落、两步验证等提醒">
              <Row k="通知权限" desc={notifyState === 'granted' ? '已授权' : notifyState === 'denied' ? '已被拒绝（需在浏览器设置中恢复）' : '尚未授权'}>
                {notifyState === 'granted'
                  ? <><span className="pill ok">已开启</span><button className="btn slim ghost" onClick={testNotify}>发送测试通知</button></>
                  : <button className="btn slim" onClick={enableNotify}>开启通知</button>}
              </Row>
              <Row k="提醒场景" desc="当前版本已接入">
                <span className="dim">计划完成 / 讨伐掉落 / LEVEL UP / 保存失败</span>
              </Row>
            </Sec>
          )}

          {g === 'privacy' && (
            <>
              <Sec icon="eye" title="可见性默认值">
                <Row k="内容默认可见性" desc="新记录默认公开还是仅自己">
                  <Dropdown
                    value={vis}
                    options={[{ value: 'private', label: '仅自己' }, { value: 'public', label: '公开' }]}
                    onChange={(v) => { setVis(v); localStorage.setItem('cl_visibility_default', v); toast('可见性默认值已保存') }}
                  />
                </Row>
              </Sec>
              <Sec icon="clock" title="活动日志">
                <Row k="最近登录"><span>{fmtLoginTime((user as any).lastLoginAt)} · IP {(user as any).lastLoginIp || '本机'}</span></Row>
                <Row k="数据使用"><span className="dim">仅用于本地渲染，不采集与上传</span></Row>
              </Sec>
              <Sec icon="download" title="导出个人数据">
                <Row k="工作台数据备份" desc="计划 / 习惯 / 账本 / 目标 / 灵感 汇总 JSON">
                  <button className="btn slim" onClick={exportData} disabled={exporting}>{exporting ? '导出中…' : '导出'}</button>
                </Row>
              </Sec>
            </>
          )}

          {g === 'shortcuts' && (
            <Sec icon="bolt" title="全局快捷键">
              {SHORTCUTS.map((s) => (
                <Row key={s.name} k={s.name} desc={s.desc}>
                  <code>{s.keys}</code>
                </Row>
              ))}
            </Sec>
          )}

          {g === 'data' && (
            <>
              <Sec icon="database" title="数据存储">
                <Row k="数据位置"><span><span className="pill ok">本地磁盘</span> <code>server/data/dev（SQLite + Markdown 真相源）</code></span></Row>
                <Row k="同步设置"><span className="dim">当前为本地模式，未开启云同步</span></Row>
              </Sec>
              <Sec icon="refresh" title="缓存与维护">
                <Row k="偏好缓存" desc="主题 / 默认页 / 密度等本地项（保留登录态）">
                  <button className="btn slim ghost" onClick={clearCache}>清理</button>
                </Row>
              </Sec>
              <Sec icon="file" title="导入 / 导出">
                <Row k="导出备份" desc="工作台各模块 JSON 汇总">
                  <button className="btn slim" onClick={exportData} disabled={exporting}>{exporting ? '导出中…' : '导出'}</button>
                </Row>
                <Row k="导入"><span className="dim">Markdown / JSON · 预留</span></Row>
              </Sec>
            </>
          )}

          {g === 'integrations' && (
            <Sec icon="link" title="已连接服务">
              <Row k="SMTP 邮件" desc="验证码 / 解锁 / 重置邮件通道">
                <span className="pill ok">已配置</span>
              </Row>
              <Row k="Webhook"><span className="dim">未配置 · 预留</span></Row>
              <Row k="API 凭据"><span className="dim">未生成 · 预留</span></Row>
            </Sec>
          )}

          {g === 'about' && (
            <>
              <Sec icon="help" title="云笺集 CLOUDLETTER">
                <Row k="版本"><span><span className="pill ok">v2.1.0</span> 个人工作台（单体）</span></Row>
                <Row k="定位"><span className="dim">以时间线为首页，串联文章、灵感、目标、记账与习惯的个人创作工作台</span></Row>
                <Row k="数据"><span className="dim">本地优先 · Markdown 为文章真相源 · SQLite 存结构化元数据</span></Row>
              </Sec>
              <Sec icon="book" title="帮助与反馈">
                <Row k="帮助"><span className="dim">使用引导与常见问题 · 预留</span></Row>
              </Sec>
            </>
          )}
        </div>
      </div>

      {/* 修改密码弹窗 */}
      {pwdOpen && (
        <Modal title="修改密码" onClose={() => setPwdOpen(false)} footer={
          <><button className="btn ghost" onClick={() => setPwdOpen(false)}>取消</button>
            <button className="btn" onClick={changePwd}>确认修改</button></>
        }>
          <Field label="当前密码"><input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="新密码（至少 8 位，最长 128）"><input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" maxLength={128} /></Field>
        </Modal>
      )}

      {/* 修改邮箱弹窗 */}
      {emailOpen && (
        <Modal title="修改登录邮箱" onClose={() => setEmailOpen(false)} footer={
          <><button className="btn ghost" onClick={() => setEmailOpen(false)}>取消</button>
            <button className="btn" onClick={changeEmail}>确认修改</button></>
        }>
          <Field label="新邮箱"><input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@example.com" /></Field>
          <Field label="当前密码（验证）"><input type="password" value={emailPwd} onChange={(e) => setEmailPwd(e.target.value)} autoComplete="current-password" /></Field>
        </Modal>
      )}

      {/* 两步验证弹窗（开启 / 关闭 复用） */}
      {tfaOpen && (
        <Modal title={tfaStatus?.enabled ? '关闭两步验证' : '开启两步验证'} onClose={() => setTfaOpen(false)} footer={
          tfaStatus?.enabled
            ? <><button className="btn ghost" onClick={() => setTfaOpen(false)}>取消</button>
                <button className="btn" onClick={disableTfa}>确认关闭</button></>
            : <><button className="btn ghost" onClick={() => setTfaOpen(false)}>取消</button>
                <button className="btn" onClick={confirmTfa}>确认开启</button></>
        }>
          {tfaStatus?.enabled ? (
            <>
              <p className="dim" style={{ fontSize: 13, margin: '0 0 10px' }}>关闭需要当前密码与一次有效动态码。</p>
              <Field label="当前密码"><input type="password" value={tfaDisablePwd} onChange={(e) => setTfaDisablePwd(e.target.value)} autoComplete="current-password" /></Field>
              <Field label="6 位动态码"><input inputMode="numeric" maxLength={6} value={tfaToken} onChange={(e) => setTfaToken(e.target.value.replace(/\D/g, ''))} placeholder="123456" /></Field>
            </>
          ) : (
            <>
              <p className="dim" style={{ fontSize: 13, margin: '0 0 10px' }}>1. 用 Authenticator（Google / 微软 / 1Password 等）扫码；2. 输入 App 显示的 6 位动态码确认。</p>
              {tfaQr && <div style={{ textAlign: 'center', marginBottom: 10 }}><img src={tfaQr} alt="TOTP 二维码" width={190} height={190} style={{ borderRadius: 10 }} /></div>}
              <Field label="手动输入密钥（无法扫码时）"><input readOnly value={tfaSecret} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'var(--mono)' }} /></Field>
              <Field label="6 位动态码"><input inputMode="numeric" maxLength={6} value={tfaToken} onChange={(e) => setTfaToken(e.target.value.replace(/\D/g, ''))} placeholder="123456" autoFocus /></Field>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}


/** 站点主题（本地状态，保存时写入站点设置） */
function SiteThemeSelect() {
  const [v, setV] = useState('light')
  return (
    <Dropdown
      value={v}
      options={[{ value: 'light', label: '亮色' }, { value: 'dark', label: '暗色' }, { value: 'auto', label: '跟随系统' }]}
      onChange={setV}
    />
  )
}

/** 胶囊主题下拉（紧凑占用）：选项带色块，选中即时保存 */
function ThemeSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return <StyleSelect variants={CAPSULE_THEMES} value={value} onChange={onChange} />
}

/** 通用组件风格下拉：任意一组 ThemeVariant（胶囊主题 / 各区域布局风格） */
function StyleSelect({ variants, value, onChange }: { variants: ThemeVariant[]; value: string; onChange: (id: string) => void }) {
  return (
    <Dropdown
      value={value}
      width={240}
      align="left"
      onChange={onChange}
      ariaLabel="选择组件风格"
      options={variants.map((t) => ({ value: t.id, label: `${t.label} · ${t.desc}`, swatch: t.swatch }))}
    />
  )
}
