/** 登录页：邮箱+密码 → （已启用2FA时）TOTP 二次验证（§6.1） */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export function Login() {
  const { login, verify2fa } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [need2fa, setNeed2fa] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (!need2fa) {
        const r = await login(email, password)
        if (r === '2fa') setNeed2fa(true)
        else nav('/', { replace: true })
      } else {
        const temp = sessionStorage.getItem('cl_temp') ?? ''
        await verify2fa(temp, code)
        nav('/', { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="logo">云笺集</span>
          <span className="sub">写作空间 · Writing Space</span>
        </div>
        {!need2fa ? (
          <>
            <label>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@cloudletter.local"
                required
                autoFocus
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </>
        ) : (
          <label>
            两步验证码（TOTP）
            <input
              className="totp-input"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6 位验证码"
              autoFocus
              required
            />
          </label>
        )}
        {error && <div className="login-error">{error}</div>}
        <button type="submit" disabled={busy}>
          {busy ? '验证中…' : need2fa ? '验证并进入' : '登录'}
        </button>
      </form>
    </div>
  )
}
