/** 登录页：密码登录 / 邮箱验证码登录 双 Tab + 忘记密码（重置链接） + URL 重置令牌直达新密码 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { api } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal } from '../components/framework/Modal'
import { FxEngine } from '../components/framework/FxEngine'

type Mode = 'pwd' | 'code'
type Help = null | 'forgot'

/** “记住我”：本地保存邮箱与勾选状态，登录成功时写入 */
const REMEMBER_EMAIL_KEY = 'cl_remember_email'
const REMEMBER_FLAG_KEY = 'cl_remember_flag'

export function LoginPage() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const resetToken = sp.get('reset') || ''
  const resetEmail = sp.get('email') || ''

  const [mode, setMode] = useState<Mode>('pwd')
  const [email, setEmail] = useState(resetEmail)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [remember, setRemember] = useState(false)
  const [err, setErr] = useState('')
  const [totp, setTotp] = useState('')
  const [totpStep, setTotpStep] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string; code?: string }>({})
  const [help, setHelp] = useState<Help>(null)
  const [sentMsg, setSentMsg] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [resetLink, setResetLink] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // 失败防护：图形验证码弹窗 + 锁定/邮箱解锁弹窗（验证码仅以图片 data URI 返回，不落明文）
  const [captchaMeta, setCaptchaMeta] = useState<{ captchaId: string; captchaSvg: string } | null>(null)
  const [showCaptcha, setShowCaptcha] = useState(false)
  const [captchaInput, setCaptchaInput] = useState('')
  const [captchaErr, setCaptchaErr] = useState('')
  const [showLock, setShowLock] = useState(false)
  const [lockRemain, setLockRemain] = useState(0)
  const [unlockStage, setUnlockStage] = useState<'idle' | 'sent'>('idle')
  const [unlockCode, setUnlockCode] = useState('')
  const [unlockMsg, setUnlockMsg] = useState('')
  const [unlockErr, setUnlockErr] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)

  // 重置密码流程状态
  const [newPwd, setNewPwd] = useState('')
  const [resetDone, setResetDone] = useState(false)

  useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])

  // 恢复“记住我”的邮箱与勾选状态（重置流程优先，不覆盖）
  useEffect(() => {
    if (resetEmail) return
    const saved = localStorage.getItem(REMEMBER_EMAIL_KEY)
    if (saved) setEmail(saved)
    if (localStorage.getItem(REMEMBER_FLAG_KEY) === '1') setRemember(true)
  }, [resetEmail])

  const startCountdown = () => {
    setCountdown(60)
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1 && timer.current) clearInterval(timer.current)
        return c - 1
      })
    }, 1000)
  }

  /** 按错误码分流：验证码弹窗 / 锁定与邮箱解锁 / 普通错误 */
  const handlePwdError = (ex: any) => {
    switch (ex?.code) {
      case 'CAPTCHA_REQUIRED':
      case 'CAPTCHA_INVALID': {
        const d = ex?.details
        setCaptchaMeta({ captchaId: d?.captchaId, captchaSvg: d?.captchaSvg ?? '' })
        setCaptchaInput('')
        setCaptchaErr(ex?.code === 'CAPTCHA_INVALID' ? '验证码错误，已更换新验证码' : '')
        setErr(ex?.code === 'CAPTCHA_INVALID' ? '' : (ex?.message ?? ''))
        setShowCaptcha(true)
        break
      }
      case 'TOTP_REQUIRED':
        setShowCaptcha(false)
        setTotpStep(true)
        setErr('')
        break
      case 'TOTP_INVALID':
        setTotpStep(true)
        setErr('两步验证码错误或已过期，请重试')
        break
      case 'ACCOUNT_LOCKED':
        setShowCaptcha(false)
        setLockRemain(Number(ex?.details?.remainSeconds ?? 0))
        setUnlockStage('idle')
        setUnlockCode('')
        setUnlockMsg('')
        setUnlockErr('')
        setErr('')
        setShowLock(true)
        break
      default:
        setErr(ex?.code === 'AUTH_REQUIRED' ? '邮箱或密码不正确'
          : ex instanceof TypeError ? '无法连接服务器，请确认后端服务已启动'
          : ex?.message?.startsWith('HTTP') ? '服务器开小差了，请稍后重试'
          : ex?.message || '登录失败，请检查网络后重试')
    }
  }

  const submitPwd = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setErr(''); setSentMsg('')
    const fe: { email?: string; password?: string } = {}
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) fe.email = '请输入有效的邮箱地址'
    if (password.length < 6) fe.password = '密码至少 6 位'
    setFieldErr(fe)
    if (Object.keys(fe).length) return
    setBusy(true)
    try {
      // 若已进入验证码阶段，携带验证码一起提交（服务端校验）
      const cap = captchaMeta && captchaInput ? { id: captchaMeta.captchaId, answer: captchaInput } : undefined
      await login(email.trim(), password, remember, cap, totp || undefined)
      // “记住我”：勾选则保存邮箱与勾选状态，取消则清除
      if (remember) {
        localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim())
        localStorage.setItem(REMEMBER_FLAG_KEY, '1')
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_KEY)
        localStorage.removeItem(REMEMBER_FLAG_KEY)
      }
      setShowCaptcha(false)
      await goHome()
    } catch (ex: any) {
      handlePwdError(ex)
    } finally { setBusy(false) }
  }

  /** 验证码弹窗：确认后携带验证码重新登录（后端未通过会返回新验证码并再次弹窗） */
  const onCaptchaConfirm = () => {
    if (captchaInput.trim().length !== 4) { setCaptchaErr('请输入 4 位验证码'); return }
    setShowCaptcha(false)
    setCaptchaErr('')
    void submitPwd()
  }

  /** 点击验证码刷新：重新请求签发（后端会作废旧码并返回新码） */
  const refreshCaptcha = async () => {
    setBusy(true)
    try {
      await login(email.trim(), password, remember, undefined)
    } catch (ex: any) {
      if (ex?.code === 'CAPTCHA_REQUIRED') {
        const d = ex?.details
        setCaptchaMeta({ captchaId: d?.captchaId, captchaSvg: d?.captchaSvg ?? '' })
        setCaptchaInput('')
        setCaptchaErr('')
      } else {
        setCaptchaErr('验证码刷新失败，请重试')
      }
    } finally { setBusy(false) }
  }

  /** 锁定弹窗：发送邮箱解锁验证码 */
  const startUnlock = async () => {
    setUnlockBusy(true); setUnlockMsg(''); setUnlockErr('')
    try {
      const r = await api.post('/auth/send-unlock', { email: email.trim() })
      if ((r as any)?.mode === 'demo' && (r as any)?.dev?.code) {
        setUnlockMsg(`演示环境：解锁验证码已生成 → ${(r as any).dev.code}（邮件已落盘）`)
      } else {
        setUnlockMsg('解锁验证码已发送至邮箱，10 分钟内有效')
      }
      setUnlockStage('sent')
    } catch (ex: any) {
      setUnlockErr(ex?.message ?? '发送失败，请重试')
    } finally { setUnlockBusy(false) }
  }

  /** 锁定弹窗：提交邮箱验证码解锁，成功后回到登录 */
  const doUnlock = async () => {
    if (unlockCode.trim().length !== 6) { setUnlockErr('请输入 6 位验证码'); return }
    setUnlockBusy(true); setUnlockErr('')
    try {
      await api.post('/auth/unlock', { email: email.trim(), code: unlockCode.trim() })
      setShowLock(false)
      setUnlockStage('idle')
      setUnlockCode('')
      setUnlockMsg('')
      setUnlockErr('')
      setSentMsg('已解锁，请重新登录')
    } catch (ex: any) {
      setUnlockErr(ex?.message ?? '解锁失败，请重试')
    } finally { setUnlockBusy(false) }
  }

  const sendCode = async () => {
    setErr(''); setSentMsg('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setFieldErr({ email: '请输入有效的邮箱地址' }); return }
    const hasUser = await api.post('/auth/send-code', { email: email.trim() }).catch((e) => { setErr(e?.message || '发送失败'); return null })
    if (!hasUser) return
    startCountdown()
    if ((hasUser as any)?.mode === 'demo' && (hasUser as any)?.dev?.code) {
      setSentMsg(`演示环境：验证码已生成 → ${(hasUser as any).dev.code}（邮件已落盘）`)
    } else {
      setSentMsg('验证码已发送至邮箱，10 分钟内有效')
    }
  }

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(''); setSentMsg('')
    if (code.trim().length !== 6) { setFieldErr({ code: '请输入 6 位验证码' }); return }
    setBusy(true)
    try {
      const r = await api.post<{ token: string }>('/auth/login-by-code', { email: email.trim(), code: code.trim() })
      setTokenThenHome(r.token)
    } catch (ex: any) {
      setErr(ex?.message || '验证码登录失败')
    } finally { setBusy(false) }
  }

  const sendReset = async () => {
    setErr(''); setSentMsg('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setFieldErr({ email: '请输入有效的邮箱地址' }); return }
    const r = await api.post('/auth/send-reset', { email: email.trim() }).catch((e) => { setErr(e?.message || '发送失败'); return null })
    if (!r) return
    if ((r as any)?.mode === 'demo' && (r as any)?.dev?.link) {
      setResetLink(String((r as any).dev.link))
      setSentMsg('演示环境：重置链接已生成（见下方，可复制）')
      setHelp('forgot')
    } else {
      setResetLink('')
      setSentMsg('重置链接已发送至邮箱，15 分钟内有效')
      setHelp(null)
    }
  }

  /** 从后端返回的重置链接中提取 token + 邮箱，跳转到前端登录页的新密码面板 */
  const openResetPage = () => {
    try {
      const u = new URL(resetLink)
      nav(`/login${u.search}`, { replace: false })
    } catch { setErr('重置链接无效') }
  }

  const copyResetLink = async () => {
    try {
      await navigator.clipboard.writeText(resetLink)
      setSentMsg('重置链接已复制')
    } catch { setErr('复制失败，请手动选中链接') }
  }

  const doReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (newPwd.length < 8) { setErr('新密码至少 8 位'); return }
    setBusy(true)
    try {
      await api.post('/auth/reset', { email: resetEmail, token: resetToken, newPassword: newPwd })
      setResetDone(true)
    } catch (ex: any) {
      setErr(ex?.message || '重置失败，链接可能已失效')
    } finally { setBusy(false) }
  }

  const setTokenThenHome = async (token: string) => {
    const { setToken } = await import('../api')
    setToken(token)
    await goHome()
  }

  const goHome = async () => {
    const el = document.querySelector('.login-page')
    el?.classList.add('fade-out')
    await new Promise((r) => setTimeout(r, 220))
    // 默认页面（设置·偏好 真实生效）
    const def = localStorage.getItem('cl_default_page') || '/'
    nav(def, { replace: true })
  }

  const demoLink = help === 'forgot' && sentMsg.includes('复制')

  return (
    <div className="login-page">
      <FxEngine />
      <div className="login-card card">
        <div className="login-brand">
          <div className="sys"><Icon name="pen" size={26} /></div>
          <h1 className="lgo">云笺集</h1>
          <p className="lsub">CLOUDLETTER</p>
        </div>

        <div className="lsec">
          <h2 className="ltitle">
            {resetToken ? '设置新密码' : '登录账户'}
          </h2>
          <p className="ldesc">你的个人内容空间 · 文章 / 灵感 / 习惯 / 记账 / 计划</p>
        </div>

        {err && <div className="lerr" role="alert"><Icon name="x" size={14} /> {err}</div>}
        {sentMsg && <div className="lmsg" role="status">✓ {sentMsg}</div>}

        {resetToken ? (
          /* ===== 重置密码面板（由邮件中的一次性链接进入） ===== */
          !resetDone ? (
            <form onSubmit={doReset}>
              <div className="lfield">
                <label>邮箱</label>
                <div className="af-static" style={{ fontSize: 13.5 }}>{resetEmail} <span className="pill ok">待重置</span></div>
              </div>
              <div className="lfield">
                <label>新密码（至少 8 位）</label>
                <div className="lpwd">
                  <input type={showPwd ? 'text' : 'password'} value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" maxLength={128} placeholder="••••••••" />
                  <button type="button" className="lpwd-eye" onClick={() => setShowPwd((v) => !v)}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'} title={showPwd ? '隐藏密码' : '显示密码'}>
                    <Icon name={showPwd ? 'eye-off' : 'eye'} size={17} />
                  </button>
                </div>
                <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>该链接仅一次性有效，且不影响已发布内容与数据。</p>
              </div>
              <button className="btn lblk" type="submit" disabled={busy}>{busy ? '提交中…' : '确认重置'}</button>
            </form>
          ) : (
            <div className="lsec" style={{ margin: 0 }}>
              <div className="lmsg">✓ 密码已重置，请使用新密码登录</div>
              <button className="btn lblk" type="button" onClick={() => { nav('/login', { replace: true }); setResetDone(false); setMode('pwd') }}>返回登录</button>
            </div>
          )
        ) : (
          <>
            {/* ===== 密码 / 验证码 双 Tab ===== */}
            <div className="login-tabs">
              <button className={mode === 'pwd' ? 'on' : ''} onClick={() => { setMode('pwd'); setErr(''); setSentMsg('') }}>密码登录</button>
              <button className={mode === 'code' ? 'on' : ''} onClick={() => { setMode('code'); setErr(''); setSentMsg('') }}>验证码登录</button>
            </div>

            {mode === 'pwd' ? (
              <form onSubmit={submitPwd}>
              {totpStep && (
                <div className="lfield">
                  <label htmlFor="login-totp">两步验证码</label>
                  <input id="login-totp" inputMode="numeric" maxLength={6} value={totp} autoFocus
                    onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
                    placeholder="6 位动态码" style={{ letterSpacing: 6, fontFamily: 'var(--mono)' }} />
                </div>
              )}
                <div className="lfield">
                  <label htmlFor="login-email">邮箱</label>
                  <input id="login-email" className="email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" autoComplete="email" spellCheck={false} autoCapitalize="off" autoFocus aria-invalid={!!fieldErr.email} />
                  {fieldErr.email && <span className="lferr">{fieldErr.email}</span>}
                </div>
                <div className="lfield">
                  <label htmlFor="login-password">密码</label>
                  <div className="lpwd">
                    <input id="login-password" type={showPwd ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••" autoComplete="current-password" maxLength={128} aria-invalid={!!fieldErr.password} />
                    <button type="button" className="lpwd-eye" onClick={() => setShowPwd((v) => !v)}
                    aria-label={showPwd ? '隐藏密码' : '显示密码'} title={showPwd ? '隐藏密码' : '显示密码'}>
                    <Icon name={showPwd ? 'eye-off' : 'eye'} size={17} />
                  </button>
                  </div>
                  {fieldErr.password && <span className="lferr">{fieldErr.password}</span>}
                </div>
                <div className="lrow">
                  <label className="lcheck"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 记住我</label>
                  <button type="button" className="l-forgot" onClick={() => { setHelp('forgot'); setSentMsg('') }}>忘记密码？</button>
                </div>
                <button className="btn lblk" type="submit" disabled={busy}>{busy ? (<><span className="spinner" /> 登录中…</>) : '登 录'}</button>
              </form>
            ) : (
              <form onSubmit={submitCode}>
                <div className="lfield">
                  <label htmlFor="login-email">邮箱</label>
                  <input id="login-email" className="email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com" autoComplete="email" spellCheck={false} autoCapitalize="off" autoFocus aria-invalid={!!fieldErr.email} />
                  {fieldErr.email && <span className="lferr">{fieldErr.email}</span>}
                </div>
                <div className="lfield">
                  <label>验证码</label>
                  <div className="code-row">
                    <input type="text" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="6 位验证码" style={{ letterSpacing: '.4em', fontFamily: 'var(--mono)', fontSize: 17 }} />
                    <button type="button" className="btn slim ghost" onClick={sendCode} disabled={countdown > 0 || busy}>
                      {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                    </button>
                  </div>
                  {fieldErr.code && <span className="lferr">{fieldErr.code}</span>}
                  <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>验证码发送到该邮箱，10 分钟内有效；仅用于登录本账户。</p>
                </div>
                <button className="btn lblk" type="submit" disabled={busy}>{busy ? '登录中…' : '验证码登录'}</button>
              </form>
            )}
          </>
        )}
      </div>

      {/* 忘记密码 / 首次使用 弹窗 */}
      {help === 'forgot' && (
        <Modal title="重置密码（邮箱链接）" onClose={() => setHelp(null)} footer={
          <button className="btn" onClick={() => setHelp(null)}>关闭</button>
        }>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 12 }}>
            输入已注册的管理员邮箱，系统将发送一封<b>含一次性重置链接</b>的邮件。
            只有通过邮件里链接的操作才能重置密码（链接带加密密文，15 分钟内有效，使用一次即失效）。
          </p>
          <div className="lfield">
            <label>管理员邮箱</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <button className="btn lblk" type="button" onClick={sendReset} disabled={busy}>发送重置链接</button>
          {demoLink && (
            <div className="reset-link-box" style={{ marginTop: 12 }}>
              <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>演示环境链接（生产 SMTP 模式不展示）：</div>
              <code>{resetLink}</code>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn slim" type="button" onClick={copyResetLink}>复制链接</button>
                <button className="btn slim ghost" type="button" onClick={openResetPage}>打开重置页</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* 图形验证码弹窗：连续失败 ≥3 次后弹出（后端签发，服务端校验） */}
      {showCaptcha && captchaMeta && (
        <Modal title="安全验证" type="warning" size="sm" onClose={() => setShowCaptcha(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setShowCaptcha(false)}>取消</button>
            <button className="btn slim" data-modal-primary onClick={onCaptchaConfirm} disabled={busy}>验证</button>
          </>
        }>
          <p className="cap-desc">检测到多次登录失败，请输入下方图形验证码以继续</p>
          <div className="cap-stage">
            <button type="button" className="cap-box" onClick={refreshCaptcha} title="点击刷新验证码" disabled={busy} aria-label="刷新验证码">
              {captchaMeta.captchaSvg
                ? <img src={captchaMeta.captchaSvg} alt="图形验证码" draggable={false} />
                : <span className="cap-fallback">????</span>}
              <span className="cap-refresh">↻ 看不清？点击换一张</span>
            </button>
            <input className="cap-input" value={captchaInput}
              onChange={(e) => setCaptchaInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder="输入 4 位验证码" maxLength={4} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') onCaptchaConfirm() }} />
          </div>
          {captchaErr && <p className="cap-err">{captchaErr}</p>}
          <p className="cap-hint">图形验证码用于确认是本人操作 · 输入错误会自动更换新验证码</p>
        </Modal>
      )}

      {/* 锁定弹窗：连续失败 5 次后锁定，可通过邮箱验证码立即解锁 */}
      {showLock && (
        <Modal title="账户已锁定" type="danger" size="sm" onClose={() => setShowLock(false)} footer={
          unlockStage === 'sent' ? (
            <>
              <button className="btn ghost" onClick={() => setShowLock(false)}>稍后再试</button>
              <button className="btn slim" data-modal-primary onClick={doUnlock} disabled={unlockBusy}>
                {unlockBusy ? '解锁中…' : '解锁'}
              </button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => setShowLock(false)}>关闭</button>
          )
        }>
          <p className="lock-desc">连续登录失败次数过多，账户已冻结登录。</p>
          <p className="lock-time">剩余锁定时间：约 {Math.max(1, Math.ceil(lockRemain / 60))} 分钟</p>
          {unlockStage === 'idle' ? (
            <>
              <p className="lock-hint">输入管理员邮箱内收到的验证码即可立即解锁，无需等待倒计时。</p>
              <button className="btn lblk" type="button" onClick={startUnlock} disabled={unlockBusy}>
                {unlockBusy ? '发送中…' : '发送邮箱验证码解锁'}
              </button>
            </>
          ) : (
            <div className="lfield">
              <label>解锁验证码</label>
              <input type="text" inputMode="numeric" maxLength={6} value={unlockCode}
                onChange={(e) => setUnlockCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6 位验证码" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') doUnlock() }} />
            </div>
          )}
          {unlockMsg && <p className="cap-hint" style={{ color: 'var(--ok)' }}>{unlockMsg}</p>}
          {unlockErr && <p className="cap-err">{unlockErr}</p>}
        </Modal>
      )}
    </div>
  )
}