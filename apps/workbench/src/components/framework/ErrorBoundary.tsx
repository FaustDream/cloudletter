/**
 * 渲染错误兜底：路由级 + 应用级两层。
 * 任一页面渲染崩溃只降级当前路由（侧边栏/导航存活），骨架崩溃才整站兜底；
 * 边界按 pathname 重置，路由切换即自动恢复，无需手动重挂载。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

type FallbackKind = 'route' | 'app'

interface Props {
  /** key 传入 pathname 即可在路由切换时自动重置 */
  children: ReactNode
  kind?: FallbackKind
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.kind ?? 'route', error, info.componentStack)
  }

  componentDidMount() {
    // 捕获 React 渲染边界之外的全局异步错误（编辑器/ProseMirror/浮层等），
    // 白屏时给出可恢复界面而非整页空白；仅当边界内没有更小的局部错误时兜底
    this._onUnhandled = (e: ErrorEvent) => this.claim(e.error instanceof Error ? e.error : new Error(e.message || '未知错误'))
    this._onRejection = (e: PromiseRejectionEvent) => {
      const v = e.reason
      this.claim(v instanceof Error ? v : new Error(typeof v === 'string' ? v : '未处理的异步错误'))
    }
    window.addEventListener('error', this._onUnhandled)
    window.addEventListener('unhandledrejection', this._onRejection)
  }

  componentWillUnmount() {
    if (this._onUnhandled) window.removeEventListener('error', this._onUnhandled)
    if (this._onRejection) window.removeEventListener('unhandledrejection', this._onRejection)
  }

  private _onUnhandled?: (e: ErrorEvent) => void
  private _onRejection?: (e: PromiseRejectionEvent) => void
  private claimedAt = 0

  /** 全局错误进入边界（同 3s 窗口内只接管一次，可「重试」恢复） */
  private claim(err: Error) {
    const now = Date.now()
    if (this.state.error) return
    if (this.props.kind === 'app') return // 应用级边界不接管全局错误，避免把所有噪音都变成整站兜底
    if (now - this.claimedAt < 3000) return
    // 编辑器标记过的可恢复错误不进入兜底（内部已消化）
    if (/known.*fail|AbortError/.test(err.message || '')) return
    // 仅接管确实导致页面无响应的严重错误：避免误伤普通业务异常
    this.claimedAt = now
    this.setState({ error: err })
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const app = this.props.kind === 'app'
    return (
      <div
        style={{
          minHeight: app ? '100vh' : '60vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
        }}
      >
        <div
          className="wb-card"
          style={{
            maxWidth: 520,
            width: '100%',
            padding: '28px 26px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            textAlign: 'center',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 34, lineHeight: 1 }}>🧯</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>
            {app ? '工作台遇到了意外错误' : '这个页面渲染出错了'}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, wordBreak: 'break-all' }}>
            {error.message || String(error)}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn" onClick={this.reset}>重试</button>
            <button className="btn ghost" onClick={() => window.location.reload()}>刷新页面</button>
          </div>
        </div>
      </div>
    )
  }
}
