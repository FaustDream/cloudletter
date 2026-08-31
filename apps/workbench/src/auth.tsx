/** 认证上下文：登录 /me 守卫 / 登出（单管理员，无 2FA） */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, setToken, getToken, type User } from './api'

interface AuthState {
  user: User | null
  loading: boolean
  login: (email: string, password: string, remember?: boolean, captcha?: { id: string; answer: string }, totp?: string) => Promise<void>
  logout: () => Promise<void>
  /** 更新个人资料（昵称），成功后同步到全局 user */
  updateProfile: (nickname: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

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
      .catch((e) => {
        // 仅会话无效（401）时清 token；网络抖动/服务 500 不强制重新登录
        if (e instanceof ApiError && (e.status === 401 || e.code === 'AUTH_REQUIRED')) setToken(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = async (email: string, password: string, remember = false, captcha?: { id: string; answer: string }, totp?: string) => {
    // 登录返回 { token, email }，再拉 /auth/me 拿完整 user
    const r = await api.post<{ token: string }>('/auth/login', {
      email, password, remember,
      captchaId: captcha?.id, captcha: captcha?.answer,
      totp,
    })
    setToken(r.token)
    const me = await api.get<{ user: User }>('/auth/me')
    setUser(me.user)
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

  const updateProfile = async (nickname: string) => {
    const r = await api.put<{ user: User }>('/auth/profile', { nickname })
    setUser(r.user)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用')
  return ctx
}