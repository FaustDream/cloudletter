import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { Login } from './components/Login'
import { WritingSpace } from './components/WritingSpace'

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot">载入中…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 已登录者访问 /login 时直接回到写作空间 */
function LoginRoute() {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot">载入中…</div>
  if (user) return <Navigate to="/" replace />
  return <Login />
}

export default function App() {
  return (
    <BrowserRouter basename="/dev/write">
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route
            path="/"
            element={
              <Guard>
                <WritingSpace />
              </Guard>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
