/**
 * 设置中心（需求 13/16 重构版）：
 * - 左右两栏：左侧分类菜单（仅名称 + 悬浮 Tooltip 说明），右侧当前设置内容
 * - 账户：头像上传/装饰、资料、邮箱、密码（中英文规则）、两步验证（含邮箱安全恢复）、登录设备、退出登录（极简）
 * - 偏好：可扩展主题系统（内置套色 + 自定义主题 + 界面密度 + 全局偏好）
 * - 通知：统一通知中心（浏览器/系统/邮件/站内/重要事件 + 权限三段式反馈）
 * - 隐私与安全：可见性默认值、活动日志（完整列表 + 日志导出/导入）
 * - 数据与存储：存储模式如实显示、数据导入/导出（完整迁移）、缓存
 * - 站点设置：站点自定义中心（傻瓜式 + CSS 高级）
 * - 集成与链接：SMTP 状态、API 凭据（创建/撤销）、Webhook（事件/签名/调用日志/重试）、RSS 订阅
 * - 关于：版本 v1.0、更新记录、帮助与反馈（邮件）
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { useAuth } from '../auth'
import { Icon } from '../components/framework/Icon'
import { Modal, Field } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { Dropdown } from '../components/framework/Dropdown'
import { api, ApiError, type User } from '../api'
import { applyDensity, applyTheme, THEME_REGISTRY, activeCloudTheme, saveCloudTheme as saveCloudThemePref, readCustomTheme, writeCustomTheme, clearCustomTheme, CUSTOM_VAR_KEYS, type ThemePref, type DensityPref } from '../lib/theme'
import { todayYMD } from '../lib/date'
import { timelineLayout, setTimelineLayout, type TimelineLayout } from '../lib/layout'
import { exportDataBundle } from './settingsHelpers'
import { CAPSULE_THEMES, readTheme, writeTheme, listDayThemes, writeDayTheme, removeDayTheme, clearDayThemes, themeLabel, LAYOUT_THEMES, readLayoutTheme, writeLayoutTheme, POMODORO_THEMES, type ThemeVariant } from '../lib/componentTheme'
import { Capsule } from '../components/framework/Capsule'
import { readPomodoroPrefs, writePomodoroPref, type PomodoroPrefs, type PomodoroKey } from '../lib/pomodoro'
import { DateCal } from '../components/framework/DateCal'
import { GrantsPanel } from '../components/settings/GrantsPanel'

type GroupId = 'account' | 'prefs' | 'site' | 'notify' | 'privacy' | 'shortcuts' | 'data' | 'integrations' | 'about'

const GROUPS: { id: GroupId; label: string; icon: string; desc: string }[] = [
  { id: 'account', label: '账户', icon: 'user', desc: '头像、资料、邮箱、密码与两步验证、登录设备' },
  { id: 'prefs', label: '偏好', icon: 'setting', desc: '主题系统、密度、默认入口、布局风格' },
  { id: 'site', label: '站点设置', icon: 'server', desc: '站名 Logo favicon 字体 主色 背景 布局 动画 自定义 CSS' },
  { id: 'notify', label: '通知', icon: 'bell', desc: '浏览器 / 系统 / 邮件 / 站内通知开关与权限' },
  { id: 'privacy', label: '隐私与安全', icon: 'shield', desc: '可见性、活动日志、日志导出与导入' },
  { id: 'shortcuts', label: '快捷键', icon: 'bolt', desc: '全局快捷键一览' },
  { id: 'data', label: '数据与存储', icon: 'database', desc: '存储模式、空间与配额、数据导入导出' },
  { id: 'integrations', label: '集成与链接', icon: 'link', desc: 'SMTP、API 凭据、Webhook、RSS 订阅' },
  { id: 'about', label: '关于', icon: 'help', desc: '版本、更新记录、帮助与反馈' },
]

const SHORTCUTS: { keys: string; name: string }[] = [
  { keys: 'Ctrl/⌘ + N', name: '速记弹窗' },
  { keys: 'Ctrl/⌘ + ⇧ + N', name: '捕捉灵感' },
  { keys: 'Ctrl/⌘ + B', name: '侧边栏折叠 / 展开' },
  { keys: 'Ctrl/⌘ + S', name: '保存文章' },
  { keys: 'Esc', name: '关闭浮层' },
]

/** Tooltip 化行：标签悬浮显示说明（需求 13） */
function Row({ k, tip, children }: { k: string; tip?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-k" data-tip={tip}>
        <b>{k}</b>
      </div>
      <div className="set-row-v">{children}</div>
    </div>
  )
}

function Sec({ icon, title, tip, children }: { icon: string; title: string; tip?: string; children: ReactNode }) {
  return (
    <section className="set-sec">
      <div className="set-sec-h"><Icon name={icon} size={15} /><span data-tip={tip}>{title}</span></div>
      <div className="set-sec-body">{children}</div>
    </section>
  )
}

const FRAMES = [
  { id: '', label: '无边框' },
  { id: 'ring', label: '蓝环' },
  { id: 'gradient', label: '渐变' },
  { id: 'gold', label: '金边' },
]
const BADGES = [
  { id: '', label: '无徽章' },
  { id: 'star', label: '⭐ 星标' },
  { id: 'fire', label: '🔥 连击' },
  { id: 'crown', label: '👑 皇冠' },
  { id: 'new', label: '✨ 新手' },
]
const EFFECTS = [
  { id: '', label: '静态' },
  { id: 'spin', label: '旋转徽章' },
  { id: 'shimmer', label: '流光描边' },
  { id: 'breathe', label: '呼吸光环' },
]

