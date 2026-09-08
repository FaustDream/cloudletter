/** 右上：图例面板（避开头像区 · 可折叠 · 悬停看提示，需要时才占用画面）—— 从 TimelineUniverse3d 拆出 */
import { useMemo, useState } from 'react'
import { TL_COLOR, TL_TYPES, filterNodes, type TimelineDay, type TimelineType } from '../timeline'

export const UniverseLegend = ({ days, filter }: { days: TimelineDay[]; filter: TimelineType[] }) => {
  const [legendOpen, setLegendOpen] = useState(true)
  /** 各类型节点计数（图例徽标） */
  const typeCounts = useMemo(() => {
    const m = {} as Record<TimelineType, number>
    for (const d of days) for (const it of filterNodes(d.items, filter)) m[it.t] = (m[it.t] ?? 0) + 1
    return m
  }, [days, filter])

  return (
    <div className={`uni3d-lg${legendOpen ? ' open' : ''}`}>
      <button className="uni3d-lg-toggle" onClick={() => setLegendOpen((o) => !o)} title={legendOpen ? '收起图例' : '展开图例'}>
        <span className="uni3d-lg-pin" />图例<span className="uni3d-lg-caret">▾</span>
      </button>
      {legendOpen && (
        <div className="uni3d-lg-body">
          <div className="lg-group">
            <div className="lg-cap">类型 · 悬浮节点看详情</div>
            <div className="lg-types">
              {TL_TYPES.map(([k, l]) => (
                <span className="uni3d-legend-item" key={k} title={`${l} · ${typeCounts[k] ?? 0} 颗 · 点击节点高亮同类型关系`}>
                  <i style={{ background: TL_COLOR[k] }} />{l}
                  <em>{typeCounts[k] ?? 0}</em>
                </span>
              ))}
            </div>
          </div>
          <div className="lg-group">
            <div className="lg-cap">关系连线 · 点击可选中</div>
            <div className="lg-rels">
              <span className="rl-item" title="同一天的节点自动相连"><i style={{ background: '#6db8ff' }} />同日期</span>
              <span className="rl-item" title="同一类型的节点自动串联"><i style={{ background: '#ffb066' }} />同类型</span>
              <span className="rl-item" title="节点到中心的辐射参考线"><i style={{ background: '#8fb9e8' }} />辐射</span>
              <span className="rl-item hot" title="选中后：暖金加粗 + 相机自动聚焦"><i style={{ background: '#ffd76a' }} />选中</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
