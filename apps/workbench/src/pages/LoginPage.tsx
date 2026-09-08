/** 登录页：密码登录 / 邮箱验证码登录 双 Tab + 忘记密码（重置链接） + URL 重置令牌直达新密码 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { api } from '../api'
import { Icon } from '../components/framework/Icon'
import { FxEngine } from '../components/framework/FxEngine'
import { TotpField, type TfaRecoverState } from './login/TotpField'
import { ResetPanel } from './login/ResetPanel'
import { ResetPasswordModal } from './login/ResetPasswordModal'
import { CaptchaModal } from './login/CaptchaModal'
import { LockModal } from './login/LockModal'

type Mode = 'pwd' | 'code'
type Help = null | 'forgot'

/** “记住我”：本地保存邮箱与勾选状态，登录成功时写入 */
const REMEMBER_EMAIL_KEY = 'cl_remember_email'
const REMEMBER_FLAG_KEY = 'cl_remember_flag'

/** 登录接口错误包络（ApiError 形状；网络故障为 TypeError） */
interface LoginError {
  code?: string
  message?: string
  details?: { captchaId?: string; captchaSvg?: string; remainSeconds?: number }
}

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
  /** 两步验证邮箱安全恢复（需求 7：无法完成验证时的托底） */
  const [tfaRecover, setTfaRecover] = useState<TfaRecoverState>({
    open: false, step: 'send', code: '', busy: false, msg: '', err: '',
  })
  const [busy, setBusy] = useState(false)
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string; code?: string }>({})
  const [help, setHelp] = useState<Help>(null)
  const [sentMsg, setSentMsg] = useState('')
  const [countdown, setCountdown] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // 失败防护：图形验证码弹窗 + 锁定/邮箱解锁弹窗（验证码仅以图片 data URI 返回，不落明文）
  const [captchaMeta, setCaptchaMeta] = useState<{ captchaId: string; captchaSvg: string } | null>(null)
  const [showCaptcha, setShowCaptcha] = useState(false)
  const [captchaInput, setCaptchaInput] = useState('')
  const [captchaErr, setCaptchaErr] = useState('')
  const [showLock, setShowLock] = useState(false)
  const [lockRemain, setLockRemain] = useState(0)

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
  const handlePwdError = (ex: LoginError) => {
    switch (ex?.code) {
      case 'CAPTCHA_REQUIRED':
      case 'CAPTCHA_INVALID': {
        const d = ex?.details
        setCaptchaMeta({ captchaId: d?.captchaId, captchaSvg: d?.captchaSvg ?? '' } as { captchaId: string; captchaSvg: string })
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
        // 解锁流程状态由 LockModal 自持，弹窗每次重开即复位
        setShowCaptcha(false)
        setLockRemain(Number(ex?.details?.remainSeconds ?? 0))
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
    } catch (ex) {
      handlePwdError(ex as LoginError)
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
    } catch (ex) {
      const e = ex as LoginError
      if (e?.code === 'CAPTCHA_REQUIRED') {
        const d = e?.details
        setCaptchaMeta({ captchaId: d?.captchaId, captchaSvg: d?.captchaSvg ?? '' } as { captchaId: string; captchaSvg: string })
        setCaptchaInput('')
        setCaptchaErr('')
      } else {
        setCaptchaErr('验证码刷新失败，请重试')
      }
    } finally { setBusy(false) }
  }

  const sendCode = async () => {
    setErr(''); setSentMsg('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setFieldErr({ email: '请输入有效的邮箱地址' }); return }
    const hasUser = await api.post('/auth/send-code', { email: email.trim() }).catch((e) => { setErr(e?.message || '发送失败'); return null })
    if (!hasUser) return
    startCountdown()
    const d = hasUser as { mode?: string; dev?: { code?: string } }
    if (d?.mode === 'demo' && d?.dev?.code) {
      setSentMsg(`演示环境：验证码已生成 → ${d.dev.code}（邮件已落盘）`)
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
    } catch (ex) {
      setErr((ex as { message?: string })?.message || '验证码登录失败')
    } finally { setBusy(false) }
  }

  const doReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    if (newPwd.length < 8) { setErr('新密码至少 8 位'); return }
    // 与服务端 passwordRule 同口径：必须同时包含数字与英文字母
    if (!/[0-9]/.test(newPwd) || !/[a-zA-Z]/.test(newPwd)) { setErr('新密码必须同时包含数字与英文字母'); return }
    setBusy(true)
    try {
      await api.post('/auth/reset', { email: resetEmail, token: resetToken, newPassword: newPwd })
      // 重置成功：服务端已撤销全部会话，本地失效凭据一并清掉
      void import('../api').then(({ setToken }) => setToken(null))
      setResetDone(true)
    } catch (ex) {
      setErr((ex as { message?: string })?.message || '重置失败，链接可能已失效')
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
          <ResetPanel
            email={resetEmail}
            newPwd={newPwd}
            onNewPwdChange={setNewPwd}
            showPwd={showPwd}
            onToggleShowPwd={() => setShowPwd((v) => !v)}
            busy={busy}
            resetDone={resetDone}
            onSubmit={doReset}
            onBack={() => { nav('/login', { replace: true }); setResetDone(false); setMode('pwd') }}
          />
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
                  <TotpField
                    value={totp}
                    onValueChange={setTotp}
                    email={email}
                    recover={tfaRecover}
                    onRecoverChange={setTfaRecover}
                    onRecovered={() => { setTotpStep(false); setTotp('') }}
                  />
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
                  <p className="dim" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }}>验证码发送到该邮箱，10 分钟内有效；仅用于登录本账户。</p>
                </div>
                <button className="btn lblk" type="submit" disabled={busy}>{busy ? '登录中…' : '验证码登录'}</button>
              </form>
            )}
          </>
        )}
      </div>

      {/* 忘记密码 / 首次使用 弹窗 */}
      {help === 'forgot' && (
        <ResetPasswordModal
          email={email}
          onEmailChange={setEmail}
          err={err}
          sentMsg={sentMsg}
          busy={busy}
          onSetErr={setErr}
          onSetSentMsg={setSentMsg}
          onSetFieldErr={setFieldErr}
          onClose={() => setHelp(null)}
        />
      )}

      {/* 图形验证码弹窗：连续失败 ≥3 次后弹出（后端签发，服务端校验） */}
      {showCaptcha && captchaMeta && (
        <CaptchaModal
          captchaSvg={captchaMeta.captchaSvg}
          value={captchaInput}
          onValueChange={setCaptchaInput}
          err={captchaErr}
          busy={busy}
          onRefresh={refreshCaptcha}
          onConfirm={onCaptchaConfirm}
          onClose={() => setShowCaptcha(false)}
        />
      )}

      {/* 锁定弹窗：连续失败 5 次后锁定，可通过邮箱验证码立即解锁 */}
      {showLock && (
        <LockModal
          email={email}
          remainSeconds={lockRemain}
          onSentMsg={setSentMsg}
          onClose={() => setShowLock(false)}
        />
      )}
    </div>
  )
}
