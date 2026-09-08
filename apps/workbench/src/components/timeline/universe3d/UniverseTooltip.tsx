/** 悬停信息卡 —— 从 TimelineUniverse3d 拆出；DOM 挂主组件 tipRef（场景循环直改坐标） */
import type { RefObject } from 'react'
import { TL_TYPES, dayLabel, daysAgo, type TimelineNode } from '../timeline'

export const UniverseTooltip = ({ tip, tipRef }: {
  tip: { x: number; y: number; it: TimelineNode; layer: number }
  tipRef: RefObject<HTMLDivElement>
}) => (
  <div ref={tipRef} className="uni3d-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
    <div className="t-type">{TL_TYPES.find(([k]) => k === tip.it.t)?.[1]} · 第 {tip.layer + 1} 层轨道 · {daysAgo(tip.it.date) === 0 ? '今天' : `${daysAgo(tip.it.date)} 天前`}</div>
    <div className="t-title">{tip.it.title}</div>
    <div className="t-meta">{dayLabel(tip.it.date).d}{tip.it.xp ? ` · +${tip.it.xp} XP` : ''}{tip.it.gold ? ` · +${tip.it.gold} 金币` : ''}</div>
  </div>
)
