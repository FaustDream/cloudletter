/** 底部辅助栏（纯功能控件；进入专注模式后整体隐藏）—— 从 TimelineUniverse3d 拆出，状态留在主组件、回调对接 */
import { SPEED_LABEL } from './consts'

interface ControlsProps {
  speedIdx: number
  onSpeed: (i: number) => void
  onToggleFocus: () => void
  onResetView: () => void
  canReset: boolean
  floatOn: boolean
  onToggleFloat: () => void
  battle: boolean
  onOpenGame?: () => void
  cursor: number
  cursorMax: number
  onCursor: (v: number) => void
}

export const UniverseControls = ({ speedIdx, onSpeed, onToggleFocus, onResetView, canReset, floatOn, onToggleFloat, battle, onOpenGame, cursor, cursorMax, onCursor }: ControlsProps) => (
  <div className="uni3d-bar">
    <span className="ub-label">转速</span>
    {SPEED_LABEL.map((l, i) => (
      <button key={l} className={`ub-btn${speedIdx === i ? ' on' : ''}`} onClick={() => onSpeed(i)}>{l}</button>
    ))}
    <button className="ub-btn" onClick={onToggleFocus}>专注模式</button>
    <button className="ub-btn" onClick={onResetView} disabled={!canReset} title="回到初始视角">重置视角</button>
    <button className={`ub-btn${floatOn ? ' on' : ''}`} onClick={onToggleFloat}>内容浮现 {floatOn ? '开' : '关'}</button>
    {battle && <button className="ub-btn game" onClick={() => onOpenGame?.()} title="游戏·讨伐：回到时光长河并展开讨伐卡">⚔️ 讨伐</button>}
    {battle && <span className="ub-div" />}
    <span className="ub-label">时间游标</span>
    <span className="ub-cursor">
      <input type="range" min={0} max={cursorMax} value={cursor}
        onChange={(e) => onCursor(Number(e.target.value))} aria-label="时间游标" />
      <em>{cursor === 0 ? '全部' : `近 ${cursor} 天`}</em>
    </span>
  </div>
)
