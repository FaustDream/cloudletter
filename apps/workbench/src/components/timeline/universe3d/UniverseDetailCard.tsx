/** 详情卡：节点 或 连接（顶部，不贴边）—— 从 TimelineUniverse3d 拆出，点击卡片清除高亮 */
import { TL_COLOR, TL_DESC, TL_TYPES, dayLabel, type TimelineNode } from '../timeline'
import { TYPE_EMOJI } from './consts'

export const UniverseDetailCard = ({ selNode, selPair, onClose }: {
  selNode: TimelineNode | null
  selPair: { kind: 'date' | 'type'; a: TimelineNode; b: TimelineNode } | null
  onClose: () => void
}) => {
  if (!selNode && !selPair) return null
  return (
    <div className="uni3d-card" onClick={onClose}>
      {selNode ? (
        <>
          <div className="uh"><span className="udot" style={{ background: TL_COLOR[selNode.t] }} />{TYPE_EMOJI[selNode.t]} {selNode.title}</div>
          <div className="us">{selNode.sub || TL_DESC[selNode.t]}</div>
          <div className="um">{dayLabel(selNode.date).d} · {TL_TYPES.find(([k]) => k === selNode.t)?.[1]}{selNode.xp ? ` · +${selNode.xp} XP` : ''}{selNode.gold ? ` · +${selNode.gold} 金币` : ''} · Esc 取消高亮</div>
        </>
      ) : selPair && (
        <>
          <div className="uh"><span className="udot" style={{ background: selPair.kind === 'date' ? '#6db8ff' : '#ffb066' }} />{selPair.kind === 'date' ? '同日期连接' : '同类型连接'}</div>
          <div className="us">{selPair.a.title} ⇄ {selPair.b.title}</div>
          <div className="um">{dayLabel(selPair.a.date).d} ↔ {dayLabel(selPair.b.date).d} · Esc 取消高亮</div>
        </>
      )}
    </div>
  )
}
