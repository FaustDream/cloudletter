/** 工作台路由：内容(总览/文章/灵感/分类标签/检索) + 日常 + 计划/目标/习惯 + 记账 + 账号，旧路径重定向 */
import { BrowserRouter, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { Shell } from './components/framework/Shell'
import { ToastProvider } from './components/framework/Toast'
import { QuickActionsProvider } from './components/framework/QuickActions'
import { ErrorBoundary } from './components/framework/ErrorBoundary'
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/OverviewPage'
import { PostsPage } from './pages/PostsPage'
import { EditorPage, NewPostPage } from './pages/EditorPage'
import { NotesPage } from './pages/NotesPage'
import { OrganizePage } from './pages/OrganizePage'
import { SearchPage } from './pages/SearchPage'
import { GoalsHomePage } from './pages/GoalsHomePage'
import { GoalsPage } from './pages/GoalsPage'
import { PlanPage } from './pages/PlanPage'
import { CheckinPage } from './pages/CheckinPage'
import { DailyPage } from './pages/DailyPage'
import { QuickNotesPage } from './pages/QuickNotesPage'
import { WorkPlanPage } from './pages/WorkPlanPage'
import { LedgerPage } from './pages/LedgerPage'
import { SettingsPage } from './pages/SettingsPage'
import { GrantPage } from './pages/GrantPage'

function Guard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>载入中…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function LoginRoute() {
  const { user, loading } = useAuth()
  const [sp] = useSearchParams()
  if (loading) return <div className="boot" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>载入中…</div>
  // 邮件重置链接直达：已登录也进入「设置新密码」面板（重置成功会撤销全部会话，需重新登录）
  if (user && !sp.get('reset')) return <Navigate to="/" replace />
  return <LoginPage />
}

/** 旧路径 → 新路径重定向（分类/标签并入分类标签页，计划/习惯/目标并入目标页） */
function Redirect({ to }: { to: string }) {
  return <Navigate to={to} replace />
}

/** 路由级兜底：按 pathname 重置，页面崩溃只降级当前路由（侧边栏存活），切换路由自动恢复 */
function RouteBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return <ErrorBoundary key={pathname}>{children}</ErrorBoundary>
}

export default function App() {
  return (
    <ErrorBoundary kind="app">
      <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            {/* 一次性授权访问（公开）：访客经邮件链接进入，只读查看授权范围 */}
            <Route path="/grant" element={<GrantPage />} />
            <Route
              path="/*"
              element={
                <Guard>
                  <QuickActionsProvider>
                  <Shell>
                    <RouteBoundary>
                    <Routes>
                      <Route index element={<OverviewPage />} />
                      {/* 内容 */}
                      <Route path="posts" element={<PostsPage />} />
                      <Route path="posts/new" element={<NewPostPage />} />
                      <Route path="posts/:id/edit" element={<EditorPage />} />
                      <Route path="notes" element={<NotesPage />} />
                      <Route path="quick-notes" element={<QuickNotesPage />} />
                      <Route path="organize" element={<OrganizePage />} />
                      <Route path="search" element={<SearchPage />} />
                      {/* 日常 */}
                      <Route path="daily" element={<DailyPage />} />
                      <Route path="workplan" element={<WorkPlanPage />} />
                      {/* 目标三件套：独立页（旧聚合页 /goals-home 保留兼容） */}
                      <Route path="goals-home" element={<GoalsHomePage />} />
                      <Route path="goals" element={<GoalsPage />} />
                      <Route path="plan" element={<PlanPage />} />
                      <Route path="checkin" element={<CheckinPage />} />
                      {/* 记账 */}
                      <Route path="ledger" element={<LedgerPage />} />
                      {/* 设置（账户已并入设置中心） */}
                      <Route path="settings" element={<SettingsPage />} />
                      {/* 旧路径兼容重定向 */}
                      <Route path="account" element={<Redirect to="/settings" />} />
                      <Route path="categories" element={<Redirect to="/organize?tab=category" />} />
                      <Route path="tags" element={<Redirect to="/organize?tab=tag" />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                    </RouteBoundary>
                  </Shell>
                  </QuickActionsProvider>
                </Guard>
              }
            />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  )
}