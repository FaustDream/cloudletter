/** 登录页 · 图形验证码弹窗：连续失败 ≥3 次后弹出（后端签发，服务端校验；仅以图片 data URI 展示，不落明文。从 LoginPage 拆出） */
import { Modal } from '../../components/framework/Modal'

interface CaptchaModalProps {
  captchaSvg: string
  value: string
  onValueChange: (v: string) => void
  err: string
  busy: boolean
  /** 点击验证码图片刷新：重新请求签发（后端会作废旧码并返回新码） */
  onRefresh: () => void
  /** 确认：携带验证码重新登录（后端未通过会返回新验证码并再次弹窗） */
  onConfirm: () => void
  onClose: () => void
}

export const CaptchaModal = ({ captchaSvg, value, onValueChange, err, busy, onRefresh, onConfirm, onClose }: CaptchaModalProps) => (
  <Modal title="安全验证" type="warning" size="sm" onClose={onClose} footer={
    <>
      <button className="btn ghost" onClick={onClose}>取消</button>
      <button className="btn slim" data-modal-primary onClick={onConfirm} disabled={busy}>验证</button>
    </>
  }>
    <p className="cap-desc">检测到多次登录失败，请输入下方图形验证码以继续</p>
    <div className="cap-stage">
      <button type="button" className="cap-box" onClick={onRefresh} title="点击刷新验证码" disabled={busy} aria-label="刷新验证码">
        {captchaSvg
          ? <img src={captchaSvg} alt="图形验证码" draggable={false} />
          : <span className="cap-fallback">????</span>}
        <span className="cap-refresh">↻ 看不清？点击换一张</span>
      </button>
      <input className="cap-input" value={value}
        onChange={(e) => onValueChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
        placeholder="输入 4 位验证码" maxLength={4} autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter') onConfirm() }} />
    </div>
    {err && <p className="cap-err">{err}</p>}
    <p className="cap-hint">图形验证码用于确认是本人操作 · 输入错误会自动更换新验证码</p>
  </Modal>
)
