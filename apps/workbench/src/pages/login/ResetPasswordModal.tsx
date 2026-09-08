/** 登录页 · 忘记密码弹窗：发送一次性重置链接邮件，演示环境展示可复制/直达链接（从 LoginPage 拆出） */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { Icon } from '../../components/framework/Icon'
import { Modal } from '../../components/framework/Modal'

interface ResetPasswordModalProps {
  email: string
  onEmailChange: (v: string) => void
  err: string
  sentMsg: string
  busy: boolean
  onSetErr: (v: string) => void
  onSetSentMsg: (v: string) => void
  onSetFieldErr: (v: { email?: string }) => void
  onClose: () => void
}

export const ResetPasswordModal = ({ email, onEmailChange, err, sentMsg, busy, onSetErr, onSetSentMsg, onSetFieldErr, onClose }: ResetPasswordModalProps) => {
  const nav = useNavigate()
  // 演示环境生成的重置链接（仅本弹窗内展示 / 复制 / 直达）
  const [resetLink, setResetLink] = useState('')

  const sendReset = async () => {
    onSetErr(''); onSetSentMsg('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { onSetFieldErr({ email: '请输入有效的邮箱地址' }); return }
    const r = await api.post('/auth/send-reset', { email: email.trim() }).catch((e) => { onSetErr(e?.message || '发送失败'); return null })
    if (!r) return
    const d = r as { mode?: string; dev?: { link?: string } }
    if (d?.mode === 'demo' && d?.dev?.link) {
      setResetLink(String(d.dev.link))
      onSetSentMsg('演示环境：重置链接已生成（见下方，可复制）')
    } else {
      setResetLink('')
      onSetSentMsg('重置链接已发送至邮箱，15 分钟内有效')
      onClose()
    }
  }

  /** 从后端返回的重置链接中提取 token + 邮箱，跳转到前端登录页的新密码面板 */
  const openResetPage = () => {
    try {
      const u = new URL(resetLink)
      nav(`/login${u.search}`, { replace: false })
    } catch { onSetErr('重置链接无效') }
  }

  const copyResetLink = async () => {
    try {
      await navigator.clipboard.writeText(resetLink)
      onSetSentMsg('重置链接已复制')
    } catch { onSetErr('复制失败，请手动选中链接') }
  }

  const demoLink = sentMsg.includes('复制')

  return (
    <Modal title="重置密码（邮箱链接）" hideClose onClose={onClose} footer={
      <button className="btn" onClick={onClose}>关闭</button>
    }>
      <p style={{ fontSize: 'var(--fs-body)', color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 12 }}>
        输入已注册的管理员邮箱，系统将发送一封<b>含一次性重置链接</b>的邮件。
        只有通过邮件里链接的操作才能重置密码（链接带加密密文，15 分钟内有效，使用一次即失效）。
      </p>
      {/* 发送失败原因就地显示在弹窗内（卡片里的 lerr 会被弹窗遮住，表现为「无反应」） */}
      {err && <div className="lerr" role="alert" style={{ marginBottom: 12 }}><Icon name="x" size={14} /> {err}</div>}
      <div className="lfield">
        <label>管理员邮箱</label>
        <input type="email" value={email} onChange={(e) => onEmailChange(e.target.value)} placeholder="you@example.com" />
      </div>
      <button className="btn lblk" type="button" onClick={sendReset} disabled={busy}>发送重置链接</button>
      {demoLink && (
        <div className="reset-link-box" style={{ marginTop: 12 }}>
          <div className="dim" style={{ fontSize: 'var(--fs-sm)', marginBottom: 6 }}>演示环境链接（生产 SMTP 模式不展示）：</div>
          <code>{resetLink}</code>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn slim" type="button" onClick={copyResetLink}>复制链接</button>
            <button className="btn slim ghost" type="button" onClick={openResetPage}>打开重置页</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
