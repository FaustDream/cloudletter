/** 登录页 · 账户锁定弹窗：连续失败 5 次后锁定，可通过邮箱验证码立即解锁（从 LoginPage 拆出；解锁流程状态自持，弹窗重开即复位） */
import { useState } from 'react'
import { api } from '../../api'
import { Modal } from '../../components/framework/Modal'

interface LockModalProps {
  email: string
  remainSeconds: number
  /** 解锁成功后写入主卡片的提示文案（lmsg） */
  onSentMsg: (v: string) => void
  onClose: () => void
}

export const LockModal = ({ email, remainSeconds, onSentMsg, onClose }: LockModalProps) => {
  const [unlockStage, setUnlockStage] = useState<'idle' | 'sent'>('idle')
  const [unlockCode, setUnlockCode] = useState('')
  const [unlockMsg, setUnlockMsg] = useState('')
  const [unlockErr, setUnlockErr] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)

  /** 锁定弹窗：发送邮箱解锁验证码 */
  const startUnlock = async () => {
    setUnlockBusy(true); setUnlockMsg(''); setUnlockErr('')
    try {
      const r = await api.post('/auth/send-unlock', { email: email.trim() })
      const d = r as { mode?: string; dev?: { code?: string } }
      if (d?.mode === 'demo' && d?.dev?.code) {
        setUnlockMsg(`演示环境：解锁验证码已生成 → ${d.dev.code}（邮件已落盘）`)
      } else {
        setUnlockMsg('解锁验证码已发送至邮箱，10 分钟内有效')
      }
      setUnlockStage('sent')
    } catch (ex) {
      const e = ex as { message?: string }
      setUnlockErr(e?.message ?? '发送失败，请重试')
    } finally { setUnlockBusy(false) }
  }

  /** 锁定弹窗：提交邮箱验证码解锁，成功后回到登录 */
  const doUnlock = async () => {
    if (unlockCode.trim().length !== 6) { setUnlockErr('请输入 6 位验证码'); return }
    setUnlockBusy(true); setUnlockErr('')
    try {
      await api.post('/auth/unlock', { email: email.trim(), code: unlockCode.trim() })
      setUnlockStage('idle')
      setUnlockCode('')
      setUnlockMsg('')
      setUnlockErr('')
      onSentMsg('已解锁，请重新登录')
      onClose()
    } catch (ex) {
      const e = ex as { message?: string }
      setUnlockErr(e?.message ?? '解锁失败，请重试')
    } finally { setUnlockBusy(false) }
  }

  return (
    <Modal title="账户已锁定" type="danger" size="sm" onClose={onClose} footer={
      unlockStage === 'sent' ? (
        <>
          <button className="btn ghost" onClick={onClose}>稍后再试</button>
          <button className="btn slim" data-modal-primary onClick={doUnlock} disabled={unlockBusy}>
            {unlockBusy ? '解锁中…' : '解锁'}
          </button>
        </>
      ) : (
        <button className="btn ghost" onClick={onClose}>关闭</button>
      )
    }>
      <p className="lock-desc">连续登录失败次数过多，账户已冻结登录。</p>
      <p className="lock-time">剩余锁定时间：约 {Math.max(1, Math.ceil(remainSeconds / 60))} 分钟</p>
      {unlockStage === 'idle' ? (
        <>
          <p className="lock-hint">输入管理员邮箱内收到的验证码即可立即解锁，无需等待倒计时。</p>
          <button className="btn lblk" type="button" onClick={startUnlock} disabled={unlockBusy}>
            {unlockBusy ? '发送中…' : '发送邮箱验证码解锁'}
          </button>
        </>
      ) : (
        <div className="lfield">
          <label>解锁验证码</label>
          <input type="text" inputMode="numeric" maxLength={6} value={unlockCode}
            onChange={(e) => setUnlockCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6 位验证码" autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') doUnlock() }} />
        </div>
      )}
      {unlockMsg && <p className="cap-hint" style={{ color: 'var(--ok)' }}>{unlockMsg}</p>}
      {unlockErr && <p className="cap-err">{unlockErr}</p>}
    </Modal>
  )
}
