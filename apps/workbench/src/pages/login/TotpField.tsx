/** 登录页 · 两步验证码字段：TOTP 输入 + 绑定邮箱安全恢复面板（从 LoginPage 拆出） */
import { api } from '../../api'

/** 恢复面板状态（由 LoginPage 持有并受控传入，避免随 totpStep 关闭重开而丢失） */
export interface TfaRecoverState {
  open: boolean
  step: 'send' | 'confirm'
  code: string
  busy: boolean
  msg: string
  err: string
}

interface TotpFieldProps {
  value: string
  onValueChange: (v: string) => void
  email: string
  recover: TfaRecoverState
  onRecoverChange: (updater: (v: TfaRecoverState) => TfaRecoverState) => void
  /** 恢复成功：退出两步验证步骤并清空已输动态码 */
  onRecovered: () => void
}

export const TotpField = ({ value, onValueChange, email, recover, onRecoverChange, onRecovered }: TotpFieldProps) => {
  const sendTfaRecovery = async () => {
    onRecoverChange((v) => ({ ...v, busy: true, msg: '', err: '' }))
    try {
      const r = await api.post('/auth/2fa/recovery-request', { email: email.trim() })
      const d = r as { mode?: string; dev?: { code?: string } }
      if (d?.mode === 'demo' && d?.dev?.code) {
        const demoCode = d.dev.code
        onRecoverChange((v) => ({ ...v, step: 'confirm', msg: `演示环境恢复码：${demoCode}（邮件已落盘）` }))
      } else {
        onRecoverChange((v) => ({ ...v, step: 'confirm', msg: '恢复码已发送至绑定邮箱（15 分钟有效，仅一次）' }))
      }
    } catch (ex) {
      const e = ex as { message?: string }
      onRecoverChange((v) => ({ ...v, err: e?.message ?? '发送失败，请重试' }))
    } finally { onRecoverChange((v) => ({ ...v, busy: false })) }
  }
  const confirmTfaRecovery = async () => {
    onRecoverChange((v) => ({ ...v, busy: true, msg: '', err: '' }))
    try {
      await api.post('/auth/2fa/recovery-confirm', { email: email.trim(), code: recover.code.trim() })
      onRecoverChange((v) => ({ ...v, msg: '两步验证已安全重置，请用密码重新登录并尽快重新绑定验证器' }))
      onRecovered()
    } catch (ex) {
      const e = ex as { message?: string }
      onRecoverChange((v) => ({ ...v, err: e?.message ?? '验证失败，请重试' }))
    } finally { onRecoverChange((v) => ({ ...v, busy: false })) }
  }
  return (
    <div className="lfield">
      <label htmlFor="login-totp">两步验证码</label>
      <input id="login-totp" inputMode="numeric" maxLength={6} value={value} autoFocus
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, ''))}
        placeholder="6 位动态码" style={{ letterSpacing: 6, fontFamily: 'var(--mono)' }} />
      <span className="lfield-help">
        {!recover.open
          ? <button type="button" className="l-forgot" onClick={() => onRecoverChange((v) => ({ ...v, open: true }))}>无法获取验证码？通过绑定邮箱恢复</button>
          : null}
      </span>
      {recover.open && (
        <div className="tfa-recover">
          {recover.step === 'send'
            ? <button type="button" className="btn slim" disabled={recover.busy} onClick={sendTfaRecovery}>
                {recover.busy ? '发送中…' : '发送恢复码到绑定邮箱（15 分钟有效）'}
              </button>
            : <div className="tfa-recover-confirm">
                <input value={recover.code} onChange={(e) => onRecoverChange((v) => ({ ...v, code: e.target.value.toUpperCase() }))}
                  placeholder="8 位恢复码" maxLength={8} style={{ width: 160, fontFamily: 'var(--mono)' }} />
                <button type="button" className="btn slim" disabled={recover.busy || recover.code.length < 4} onClick={confirmTfaRecovery}>
                  {recover.busy ? '验证中…' : '安全重置两步验证'}
                </button>
              </div>}
          {recover.msg && <span className="lferr ok">{recover.msg}</span>}
          {recover.err && <span className="lferr">{recover.err}</span>}
        </div>
      )}
    </div>
  )
}