export function SettingsPage() {
  const { user, logout, updateProfile } = useAuth()
  const nav = useNavigate()
  const toast = useToast()
  const [sp, setSp] = useSearchParams()
  const g = (sp.get('g') as GroupId) || 'account'
  const setG = (id: GroupId) => setSp({ g: id }, { replace: true })

  const [nick, setNick] = useState(user?.nickname ?? '')
  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [emailOpen, setEmailOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPwd, setEmailPwd] = useState('')
  const [sidePref, setSidePref] = useState(localStorage.getItem('cl_sidebar') === 'pinned' ? 'pinned' : 'collapsed')

  // 头像（需求 14）
  const [avatarBusy, setAvatarBusy] = useState(false)
  const avatarFileRef = useRef<HTMLInputElement>(null)

  /* ── 两步验证（含邮箱安全恢复，需求 7） ── */
  const [tfaStatus, setTfaStatus] = useState<{ enabled: boolean; pending: boolean } | null>(null)
  const [tfaOpen, setTfaOpen] = useState(false)
  const [tfaQr, setTfaQr] = useState('')
  const [tfaSecret, setTfaSecret] = useState('')
  const [tfaToken, setTfaToken] = useState('')
  const [tfaDisablePwd, setTfaDisablePwd] = useState('')
  const [recoverOpen, setRecoverOpen] = useState(false)
  const [recoverStep, setRecoverStep] = useState<'send' | 'confirm'>('send')
  const [recoverCode, setRecoverCode] = useState('')
  const [recoverBusy, setRecoverBusy] = useState(false)

  // 偏好（需求 15：主题系统）
  const [themeBase, setThemeBase] = useState<ThemePref>((localStorage.getItem('cl_theme') as ThemePref) || 'auto')
  const [cloudTheme, setCloudTheme] = useState(localStorage.getItem('cl_cloud_theme') || 'default')
  const [customTheme, setCustomTheme] = useState(readCustomTheme())
  const [density, setDensity] = useState<DensityPref>((localStorage.getItem('cl_density') as DensityPref) || 'standard')
  const [defPage, setDefPage] = useState(localStorage.getItem('cl_default_page') || '/')
  const [tlLayout, setTlLayout] = useState<TimelineLayout>(timelineLayout)
  // 组件主题偏好（骨架不变 · 样式抽离）
  const [capsuleTheme, setCapsuleThemeState] = useState(() => readTheme('capsule', CAPSULE_THEMES, 'glass'))
  const [dayOverrides, setDayOverrides] = useState<Record<string, string>>(() => listDayThemes())
  const [dayPicker, setDayPicker] = useState(todayYMD())
  const [dayCalOpen, setDayCalOpen] = useState(false)
  const [layoutPrefs, setLayoutPrefs] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {}
    for (const gd of LAYOUT_THEMES) o[gd.key] = readLayoutTheme(gd.key, gd.variants, gd.variants[0]?.id ?? '')
    return o
  })
  const [pomo, setPomo] = useState<PomodoroPrefs>(readPomodoroPrefs)
  const [pomoTheme, setPomoTheme] = useState(() => readLayoutTheme('pomodoro', POMODORO_THEMES, 'blue'))

  // 通知（需求 18）
  const [notifyState, setNotifyState] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  const [notifyCfg, setNotifyCfg] = useState<Record<string, boolean>>(() => ({
    browser: true, system: true, mail: false, inapp: true, important: true,
  }))
  const [fbEmail, setFbEmail] = useState('') // 默认反馈接收邮箱（需求 26）

  // 隐私 / 数据
  const [vis, setVis] = useState(localStorage.getItem('cl_visibility_default') || 'private')
  const [logs, setLogs] = useState<Array<{ id: string; action: string; object: string; result: string; detail: string; client: string; ip: string; at: string }>>([])
  const [logLabels, setLogLabels] = useState<Record<string, string>>({})
  const [logPage, setLogPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)
  const [logAction, setLogAction] = useState('')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [devices, setDevices] = useState<Array<Record<string, string>>>([])
  const [storageMode, setStorageMode] = useState<'server' | 'local'>('server')

  // 集成
  const [creds, setCreds] = useState<Array<Record<string, unknown>>>([])
  const [newCredName, setNewCredName] = useState('')
  const [newCredScopes, setNewCredScopes] = useState<string[]>(['posts.read'])
  const [credKeyOnce, setCredKeyOnce] = useState<string | null>(null)
  const [hooks, setHooks] = useState<Array<Record<string, unknown>>>([])
  const [hookEditing, setHookEditing] = useState<Record<string, unknown> | null>(null)
  const [hookCalls, setHookCalls] = useState<Record<string, Array<Record<string, unknown>>>>({})
  const [feeds, setFeeds] = useState<Array<Record<string, unknown>>>([])
  const [feedUrl, setFeedUrl] = useState('')
  const [feedBusy, setFeedBusy] = useState(false)

  // 站点设置（需求 17）
  const [siteCfg, setSiteCfg] = useState<Record<string, any>>({})
  const [siteLoading, setSiteLoading] = useState(true)
  const siteDraft = useRef<Record<string, any>>({})

  useEffect(() => { document.title = '设置 · 云笺集' }, [])

  const loadTfa = () =>
    api.get<{ enabled: boolean; pending: boolean }>('/auth/2fa/status').then(setTfaStatus).catch(() => {})

  const loadAll = () => {
    loadTfa()
    loadLogs(1)
    loadDevices()
    loadCreds()
    loadHooks()
    loadFeeds()
    loadSite()
  }
  useEffect(loadAll, [])

  if (!user) {
    nav('/login', { replace: true })
    return null
  }

  /* ========== 账户 ========== */
  const saveProfile = async () => {
    try {
      await updateProfile(nick.trim())
      toast('个人资料已保存')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }

  const changePwd = async () => {
    if (!/[\u4e00-\u9fff]/.test(newPwd) || !/[a-zA-Z]/.test(newPwd)) {
      toast('新密码必须同时包含中文与英文字母', 'err')
      return
    }
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

  /* 头像（需求 14）：上传 png/jpeg/webp/gif（GIF 动图支持），≤3MB */
  const uploadAvatar = async (file: File) => {
    setAvatarBusy(true)
    try {
      if (file.size > 3 * 1024 * 1024) { toast('头像文件过大（上限 3MB）', 'err'); return }
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast('仅支持 png / jpeg / webp / gif', 'err'); return }
      const reader = new FileReader()
      const dataUrl: string = await new Promise((res, rej) => {
        reader.onload = () => res(String(reader.result))
        reader.onerror = () => rej(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
      const r = await api.post<{ ok: boolean; avatar: string }>('/auth/avatar', { dataUrl })
      await updateProfile(nick.trim() || user.nickname || '')
      window.location.reload() // 让全局 user 带上新头像
      toast('头像已更新')
    } catch (e: any) { toast(e?.message || '上传失败', 'err') } finally { setAvatarBusy(false) }
  }

  const saveDecors = async (frame: string, badge: string, effect: string) => {
    try {
      await api.put('/auth/avatar-decors', { frame, badge, effect })
      toast('头像装饰已保存')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }

  /* 两步验证 */
  const startTfa = async () => {
    try {
      const r = await api.post<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup')
      setTfaSecret(r.secret)
      setTfaQr(await QRCode.toDataURL(r.otpauthUrl, { width: 200, margin: 1 }))
      setTfaToken('')
      setTfaOpen(true)
    } catch (e: any) { toast(e?.message || '生成失败', 'err') }
  }
  const confirmTfa = async () => {
    try {
      await api.post('/auth/2fa/enable', { token: tfaToken.trim() })
      toast('两步验证已开启，下次登录需输入动态码')
      setTfaOpen(false); loadTfa()
    } catch (e: any) { toast(e?.message || '验证失败', 'err') }
  }
  const disableTfa = async () => {
    if (!tfaDisablePwd || tfaToken.length !== 6) { toast('请输入密码与 6 位动态码', 'err'); return }
    try {
      await api.post('/auth/2fa/disable', { password: tfaDisablePwd, token: tfaToken.trim() })
      toast('两步验证已关闭')
      setTfaOpen(false); setTfaDisablePwd(''); setTfaToken(''); loadTfa()
    } catch (e: any) { toast(e?.message || '关闭失败', 'err') }
  }
  /* 两步验证邮箱安全恢复（托底：严格校验 + 有效期 + 频控 + 留痕，均已在服务端实现） */
  const sendRecovery = async () => {
    setRecoverBusy(true)
    try {
      const r = await api.post<{ ok: boolean; sent: boolean; mode?: string; dev?: { code: string } }>('/auth/2fa/recovery-request', { email: user?.email })
      if (r.mode === 'demo' && r.dev) toast(`演示模式恢复码：${r.dev.code}`)
      else toast(r.sent ? '恢复码已发送到你的绑定邮箱（15 分钟有效，仅一次）' : '恢复码已发送' + (r.sent === false ? '（账户未开启两步验证）' : ''))
      setRecoverStep('confirm')
    } catch (e: any) { toast(e?.message || '发送失败', 'err') } finally { setRecoverBusy(false) }
  }
  const confirmRecovery = async () => {
    setRecoverBusy(true)
    try {
      await api.post('/auth/2fa/recovery-confirm', { email: user?.email, code: recoverCode.trim() })
      toast('两步验证已安全重置，请重新登录并重新绑定验证器')
      setRecoverOpen(false); setRecoverCode(''); setRecoverStep('send')
      await logout()
      window.location.href = '/login'
    } catch (e: any) { toast(e?.message || '验证失败', 'err') } finally { setRecoverBusy(false) }
  }

  /* ========== 偏好 ========== */
  const saveThemeBase = (v: ThemePref) => { setThemeBase(v); applyTheme(v); toast('外观基础已保存') }
  const selectCloudTheme = (id: string) => {
    setCloudTheme(id); saveCloudThemePref(id); applyTheme(themeBase); toast('主题已切换')
  }
  const saveDensity = (v: DensityPref) => { setDensity(v); localStorage.setItem('cl_density', v); applyDensity(v) }
  const saveCustomTheme = (patch: { base?: ThemePref; key?: string; value?: string }) => {
    const cur = customTheme ?? { base: themeBase, vars: {} }
    const next = { base: patch.base ?? cur.base, vars: { ...cur.vars } }
    if (patch.key !== undefined) next.vars[patch.key] = patch.value ?? ''
    setCustomTheme(next); writeCustomTheme(next); applyTheme(themeBase)
  }
  const resetCustomTheme = () => { clearCustomTheme(); setCustomTheme(null); applyTheme(themeBase); toast('自定义主题已清除') }
  const saveSidePref = (v: string) => { setSidePref(v); localStorage.setItem('cl_sidebar', v); toast(v === 'pinned' ? '侧边栏默认展开已保存' : '侧边栏默认折叠已保存') }
  const saveTlLayout = (v: TimelineLayout) => { setTlLayout(v); setTimelineLayout(v) }
  /* 组件主题（胶囊 / 日期独立 / 布局风格 / 番茄专注） */
  const saveCapsuleTheme = (v: string) => {
    setCapsuleThemeState(v); writeTheme('capsule', v)
    toast(`日期胶囊主题：${themeLabel(v)}`)
  }
  const saveLayoutPref = (key: string, v: string) => { writeLayoutTheme(key, v); setLayoutPrefs((p) => ({ ...p, [key]: v })) }
  const savePomo = (key: PomodoroKey, value: number | boolean) => { writePomodoroPref(key, value); setPomo(readPomodoroPrefs()) }
  const savePomoThemeF = (v: string) => { writeLayoutTheme('pomodoro', v); setPomoTheme(v) }
  const saveDayPickerTheme = (id: string) => { writeDayTheme(dayPicker, id); setDayOverrides(listDayThemes()); toast(`已为 ${dayPicker} 设置独立主题`) }
  const resetDayPickerTheme = () => { removeDayTheme(dayPicker); setDayOverrides(listDayThemes()) }
  const resetAllDayThemesF = () => { clearDayThemes(); setDayOverrides({}) }

  /* ========== 通知（需求 18） ========== */
  const enableNotify = async () => {
    if (typeof Notification === 'undefined') { toast('当前浏览器不支持通知', 'err'); return }
    const p = await Notification.requestPermission()
    setNotifyState(p)
    if (p === 'granted') {
      new Notification('云笺集', { body: '通知已开启 ✓' })
      toast('通知权限已授权，浏览器通知可正常送达')
    } else if (p === 'denied') {
      toast('通知权限被拒绝：请在浏览器站点设置中重新开启（地址栏左侧图标 → 网站设置 → 通知 → 允许）', 'err')
    } else {
      toast('通知权限未授予')
    }
  }
  const saveNotifyCfg = (k: string, v: boolean) => {
    setNotifyCfg((prev) => { const next = { ...prev, [k]: v }; localStorage.setItem('cl_notify', JSON.stringify(next)); return next })
    toast('通知设置已保存')
  }

  /* ========== 隐私与安全 ========== */
  const loadLogs = (page: number) => {
    api.get<{ items: any[]; total: number; pages: number; page: number; labels: Record<string, string> }>(`/activity?page=${page}${logAction ? `&action=${logAction}` : ''}`)
      .then((r) => { setLogs(r.items); setLogTotal(r.total); setLogPage(r.page); setLogLabels(r.labels) })
      .catch(() => {})
  }
  const exportLogs = async () => {
    setExporting(true)
    try {
      const bundle = await api.post<any>('/activity/export')
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `cloudletter-activity-log-${todayYMD()}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast('活动日志已导出（登录 / 操作 / 安全 / 重大事件）')
    } catch (e: any) { toast(e?.message || '导出失败', 'err') } finally { setExporting(false) }
  }
  const importLogs = async (file: File) => {
    setImporting(true)
    try {
      const text = await file.text()
      const bundle = JSON.parse(text)
      const r = await api.post<{ ok: boolean; added: number }>('/activity/import', { bundle })
      toast(`活动日志导入完成（新增 ${r.added} 条，仅合并不覆盖）`)
      loadLogs(1)
    } catch (e: any) { toast(e?.message || '导入失败：请确认是云笺集活动日志文件', 'err') } finally { setImporting(false) }
  }
  const loadDevices = () => {
    api.get<{ records: any[] }>('/auth/devices').then((r) => setDevices(r.records)).catch(() => {})
  }

  /* ========== 数据与存储（导入 / 导出） ========== */
  const exportData = async () => {
    setExporting(true)
    try {
      await exportDataBundle(toast)
    } catch (e: any) { toast(e?.message || '导出失败', 'err') } finally { setExporting(false) }
  }
  const importData = async (file: File) => {
    setImporting(true)
    try {
      const bundle = JSON.parse(await file.text())
      const r = await api.post<{ ok: boolean; counts: Record<string, { total: number; added: number; skipped: number }> }>(
        '/workbench/data/import', { bundle, conflict: 'skip' })
      const parts = Object.entries(r.counts).map(([k, v]) => `${k} 新增 ${v.added} / 跳过 ${v.skipped}`)
      toast(`数据导入完成：${parts.join('，')}（冲突自动跳过，可重复导入不重复）`)
    } catch (e: any) { toast(e?.message || '导入失败：请确认是云笺集备份文件', 'err') } finally { setImporting(false) }
  }
  const clearCache = () => {
    Object.keys(localStorage).filter((k) => k.startsWith('cl_') && k !== 'cl_token' && k !== 'cl_dev').forEach((k) => localStorage.removeItem(k))
    toast('本地偏好缓存已清理（登录态与设备标识保留）')
  }

  /* ========== 集成（API 凭据 / Webhook / RSS） ========== */
  const loadCreds = () => { api.get<{ items: any[] }>('/integrations/api-credentials').then((r) => setCreds(r.items)).catch(() => {}) }
  const createCred = async () => {
    if (!newCredName.trim()) { toast('请输入凭据名称', 'err'); return }
    try {
      const r = await api.post<{ key: string; name: string }>('/integrations/api-credentials', { name: newCredName, scopes: newCredScopes })
      setCredKeyOnce(`${r.name}: ${r.key}`)
      setNewCredName('')
      loadCreds()
    } catch (e: any) { toast(e?.message || '创建失败', 'err') }
  }
  const revokeCred = async (id: string) => {
    try { await api.del(`/integrations/api-credentials/${id}`); loadCreds(); toast('凭据已撤销') }
    catch (e: any) { toast(e?.message || '撤销失败', 'err') }
  }
  const loadHooks = () => { api.get<{ items: any[] }>('/integrations/webhooks').then((r) => setHooks(r.items)).catch(() => {}) }
  const saveHook = async (payload: Record<string, unknown>) => {
    try {
      if (hookEditing?.id) await api.put(`/integrations/webhooks/${hookEditing.id}`, payload)
      else await api.post('/integrations/webhooks', payload)
      setHookEditing(null); loadHooks(); toast('Webhook 已保存')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }
  const toggleHook = async (h: Record<string, unknown>) => {
    try { await api.put(`/integrations/webhooks/${h.id}`, { enabled: !h.enabled }); loadHooks() }
    catch (e: any) { toast(e?.message || '操作失败', 'err') }
  }
  const deleteHook = async (id: string) => {
    try { await api.del(`/integrations/webhooks/${id}`); loadHooks(); toast('Webhook 已删除') }
    catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }
  const testHook = async (id: string) => {
    try {
      const r = await api.post<{ ok: boolean; status: number; message: string }>(`/integrations/webhooks/${id}/test`)
      toast(r.message)
      loadHooks()
    } catch (e: any) { toast(e?.message || '测试失败', 'err') }
  }
  const showCalls = async (id: string) => {
    try {
      const r = await api.get<{ items: any[] }>(`/integrations/webhooks/${id}/calls`)
      setHookCalls((p) => ({ ...p, [id]: r.items }))
    } catch { /* ignore */ }
  }
  const loadFeeds = () => { api.get<{ items: any[] }>('/feeds').then((r) => setFeeds(r.items)).catch(() => {}) }
  const subscribeFeed = async () => {
    if (!feedUrl.trim()) { toast('请输入订阅源 URL', 'err'); return }
    setFeedBusy(true)
    try {
      const r = await api.post<{ ok: boolean; title: string; added: number }>('/feeds/subscribe', { url: feedUrl.trim() })
      toast(`已订阅「${r.title}」（首拉 ${r.added} 条）`)
      setFeedUrl(''); loadFeeds()
    } catch (e: any) { toast(e?.message || '订阅失败', 'err') } finally { setFeedBusy(false) }
  }
  const refreshFeed = async (id: string) => {
    try {
      const r = await api.post<{ ok: boolean; added: number }>(`/feeds/${id}/refresh`)
      toast(`订阅刷新完成（新增 ${r.added} 条）`)
      loadFeeds()
    } catch (e: any) { toast(e?.message || '刷新失败', 'err') }
  }
  const removeFeed = async (id: string) => {
    try { await api.del(`/feeds/${id}`); loadFeeds(); toast('已取消订阅') }
    catch (e: any) { toast(e?.message || '操作失败', 'err') }
  }

  /* ========== 站点自定义中心（需求 17） ========== */
  const loadSite = () => {
    api.get<any>('/settings')
      .then((r) => { setSiteCfg(r); siteDraft.current = JSON.parse(JSON.stringify(r)) })
      .catch(() => {})
      .finally(() => setSiteLoading(false))
  }
  const patchSite = (path: string, value: any) => {
    siteDraft.current = { ...siteDraft.current }
    const parts = path.split('.')
    let o: any = siteDraft.current
    while (parts.length > 1) { const k = parts.shift()!; o[k] = o[k] ?? {}; o = o[k] }
    o[parts[0]] = value
  }
  const saveSite = async () => {
    try {
      await api.put('/settings', siteDraft.current)
      toast('站点设置已保存')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }
  const siteVal = (path: string, fallback = '') => {
    const parts = path.split('.')
    let o: any = siteDraft.current
    for (const p of parts) { if (o?.[p] === undefined) return fallback; o = o[p] }
    return o ?? fallback
  }
  const siteGroup = () => (siteDraft.current.site && typeof siteDraft.current.site === 'object' ? siteDraft.current.site : {})
  const patchSiteGroup = (k: string, v: any) => {
    siteDraft.current = { ...siteDraft.current, site: { ...siteGroup(), [k]: v } }
  }

  const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—')
  const isCurrentDev = (deviceId: string) => !!deviceId && deviceId === localStorage.getItem('cl_dev')

  return (
    <div className="set-page">
      <PageHeader title="设置" subtitle="全部设置真实生效" actions={<span className="acct-email-chip"><span className="dot" /> {user.email}</span>} />

      <div className="set-layout">
        <nav className="set-nav" aria-label="设置分组">
          {GROUPS.map((grp) => (
            <button key={grp.id} className={`set-nav-item${grp.id === g ? ' on' : ''}`} onClick={() => setG(grp.id)} title={grp.desc} data-tip={grp.desc}>
              <Icon name={grp.icon} size={16} /> <span>{grp.label}</span>
            </button>
          ))}
        </nav>

        <div className="set-content">
          {g === 'account' && (
            <>
              <Sec icon="user" title="个人资料" tip="昵称显示、头像上传与装饰">
                <Row k="昵称" tip="头像菜单与宇宙视图显示">
                  <input type="text" value={nick} onChange={(e) => setNick(e.target.value)} placeholder="你的昵称" maxLength={30} style={{ width: 200 }} />
                  <button className="btn slim" onClick={saveProfile}>保存</button>
                </Row>
                <Row k="头像" tip="支持 png / jpeg / webp / gif（动图），≤3MB；魔数校验">
                  <div className="av-row">
                    <input ref={avatarFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); e.target.value = '' }} />
                    <button className="btn slim" disabled={avatarBusy} onClick={() => avatarFileRef.current?.click()}>
                      {avatarBusy ? '上传中…' : '上传头像'}
                    </button>
                  </div>
                </Row>
                <Row k="头像装饰" tip="类似 QQ 头像装饰：边框 / 徽章 / 动效，可叠加">
                  <div className="av-body">
                    <AvatarPreview user={user} />
                    <div className="av-pick">
                      <label>边框
                        <select value={user?.avatarFrame ?? ''} onChange={(e) => void saveDecors(e.target.value, user?.avatarBadge ?? '', '')}>
                          {FRAMES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                        </select>
                      </label>
                      <label>徽章
                        <select value={user?.avatarBadge ?? ''} onChange={(e) => void saveDecors(user?.avatarFrame ?? '', e.target.value, '')}>
                          {BADGES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                        </select>
                      </label>
                      <label>动效
                        <select value="" onChange={(e) => void saveDecors(user?.avatarFrame ?? '', user?.avatarBadge ?? '', e.target.value)}>
                          {EFFECTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                </Row>
                <Row k="登录邮箱" tip="登录凭证，修改需验证当前密码">
                  <span>{user.email}</span>
                  <button className="btn slim ghost" onClick={() => { setNewEmail(''); setEmailPwd(''); setEmailOpen(true) }}>修改邮箱</button>
                </Row>
                <Row k="登录密码" tip="至少 8 位，必须同时包含中文与英文字母；修改后撤销其他会话">
                  <button className="btn slim ghost" onClick={() => setPwdOpen(true)}>修改密码</button>
                </Row>
              </Sec>

              <Sec icon="shield" title="账号与安全" tip="两步验证（TOTP）与邮箱安全恢复">
                <Row k="两步验证" tip="登录时需输入 Authenticator 动态码；丢失验证器可走邮箱恢复（严格校验 15 分钟有效）">
                  {tfaStatus?.enabled
                    ? <><span className="pill ok">已开启</span>
                        <button className="btn slim ghost" onClick={() => { setTfaOpen(true); setTfaToken(''); setTfaDisablePwd('') }}>关闭</button>
                        <button className="btn slim ghost" onClick={() => setRecoverOpen(true)}>无法验证？</button></>
                    : <><span className="pill warn">未开启</span><button className="btn slim" onClick={startTfa}>开启两步验证</button></>}
                </Row>
                <Row k="登录设备" tip="最近登录的客户端信息（时间 / IP / 客户端类型 / 操作系统 / 浏览器 / 地区，来自真实登录请求）">
                  {devices.length === 0 ? <span className="dim">暂无记录</span> : (
                    <div className="dev-list">
                      {devices.slice(0, 6).map((d, i) => (
                        <div key={i} className="dev-row">
                          <span className={`pill ${d.status === 'ok' ? 'ok' : 'bad'}`}>{d.status === 'ok' ? '成功' : '失败'}</span>
                          <b>{fmtTime(d.time)}</b>
                          <em>{[d.os, d.browser, d.client].filter(Boolean).join(' · ') || '—'}</em>
                          <code>IP {d.ip || '—'}</code>
                          {d.geo && <i>{d.geo}</i>}
                          {isCurrentDev(d.deviceId) && <b className="dv-cur">当前设备</b>}
                        </div>
                      ))}
                    </div>
                  )}
                </Row>
              </Sec>

              <Sec icon="trash" title="退出登录" tip="仅退出登录，保留全部数据">
                <div className="set-row simple">
                  <div className="set-row-k"><b>退出登录</b></div>
                  <div className="set-row-v"><button className="btn slim ghost" onClick={async () => { await logout(); window.location.reload() }}>退出登录</button></div>
                </div>
              </Sec>
            </>
          )}

          {g === 'prefs' && (
            <>
              <Sec icon="palette" title="主题系统" tip="亮/暗骨架 + 套色主题叠加；支持自定义主题与第三方主题扩展接口">
                <Row k="外观基础" tip="亮色 / 暗色 / 跟随系统（决定主题骨架）">
                  <Dropdown value={themeBase} options={[{ value: 'light', label: '亮色' }, { value: 'dark', label: '暗色' }, { value: 'auto', label: '跟随系统' }]} onChange={(v) => saveThemeBase(v as ThemePref)} />
                </Row>
                <Row k="套色主题" tip="在骨架之上叠加的主色调色板（云笺蓝 / 墨韵灰 / 青藤绿 / 落日橙 / 星夜紫…）">
                  <div className="th-grid">
                    {THEME_REGISTRY.map((t) => (
                      <button key={t.id} className={`th-card${cloudTheme === t.id ? ' on' : ''}`} onClick={() => selectCloudTheme(t.id)}>
                        <span className="th-swatches"><i style={{ background: t.swatch[0] }} /><i style={{ background: t.swatch[1] }} /></span>
                        <b>{t.label}</b><em>{t.base === 'dark' ? '暗色' : '亮色'}</em>
                      </button>
                    ))}
                    <button className={`th-card${cloudTheme === 'custom' ? ' on' : ''}`} onClick={() => { selectCloudTheme('custom'); setCloudTheme('custom') }}>
                      <span className="th-swatches"><i style={{ background: 'linear-gradient(90deg,#f97316,#8b5cf6,#06b6d4)' }} /><i style={{ background: 'linear-gradient(90deg,#06b6d4,#8b5cf6)' }} /></span>
                      <b>自定义</b><em>({activeCloudTheme()?.custom ? '已启用' : '未启用'})</em>
                    </button>
                  </div>
                </Row>
                <Row k="自定义主题" tip="编辑核心视觉变量，保存后实时应用（基于所选外观骨架）">
                  <div className="ct-editor">
                    <label>骨架
                      <select value={customTheme?.base ?? 'light'} onChange={(e) => saveCustomTheme({ base: e.target.value as ThemePref })}>
                        <option value="light">亮色</option><option value="dark">暗色</option>
                      </select>
                    </label>
                    {CUSTOM_VAR_KEYS.map(({ key, label }) => (
                      <label key={key}>{label}
                        <input type="text" value={customTheme?.vars?.[key] ?? ''} placeholder={key === '--radius' ? '16px' : '#hex 或 css 值'}
                          onChange={(e) => saveCustomTheme({ key, value: e.target.value })} />
                      </label>
                    ))}
                    <button className="btn slim ghost" onClick={resetCustomTheme}>清除自定义主题</button>
                  </div>
                </Row>
                <Row k="界面密度" tip="标准 / 紧凑（间距与圆角全局收紧）">
                  <Dropdown value={density} options={[{ value: 'standard', label: '标准' }, { value: 'compact', label: '紧凑' }]} onChange={(v) => saveDensity(v as DensityPref)} />
                </Row>
                <Row k="默认页面" tip="登录后首先进入">
                  <Dropdown value={defPage} options={[{ value: '/', label: '时间线' }, { value: '/posts', label: '文章' }, { value: '/daily', label: '日常' }, { value: '/goals-home', label: '目标' }, { value: '/ledger', label: '记账本' }]} onChange={(v) => { setDefPage(v); localStorage.setItem('cl_default_page', v) }} />
                </Row>
                <Row k="侧边栏默认" tip="未手动操作时的默认状态；折叠态仍支持悬停临时展开">
                  <Dropdown value={sidePref} options={[{ value: 'collapsed', label: '默认折叠（推荐）' }, { value: 'pinned', label: '默认展开' }]} onChange={(v) => saveSidePref(v)} />
                </Row>
                <Row k="时光长河布局" tip="气泡在轴上的排布方式">
                  <Dropdown value={tlLayout} options={[{ value: 'river', label: '🌊 河流蜿蜒' }, { value: 'axis', label: '｜居中轴线' }, { value: 'list', label: '☰ 单列列表' }]} onChange={(v) => saveTlLayout(v as TimelineLayout)} />
                </Row>
              </Sec>
              <Sec icon="spark" title="组件外观" tip="组件主题可独立切换 · 骨架不变、样式抽离（含日期独立主题）">
                <Row k="日期选择胶囊" tip="时光长河悬浮日期选择的外观主题">
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                    <Capsule className="capsule-demo" theme={capsuleTheme} icon="cal" value={themeLabel(capsuleTheme)} extra={<span className="cap-grip">⠿</span>} />
                    <ThemeSelect value={capsuleTheme} onChange={saveCapsuleTheme} />
                  </div>
                </Row>
                <Row k="日期独立主题" tip="时间线上每个日期都能单独换主题 · 未设置的日期跟随全局胶囊主题">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
                    <div className="set-day-pick" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <button className="btn slim" onClick={() => setDayCalOpen((v) => !v)}>📅 {dayPicker}</button>
                      {dayCalOpen && <DateCal value={dayPicker} onChange={(ymd) => { setDayPicker(ymd); setDayCalOpen(false) }} />}
                      {dayOverrides[dayPicker] && <button className="btn slim ghost" onClick={resetDayPickerTheme}>恢复跟随全局</button>}
                      <ThemeSelect value={dayOverrides[dayPicker] ?? capsuleTheme} onChange={saveDayPickerTheme} />
                    </div>
                    {Object.keys(dayOverrides).length > 0 && (
                      <div className="day-override-list">
                        {Object.entries(dayOverrides).map(([ymd, tid]) => (
                          <span key={ymd} className="day-ov-chip">
                            <span className="day-ov-dot" style={{ background: CAPSULE_THEMES.find((t) => t.id === tid)?.swatch }} />
                            <b>{ymd}</b><i>{themeLabel(tid)}</i>
                            <button title="恢复跟随全局" onClick={() => { removeDayTheme(ymd); setDayOverrides(listDayThemes()) }}><Icon name="x" size={12} /></button>
                          </span>
                        ))}
                        <button className="btn slim ghost danger-ghost" onClick={resetAllDayThemesF}>清空全部</button>
                      </div>
                    )}
                  </div>
                </Row>
                {LAYOUT_THEMES.map((gd) => (
                  <Row key={gd.key} k={gd.label} tip={gd.variants.find((v) => v.id === layoutPrefs[gd.key])?.desc}>
                    <StyleSelect variants={gd.variants} value={layoutPrefs[gd.key] ?? gd.variants[0]?.id ?? ''} onChange={(v) => saveLayoutPref(gd.key, v)} />
                  </Row>
                ))}
                <Row k="番茄专注外观" tip="时间球与循环点的配色">
                  <StyleSelect variants={POMODORO_THEMES} value={pomoTheme} onChange={savePomoThemeF} />
                </Row>
                <Row k="番茄专注时长" tip="每轮专注 / 短休息 / 长休息的时长与每日目标">
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select value={String(pomo.focus)} onChange={(e) => savePomo('focus', Number(e.target.value))}>
                      {[15, 25, 45].map((v) => <option key={v} value={v}>{v} 分钟专注</option>)}
                    </select>
                    <select value={String(pomo.short)} onChange={(e) => savePomo('short', Number(e.target.value))}>
                      {[3, 5, 10].map((v) => <option key={v} value={v}>{v} 分钟短休</option>)}
                    </select>
                    <select value={String(pomo.every)} onChange={(e) => savePomo('every', Number(e.target.value))}>
                      {[3, 4, 5].map((v) => <option key={v} value={v}>每 {v} 轮长休</option>)}
                    </select>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                      <input type="checkbox" checked={pomo.auto} onChange={(e) => savePomo('auto', e.target.checked)} />自动衔接
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                      <input type="checkbox" checked={pomo.sound} onChange={(e) => savePomo('sound', e.target.checked)} />完成提示音
                    </label>
                  </div>
                </Row>
              </Sec>
            </>
          )}

          {g === 'site' && (
            <>
              <Sec icon="server" title="站点自定义中心" tip="云笺集统一站点视觉与内容定制；傻瓜式配置 + CSS 高级配置共存（各有优先级与隔离）">
                <div className="site-grid">
                  <label>网站名称<input value={siteVal('site.name')} onChange={(e) => patchSiteGroup('name', e.target.value)} placeholder="云笺集" /></label>
                  <label>网站描述<input value={siteVal('site.description')} onChange={(e) => patchSiteGroup('description', e.target.value)} placeholder="个人创作工作台" /></label>
                  <label>Logo URL<input value={siteVal('site.logo')} onChange={(e) => patchSiteGroup('logo', e.target.value)} placeholder="/logo.png 或 https://" /></label>
                  <label>favicon URL<input value={siteVal('site.favicon')} onChange={(e) => patchSiteGroup('favicon', e.target.value)} placeholder="/favicon.ico" /></label>
                  <label>正文字体<input value={siteVal('site.fontFamily')} onChange={(e) => patchSiteGroup('fontFamily', e.target.value)} placeholder="system-ui / serif" /></label>
                  <label>主色<input type="color" value={/^#[0-9a-fA-F]{6}$/.test(siteVal('site.accent')) ? siteVal('site.accent') : '#2f6df6'} onChange={(e) => patchSiteGroup('accent', e.target.value)} /></label>
                </div>
                <Row k="页面视觉" tip="卡片 / 按钮 / 间距 / 圆角 / 阴影（以 CSS 变量形式作用于全站）">
                  <div className="site-grid">
                    <label>圆角（px）<input value={siteVal('site.radius', '16')} onChange={(e) => patchSiteGroup('radius', e.target.value)} placeholder="16" /></label>
                    <label>阴影强度<input value={siteVal('site.shadow', '0.5')} onChange={(e) => patchSiteGroup('shadow', e.target.value)} placeholder="0~1" /></label>
                    <label>卡片透明度<input value={siteVal('site.cardAlpha', '1')} onChange={(e) => patchSiteGroup('cardAlpha', e.target.value)} placeholder="0~1" /></label>
                    <label>背景动画<select value={siteVal('site.bgAnimation', 'off')} onChange={(e) => patchSiteGroup('bgAnimation', e.target.value)}>
                      <option value="off">关闭</option><option value="aurora">极光流动</option><option value="particles">粒子</option>
                    </select></label>
                  </div>
                </Row>
                <Row k="CSS 高级配置" tip="直接编写自定义 CSS（安全隔离：仅作用于当前站点的样式作用域，禁用脚本；!important 允许覆盖）">
                  <textarea className="site-css" rows={8} value={siteVal('site.customCss')} onChange={(e) => patchSiteGroup('customCss', e.target.value)}
                    placeholder={`/* 例：让卡片更圆 */\n.set-sec { border-radius: 20px; }`} />
                </Row>
                <div className="set-row">
                  <div className="set-row-v" style={{ justifyContent: 'flex-start' }}>
                    <button className="btn slim" onClick={saveSite} disabled={siteLoading}>{siteLoading ? '载入中…' : '保存站点设置'}</button>
                  </div>
                </div>
              </Sec>
            </>
          )}

          {g === 'notify' && (
            <>
              <Sec icon="bell" title="通知中心" tip="全站统一通知管理：浏览器 / 系统 / 邮件 / 站内 / 重要事件">
                <Row k="浏览器通知权限" tip={notifyState === 'granted' ? '已授权，通知可正常送达' : notifyState === 'denied' ? '已被浏览器禁止：点击地址栏左侧站点图标 → 网站设置 → 通知 → 允许' : '尚未授权，点击开启'}>
                  {notifyState === 'granted'
                    ? <><span className="pill ok">已授权</span><button className="btn slim ghost" onClick={() => new Notification('云笺集', { body: '测试通知 ✓' })}>发送测试通知</button></>
                    : notifyState === 'denied'
                      ? <><span className="pill bad">已被浏览器禁止</span><span className="dim">打开浏览器站点设置重新开启</span><button className="btn slim ghost" onClick={async () => { const p = await Notification.requestPermission(); setNotifyState(p) }}>重新尝试授权</button></>
                      : <button className="btn slim" onClick={enableNotify}>开启浏览器通知</button>}
                </Row>
                <Row k="通知场景">
                  <div className="nt-grid">
                    {[
                      ['browser', '浏览器通知', '任务完成、讨伐掉落等桌面推送'],
                      ['system', '系统通知', '操作系统级提醒（需先授权浏览器）'],
                      ['mail', '邮件通知', '重要事件邮件（需配置 SMTP）'],
                      ['inapp', '站内通知', '应用内消息气泡'],
                      ['important', '重要事件', '安全事件、版本升级等'],
                    ].map(([k, label, tip]) => (
                      <label key={k} className="nt-item" title={tip}>
                        <input type="checkbox" checked={notifyCfg[k]} onChange={(e) => saveNotifyCfg(k, e.target.checked)} />
                        <b>{label}</b><em>{tip}</em>
                      </label>
                    ))}
                  </div>
                </Row>
                <Row k="默认反馈接收邮箱" tip="「关于 → 反馈」通过邮件发送时使用的收件邮箱；默认取当前登录邮箱">
                  <input type="email" value={fbEmail || user.email} onChange={(e) => setFbEmail(e.target.value)} placeholder="feedback@example.com" style={{ width: 240 }} />
                  <button className="btn slim ghost" onClick={() => { localStorage.setItem('cl_feedback_email', fbEmail || user.email); toast('默认反馈接收邮箱已保存') }}>保存</button>
                </Row>
              </Sec>
            </>
          )}

          {g === 'privacy' && (
            <>
              <Sec icon="eye" title="可见性默认值">
                <Row k="内容默认可见性" tip="新记录默认公开还是仅自己">
                  <Dropdown value={vis} options={[{ value: 'private', label: '仅自己' }, { value: 'public', label: '公开' }]} onChange={(v) => { setVis(v); localStorage.setItem('cl_visibility_default', v) }} />
                </Row>
              </Sec>
              <Sec icon="key" title="一次性授权" tip="给访客发邮件链接，临时只读查看指定模块，到期自动失效">
                <GrantsPanel />
              </Sec>
              <Sec icon="clock" title="活动日志" tip="登录 / 登出 / 改密 / 2FA / 文章增删改 / 导入导出 / 站点配置 / API / Webhook 等重大操作全部留痕，仅追加不可删改">
                <div className="log-toolbar">
                  <select value={logAction} onChange={(e) => { setLogAction(e.target.value); loadLogs(1) }}>
                    <option value="">全部类型</option>
                    {Object.entries(logLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <span className="dim">共 {logTotal} 条</span>
                  <span className="spacer" />
                  <button className="btn slim ghost" onClick={exportLogs} disabled={exporting}>{exporting ? '导出中…' : '导出日志'}</button>
                  <label className="btn slim ghost file-btn" title="导入云笺集活动日志 JSON（仅合并不覆盖）">
                    {importing ? '导入中…' : '导入日志'}
                    <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importLogs(f); e.target.value = '' }} />
                  </label>
                </div>
                <div className="log-list">
                  {logs.length === 0 && <span className="dim">暂无日志</span>}
                  {logs.map((l) => (
                    <div key={l.id} className="log-row">
                      <span className={`pill ${l.result === 'fail' ? 'bad' : 'ok'}`}>{l.result === 'fail' ? '失败' : '成功'}</span>
                      <b>{logLabels[l.action] ?? l.action}</b>
                      <em>{l.object}</em>
                      <code>{fmtTime(l.at)}</code>
                      <i>{l.ip || '—'}</i>
                    </div>
                  ))}
                </div>
                <div className="log-pager">
                  <button className="btn slim ghost" disabled={logPage <= 1} onClick={() => loadLogs(logPage - 1)}>上一页</button>
                  <span className="dim">第 {logPage} 页</span>
                  <button className="btn slim ghost" onClick={() => loadLogs(logPage + 1)}>下一页</button>
                </div>
              </Sec>
              <Sec icon="download" title="日志导出 / 导入" tip="隐私与安全仅处理「活动日志」；业务数据迁移请到「数据与存储」">
                <Row k="说明" tip="">
                  <span className="dim">活动日志导出为 JSON 文件；导入仅合并追加（同 id 自动跳过），与其他业务数据互不干扰。</span>
                </Row>
              </Sec>
            </>
          )}

          {g === 'shortcuts' && (
            <Sec icon="bolt" title="全局快捷键" tip="自定义按键路径将在「快捷键」能力升级后支持">
              {SHORTCUTS.map((s) => (
                <Row key={s.name} k={s.name}><code>{s.keys}</code></Row>
              ))}
            </Sec>
          )}

          {g === 'data' && (
            <>
              <Sec icon="database" title="数据存储模式" tip="如实显示当前部署与存储形态">
                <Row k="存储模式" tip="项目运行在服务器上，数据存于服务器端（SQLite + Markdown 真相源）；与第三方云同步无关">
                  <span><span className="pill ok">服务器部署 · 云端存储</span>
                    <code className="dim">SQLite {storageMode === 'server' ? '（服务器）' : ''} + Markdown 真相源</code></span>
                </Row>
                <Row k="同步状态" tip="无第三方云同步≠本地模式：外部登录、服务器部署、内部云存储、云同步、第三方云服务已独立定义">
                  <span className="dim">当前为服务器端存储，未接入第三方云同步服务</span>
                </Row>
                <Row k="空间与配额" tip="服务器磁盘空间与配额管理入口">
                  <span className="dim">配额信息由服务器运维统一管理（本机显示）</span>
                </Row>
              </Sec>
              <Sec icon="file" title="数据迁移（导入 / 导出）" tip="完整数据迁移能力：导出备份 → 导入恢复；格式校验 / 冲突跳过 / 事务回滚">
                <Row k="导出备份" tip="工作台各模块 JSON 汇总（计划 / 习惯 / 账本 / 目标 / 灵感 / 工作）">
                  <button className="btn slim" onClick={exportData} disabled={exporting}>{exporting ? '导出中…' : '导出'}</button>
                </Row>
                <Row k="导入备份" tip="选择云笺集备份 JSON；冲突自动跳过（同内容不重复），任何异常整体回滚不破坏现有数据">
                  <label className="btn slim file-btn" title="选择云笺集 backup JSON">
                    {importing ? '导入中…' : '导入 JSON'}
                    <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = '' }} />
                  </label>
                </Row>
                <Row k="偏好缓存" tip="主题 / 默认页 / 密度等本地项（保留登录态与设备标识）">
                  <button className="btn slim ghost" onClick={clearCache}>清理</button>
                </Row>
              </Sec>
            </>
          )}

          {g === 'integrations' && (
            <>
              <Sec icon="link" title="已连接服务">
                <Row k="SMTP 邮件" tip="验证码 / 解锁 / 重置邮件通道"><span className="pill ok">已配置</span></Row>
                <Row k="RSS Feed" tip="公开订阅地址，供其他博客互相关注">
                  <code>{location.origin}/api/v2/rss.xml</code>
                </Row>
              </Sec>
              <Sec icon="key" title="API 凭据" tip="创建 / 查看（脱敏）/ 撤销；明文密钥仅创建时展示一次，库内只存哈希">
                <Row k="创建凭据">
                  <input value={newCredName} onChange={(e) => setNewCredName(e.target.value)} placeholder="凭据名称（如 GitHub Action）" style={{ width: 200 }} />
                  <select value={newCredScopes[0] ?? ''} onChange={(e) => setNewCredScopes([e.target.value])}>
                    <option value="posts.read">posts.read（只读文章）</option>
                    <option value="posts.write">posts.write（读写文章）</option>
                    <option value="timeline.read">timeline.read（读时间线）</option>
                  </select>
                  <button className="btn slim" onClick={createCred}>创建</button>
                </Row>
                {credKeyOnce && (
                  <div className="cred-once">
                    <b>⚠ 密钥仅此一次展示：</b>
                    <code>{credKeyOnce}</code>
                    <button className="btn slim ghost" onClick={() => { navigator.clipboard?.writeText(credKeyOnce.split(': ')[1] ?? ''); toast('已复制') }}>复制</button>
                    <button className="btn slim ghost" onClick={() => setCredKeyOnce(null)}>我知道了</button>
                  </div>
                )}
                <Row k="已创建">
                  {creds.length === 0 ? <span className="dim">无凭据（明文密钥不落库，创建时仅展示一次）</span> : (
                    <div className="cred-list">
                      {creds.map((c) => (
                        <div key={String(c.id)} className={`cred-row${c.revokedAt ? ' revoked' : ''}`}>
                          <b>{String(c.name)}</b><code>{String(c.prefix)}…</code><em>{String((c.scopes as string[])?.join('、') ?? '')}</em>
                          {c.lastUsedAt ? <i>最近使用 {fmtTime(String(c.lastUsedAt))}</i> : <i>未使用</i>}
                          {!c.revokedAt && <button className="btn slim ghost danger-ghost" onClick={() => void revokeCred(String(c.id))}>撤销</button>}
                          {Boolean(c.revokedAt) && <span className="pill bad">已撤销</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </Row>
              </Sec>
              <Sec icon="globe" title="Webhook" tip="事件推送（创建/发布/更新/删除文章）；HMAC 签名、调用日志、失败自动重试 2 次">
                <Row k="新建 / 编辑">
                  <div className="hook-editor">
                    <input value={String((hookEditing as any)?.name ?? '')} placeholder="名称（如通知机器人）" onChange={(e) => setHookEditing((h) => ({ ...(h ?? {}), name: e.target.value }))} />
                    <input value={String((hookEditing as any)?.url ?? '')} placeholder="https://example.com/hook" onChange={(e) => setHookEditing((h) => ({ ...(h ?? {}), url: e.target.value }))} />
                    <label className="hook-ev" title="事件多选">
                      {['post.published', 'post.created', 'post.updated', 'post.deleted'].map((ev) => {
                        const list: string[] = Array.isArray((hookEditing as any)?.events) ? (hookEditing as any).events : []
                        return (
                          <label key={ev}><input type="checkbox" checked={list.includes(ev)} onChange={(e) => {
                            const next = e.target.checked ? [...list, ev] : list.filter((x) => x !== ev)
                            setHookEditing((h) => ({ ...(h ?? {}), events: next }))
                          }} />{ev}</label>
                        )
                      })}
                    </label>
                    <input value={String((hookEditing as any)?.secret ?? '')} placeholder="签名密钥（可选，HMAC-SHA256）" onChange={(e) => setHookEditing((h) => ({ ...(h ?? {}), secret: e.target.value }))} />
                    <button className="btn slim" disabled={!hookEditing?.name || !hookEditing?.url}
                      onClick={() => void saveHook({ name: (hookEditing as any)?.name, url: (hookEditing as any)?.url, events: (hookEditing as any)?.events ?? [], secret: (hookEditing as any)?.secret, enabled: hookEditing?.enabled ?? true })}>
                      保存
                    </button>
                    {!!hookEditing?.id && <button className="btn slim ghost" onClick={() => setHookEditing(null)}>取消</button>}
                    {!hookEditing && <button className="btn slim ghost" onClick={() => setHookEditing({ name: '', url: '', events: ['post.published'], secret: '', enabled: true })}>＋ 新建</button>}
                  </div>
                </Row>
                <Row k="已配置">
                  {hooks.length === 0 ? <span className="dim">暂无 Webhook（创建后发布文章将自动推送）</span> : (
                    <div className="hook-list">
                      {hooks.map((h) => (
                        <div key={String(h.id)} className="hook-row">
                          <span className={`pill ${h.enabled ? 'ok' : ''}`}>{h.enabled ? '启用' : '停用'}</span>
                          <b>{String(h.name)}</b>
                          <code>{String(h.url)}</code>
                          <em>{String((h.events as string[])?.join('、') ?? '')}</em>
                          <i>{h.enabled ? (h.lastStatus ? `最近 HTTP ${h.lastStatus}` : '未调用') : '已停用'}</i>
                          <button className="btn slim ghost" onClick={() => { setHookEditing({ ...h, secret: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>编辑</button>
                          <button className="btn slim ghost" onClick={() => void testHook(String(h.id))}>测试</button>
                          <button className="btn slim ghost" onClick={() => void toggleHook(h)}>{h.enabled ? '停用' : '启用'}</button>
                          <button className="btn slim ghost" onClick={() => void showCalls(String(h.id))}>调用日志</button>
                          <button className="btn slim ghost danger-ghost" onClick={() => void deleteHook(String(h.id))}>删除</button>
                          {hookCalls[String(h.id)] ? (
                            <div className="hook-calls">
                              {(hookCalls[String(h.id)] as Array<{ id: string; event: string; status: number; error: string; sentAt: string }>).map((c) => (
                                <div key={c.id}><code>HTTP {c.status}</code><em>{c.event}</em><i>{fmtTime(c.sentAt)}</i>{c.error ? <b>{c.error}</b> : null}</div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Row>
              </Sec>
              <Sec icon="bell" title="RSS 订阅（互相关注）" tip="订阅其他伙伴博客的 RSS/Atom 源，内容发现与随缘抓取（点击刷新）">
                <Row k="添加订阅">
                  <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://example.com/rss.xml" style={{ width: 300 }} />
                  <button className="btn slim" onClick={subscribeFeed} disabled={feedBusy}>{feedBusy ? '抓取中…' : '订阅'}</button>
                </Row>
                <Row k="已订阅">
                  {feeds.length === 0 ? <span className="dim">暂无订阅（支持 RSS 2.0 / Atom）</span> : (
                    <div className="feed-list">
                      {feeds.map((f) => (
                        <div key={String(f.id)} className="feed-row">
                          <b>{String(f.title)}</b>
                          <a href={String(f.url)} target="_blank" rel="noreferrer noopener">{String(f.url)}</a>
                          <em>{String(f.itemCount ?? 0)} 条内容</em>
                          <button className="btn slim ghost" onClick={() => void refreshFeed(String(f.id))}>刷新</button>
                          <button className="btn slim ghost danger-ghost" onClick={() => void removeFeed(String(f.id))}>取消订阅</button>
                        </div>
                      ))}
                    </div>
                  )}
                </Row>
              </Sec>
            </>
          )}

          {g === 'about' && (
            <>
              <Sec icon="help" title="云笺集" tip="以时间线为首页的个人创作工作台">
                <Row k="版本" tip="版本递增：小版本每次更新 +1，中版本累计小版本数后递增，大版本随重大能力升级递增">
                  <span className="v-number">v1.0</span>
                </Row>
              </Sec>
              <Sec icon="book" title="更新记录" tip="每个版本的版本号 / 发布时间 / 新增 / 优化 / 修复 / 重大变更">
                <Changelog />
              </Sec>
              <Sec icon="help" title="帮助" tip="按功能模块整理的完整使用文档与常见问题">
                <div className="help-list">
                  {[
                    ['开始使用', '登录后进入时间线首页；左侧「⚡ 速记」或 Ctrl/⌘+N 快速记录。'],
                    ['写文章', '「文章」→ 新建草稿；斜杠菜单 / 选中浮动工具栏排版；[[ 插入双链；保存自动进行。'],
                    ['目标与日常', '「目标」拆解长期目标并关联计划/习惯；「日常」查看今日待办与打卡。'],
                    ['记账与检索', '「记账本」记录收支；「检索」全文搜索文章与笔记。'],
                    ['常见问题', '忘记密码：登录页「找回密码」发邮件重置；丢失两步验证：设置 → 账户 → 无法验证走邮箱恢复。'],
                  ].map(([t, d]) => (
                    <div key={t} className="help-item"><b>{t}</b><span>{d}</span></div>
                  ))}
                </div>
              </Sec>
              <Sec icon="mail" title="反馈" tip="填写反馈内容后通过邮件发送（SMTP），收件邮箱为账户中配置的默认反馈接收邮箱">
                <FeedbackForm defaultEmail={user?.email ?? ''} />
              </Sec>
            </>
          )}
        </div>
      </div>

      {/* 修改密码弹窗（需求 12：中英文必须同时包含） */}
      {pwdOpen && (
        <Modal title="修改密码" onClose={() => setPwdOpen(false)} footer={
          <><button className="btn ghost" onClick={() => setPwdOpen(false)}>取消</button>
            <button className="btn" onClick={changePwd}>确认修改</button></>
        }>
          <Field label="当前密码"><input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="新密码（≥8 位，必须同时包含中文与英文字母）"><input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" maxLength={128} /></Field>
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

      {/* 两步验证弹窗（开启 / 关闭 复用；输入样式与设置页一致） */}
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
              {tfaQr && <div style={{ textAlign: 'center', marginBottom: 10 }}><img src={tfaQr} alt="TOTP 二维码" width={200} height={200} style={{ borderRadius: 10 }} /></div>}
              <Field label="手动输入密钥（无法扫码时）"><input readOnly value={tfaSecret} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'var(--mono)' }} /></Field>
              <Field label="6 位动态码"><input inputMode="numeric" maxLength={6} value={tfaToken} onChange={(e) => setTfaToken(e.target.value.replace(/\D/g, ''))} placeholder="123456" autoFocus /></Field>
            </>
          )}
        </Modal>
      )}

      {/* 两步验证邮箱恢复弹窗（需求 7：安全托底） */}
      {recoverOpen && (
        <Modal title="两步验证安全恢复" onClose={() => setRecoverOpen(false)} footer={
          recoverStep === 'send'
            ? <button className="btn" onClick={sendRecovery} disabled={recoverBusy}>{recoverBusy ? '发送中…' : '发送恢复码到绑定邮箱'}</button>
            : <><button className="btn ghost" onClick={() => setRecoverStep('send')}>返回</button>
                <button className="btn" onClick={confirmRecovery} disabled={recoverBusy || recoverCode.length < 4}>{recoverBusy ? '验证中…' : '确认安全重置'}</button></>
        }>
          {recoverStep === 'send' ? (
            <p className="dim" style={{ fontSize: 13, lineHeight: 1.7 }}>
              无法完成两步验证时，可向已验证邮箱 <b>{user.email}</b> 发送一次性恢复码（15 分钟有效，仅一次，次数受限并全程留痕）。
              确认后两步验证将被安全关闭并撤销全部会话，需重新登录并尽快重新绑定验证器。
            </p>
          ) : (
            <>
              <p className="dim" style={{ fontSize: 13, margin: '0 0 10px' }}>已发送恢复码，请输入邮件中的 8 位恢复码。</p>
              <Field label="恢复码（区分大小写）"><input value={recoverCode} onChange={(e) => setRecoverCode(e.target.value.toUpperCase())} placeholder="如 ABC23XYZ" maxLength={8} /></Field>
            </>
          )}
        </Modal>
      )}
    </div>
  )
}

/* 头像预览（含装饰：边框 / 徽章） */
function AvatarPreview({ user }: { user: User }) {
  const src = user?.avatar
    ? (user.avatar.startsWith('/api') || user.avatar.startsWith('http') ? user.avatar : `/api/v2/avatars/${user.avatar}`)
    : ''
  return (
    <div className={`av-preview${user?.avatarFrame ? ` f-${user.avatarFrame}` : ''}${user?.avatarBadge ? ` b-${user.avatarBadge}` : ''}`}>
      {src ? <img src={src} alt="头像预览" /> : <span className="av-null">?</span>}
    </div>
  )
}

/* 更新记录（需求 25：版本 / 发布 / 新增 / 优化 / 修复 / 重大变更，含问题持续修复分析机制的说明） */
function Changelog() {
  return (
    <div className="changelog">
      <div className="cl-item current">
        <b>v1.0</b><em>2026-09-04</em>
        <ul>
          <li>✨ 新增：GitHub 快捷入口（应用内抽屉）、RSS 生成与订阅、活动日志系统、Webhook 与 API 凭据、头像上传与装饰、两步验证邮箱恢复、站点自定义中心、可扩展主题系统</li>
          <li>🔧 优化：编辑页布局（白色画布铺满 + 文档信息置顶）、侧边栏默认折叠与动画、设置页左右两栏与 Tooltip、登录设备信息改为客户端真实数据</li>
          <li>🐛 修复：编辑页选中文字导致崩溃的风险路径（抑制解析回灌反馈环 + 全局错误兜底）、存储模式错误显示、双模输入样式统一</li>
          <li>📌 重大变更：版本从 v0.x 升入 v1.0，密码规则调整为「必须包含中文与英文」</li>
        </ul>
      </div>
      <div className="cl-note">版本递增：小版本=每次更新递增；中版本=累计约定数量递增；大版本=功能/架构/能力重大升级递增。</div>
      <div className="cl-note">问题持续修复分析：同一问题多次未根治时，将记录首次发现时间、每次修复内容与为何未根治，判断是否为根因定位错误或关联模块影响，直至最终方案落地。</div>
    </div>
  )
}

/* 反馈表单（需求 26：填写 → 邮件发送，展示状态与结果） */
function FeedbackForm({ defaultEmail }: { defaultEmail: string }) {
  const toast = useToast()
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'idle' | 'sent' | 'fail'>('idle')
  const to = localStorage.getItem('cl_feedback_email') || defaultEmail
  const send = async () => {
    if (!subject.trim() || !content.trim()) { toast('请填写主题与反馈内容', 'err'); return }
    setBusy(true); setResult('idle')
    try {
      await api.post<{ ok: boolean }>('/feedback', { subject: subject.trim(), content: content.trim(), to })
      setResult('sent')
      setSubject(''); setContent('')
      toast('反馈已发送')
    } catch (e: any) {
      setResult('fail')
      toast(e?.message || '发送失败', 'err')
    } finally { setBusy(false) }
  }
  return (
    <div className="feedback">
      <label>主题<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="反馈主题" maxLength={80} /></label>
      <label>内容<textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="请描述你遇到的问题或建议…" /></label>
      <div className="fb-foot">
        <span className="dim">收件：{to}</span>
        <button className="btn slim" onClick={send} disabled={busy}>{busy ? '发送中…' : '发送反馈'}</button>
        {result === 'sent' && <span className="pill ok">已发送 ✓</span>}
        {result === 'fail' && <span className="pill bad">发送失败</span>}
      </div>
    </div>
  )
}

/** 胶囊主题下拉（选项带色块，选中即时保存） */
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