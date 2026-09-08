/** 登录页 · 重置密码面板：由邮件中的一次性链接进入（resetToken 直达），成功后引导返回登录（从 LoginPage 拆出） */
import type { FormEvent } from 'react'
import { Icon } from '../../components/framework/Icon'

interface ResetPanelProps {
  email: string
  newPwd: string
  onNewPwdChange: (v: string) => void
  showPwd: boolean
  onToggleShowPwd: () => void
  busy: boolean
  resetDone: boolean
  onSubmit: (e: FormEvent) => void
  /** 返回登录：清空重置完成态并切回密码登录 Tab */
  onBack: () => void
}

export const ResetPanel = ({ email, newPwd, onNewPwdChange, showPwd, onToggleShowPwd, busy, resetDone, onSubmit, onBack }: ResetPanelProps) => {
  if (!resetDone) {
    return (
      <form onSubmit={onSubmit}>
        <div className="lfield">
          <label>邮箱</label>
          <div className="af-static" style={{ fontSize: 13.5 }}>{email} <span className="pill ok">待重置</span></div>
        </div>
        <div className="lfield">
          <label>新密码（至少 8 位）</label>
          <div className="lpwd">
            <input type={showPwd ? 'text' : 'password'} value={newPwd} onChange={(e) => onNewPwdChange(e.target.value)} autoComplete="new-password" maxLength={128} placeholder="••••••••" />
            <button type="button" className="lpwd-eye" onClick={onToggleShowPwd}
              aria-label={showPwd ? '隐藏密码' : '显示密码'} title={showPwd ? '隐藏密码' : '显示密码'}>
              <Icon name={showPwd ? 'eye-off' : 'eye'} size={17} />
            </button>
          </div>
          <p className="dim" style={{ fontSize: 'var(--fs-sm)', marginTop: 6 }}>8-128 位，须同时包含数字与英文字母；链接仅一次性有效（15 分钟内），且不影响已发布内容与数据。</p>
        </div>
        <button className="btn lblk" type="submit" disabled={busy}>{busy ? '提交中…' : '确认重置'}</button>
      </form>
    )
  }
  return (
    <div className="lsec" style={{ margin: 0 }}>
      <div className="lmsg">✓ 密码已重置，请使用新密码登录</div>
      <button className="btn lblk" type="button" onClick={onBack}>返回登录</button>
    </div>
  )
}
