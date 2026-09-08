/**
 * 设置中心 · 账户分组（从 SettingsPage 拆出）：
 * - 个人资料（昵称 / 头像上传 / 头像装饰）、登录邮箱、密码（中英文规则）
 * - 两步验证（TOTP 含邮箱安全恢复）、登录设备、退出登录（极简）
 * - 数据加载：两步验证状态与登录设备挂载即拉取（原 loadAll 拆分至此）
 */
import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useAuth } from '../../auth'
import { Modal, Field } from '../../components/framework/Modal'
import { useToast } from '../../components/framework/Toast'
import { api, type User } from '../../api'
import { Sec, Row, fmtTime } from './shared'

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

/* 头像预览（含装饰：边框 / 徽章） */
const AvatarPreview = ({ user }: { user: User }) => {
  const src = user?.avatar
    ? (user.avatar.startsWith('/api') || user.avatar.startsWith('http') ? user.avatar : `/api/v2/avatars/${user.avatar}`)
    : ''
  return (
    <div className={`av-preview${user?.avatarFrame ? ` f-${user.avatarFrame}` : ''}${user?.avatarBadge ? ` b-${user.avatarBadge}` : ''}`}>
      {src ? <img src={src} alt="头像预览" /> : <span className="av-null">?</span>}
    </div>
  )
}

export const AccountGroup = () => {
  const { user, logout, updateProfile } = useAuth()
  const toast = useToast()
  const [nick, setNick] = useState(user?.nickname ?? '')
  const [pwdOpen, setPwdOpen] = useState(false)
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [emailOpen, setEmailOpen] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailPwd, setEmailPwd] = useState('')

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

  // 登录设备（最近登录的客户端信息，在账户分组内展示与加载）
  const [devices, setDevices] = useState<Array<Record<string, string>>>([])

  const loadTfa = () =>
    api.get<{ enabled: boolean; pending: boolean }>('/auth/2fa/status').then(setTfaStatus).catch(() => {})
  const loadDevices = () => {
    api.get<{ records: any[] }>('/auth/devices').then((r) => setDevices(r.records)).catch(() => {})
  }

  // 挂载即加载（原 loadAll 按需拆分）
  useEffect(() => {
    loadTfa()
    loadDevices()
  }, [])

  if (!user) return null

  /* ========== 账户 ========== */
  const saveProfile = async () => {
    try {
      await updateProfile(nick.trim())
      toast('个人资料已保存')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }

  const changePwd = async () => {
    if (!/[0-9]/.test(newPwd) || !/[a-zA-Z]/.test(newPwd)) {
      toast('新密码必须同时包含数字与英文字母', 'err')
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

  const isCurrentDev = (deviceId: string) => !!deviceId && deviceId === localStorage.getItem('cl_dev')

  return (
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
        <Row k="登录密码" tip="至少 8 位，必须同时包含数字与英文字母；修改后撤销其他会话">
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

      {/* 修改密码弹窗（需求 12：中英文必须同时包含） */}
      {pwdOpen && (
        <Modal title="修改密码" onClose={() => setPwdOpen(false)} footer={
          <><button className="btn ghost" onClick={() => setPwdOpen(false)}>取消</button>
            <button className="btn" onClick={changePwd}>确认修改</button></>
        }>
          <Field label="当前密码"><input type="password" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} autoComplete="current-password" /></Field>
          <Field label="新密码（≥8 位，必须同时包含数字与英文字母）"><input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" maxLength={128} /></Field>
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
              <p className="dim" style={{ fontSize: 'var(--fs-body)', margin: '0 0 10px' }}>关闭需要当前密码与一次有效动态码。</p>
              <Field label="当前密码"><input type="password" value={tfaDisablePwd} onChange={(e) => setTfaDisablePwd(e.target.value)} autoComplete="current-password" /></Field>
              <Field label="6 位动态码"><input inputMode="numeric" maxLength={6} value={tfaToken} onChange={(e) => setTfaToken(e.target.value.replace(/\D/g, ''))} placeholder="123456" /></Field>
            </>
          ) : (
            <>
              <p className="dim" style={{ fontSize: 'var(--fs-body)', margin: '0 0 10px' }}>1. 用 Authenticator（Google / 微软 / 1Password 等）扫码；2. 输入 App 显示的 6 位动态码确认。</p>
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
            <p className="dim" style={{ fontSize: 'var(--fs-body)', lineHeight: 1.7 }}>
              无法完成两步验证时，可向已验证邮箱 <b>{user.email}</b> 发送一次性恢复码（15 分钟有效，仅一次，次数受限并全程留痕）。
              确认后两步验证将被安全关闭并撤销全部会话，需重新登录并尽快重新绑定验证器。
            </p>
          ) : (
            <>
              <p className="dim" style={{ fontSize: 'var(--fs-body)', margin: '0 0 10px' }}>已发送恢复码，请输入邮件中的 8 位恢复码。</p>
              <Field label="恢复码（区分大小写）"><input value={recoverCode} onChange={(e) => setRecoverCode(e.target.value.toUpperCase())} placeholder="如 ABC23XYZ" maxLength={8} /></Field>
            </>
          )}
        </Modal>
      )}
    </>
  )
}
