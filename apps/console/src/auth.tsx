/** 认证上下文：登录（含 2FA challenge）/me 守卫/登出 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, setToken, getToken, type User } from './api'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<'ok' | '2fa'>
  verify2fa: (tempToken: string, code: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState>(null as unknown as AuthState)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .get<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string) => {
    try {
      const res = await fetch('/api/v2/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 423 && data?.challenge === '2fa') {
        sessionStorage.setItem('cl_temp', data.tempToken)
        return '2fa'
      }
      if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? '登录失败')
      setToken(data.token)
      setUser(data.user)
      return 'ok'
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(0, 'NETWORK', '网络错误，请稍后重试')
    }
  }

  const verify2fa = async (tempToken: string, code: string) => {
    try {
      const res = await fetch('/api/v2/auth/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken, code }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'UNKNOWN', data?.error?.message ?? '验证失败')
      setToken(data.token)
      setUser(data.user)
    } catch (e) {
      if (e instanceof ApiError) throw e
      throw new ApiError(0, 'NETWORK', '网络错误，请稍后重试')
    }
  }

  const logout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      /* 会话可能已过期 */
    }
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, verify2fa, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
