/** 工作台路由：内容(总览/文章/灵感/组织/检索) + 日常(目标三合一) + 记账 + 账号，旧路径重定向 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { Shell } from './components/framework/Shell'
import { ToastProvider } from './components/framework/Toast'
import { QuickActionsProvider } from './components/framework/QuickActions'
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/OverviewPage'
import { PostsPage } from './pages/PostsPage'
import { EditorPage, NewPostPage } from './pages/EditorPage'
import { NotesPage } from './pages/NotesPage'
import { OrganizePage } from './pages/OrganizePage'
import { SearchPage } from './pages/SearchPage'
import { GoalsHomePage } from './pages/GoalsHomePage'
import { DailyPage } from './pages/DailyPage'
import { LedgerPage } from './pages/LedgerPage'
import { SettingsPage } from './pages/SettingsPage'

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>载入中…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function LoginRoute() {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>载入中…</div>
  if (user) return <Navigate to="/" replace />
  return <LoginPage />
}

/** 旧路径 → 新路径重定向（分类/标签并入组织页，计划/习惯/目标并入目标页） */
function Redirect({ to }: { to: string }) {
  return <Navigate to={to} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route
              path="/*"
              element={
                <Guard>
                  <QuickActionsProvider>
                  <Shell>
                    <Routes>
                      <Route index element={<OverviewPage />} />
                      {/* 内容 */}
                      <Route path="posts" element={<PostsPage />} />
                      <Route path="posts/new" element={<NewPostPage />} />
                      <Route path="posts/:id/edit" element={<EditorPage />} />
                      <Route path="notes" element={<NotesPage />} />
                      <Route path="organize" element={<OrganizePage />} />
                      <Route path="search" element={<SearchPage />} />
                      {/* 日常 */}
                      <Route path="daily" element={<DailyPage />} />
                      <Route path="goals-home" element={<GoalsHomePage />} />
                      {/* 记账 */}
                      <Route path="ledger" element={<LedgerPage />} />
                      {/* 设置（账户已并入设置中心） */}
                      <Route path="settings" element={<SettingsPage />} />
                      {/* 旧路径兼容重定向 */}
                      <Route path="account" element={<Redirect to="/settings" />} />
                      <Route path="categories" element={<Redirect to="/organize?tab=category" />} />
                      <Route path="tags" element={<Redirect to="/organize?tab=tag" />} />
                      <Route path="plan" element={<Redirect to="/goals-home?tab=plan" />} />
                      <Route path="checkin" element={<Redirect to="/goals-home?tab=checkin" />} />
                      <Route path="goals" element={<Redirect to="/goals-home?tab=goal" />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Shell>
                  </QuickActionsProvider>
                </Guard>
              }
            />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}