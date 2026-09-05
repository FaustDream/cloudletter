/**
 * 分类标签页子视图：图谱 —— 由同一份分类+标签+文章数据派生的共现关系视图。
 * （看板/洞察已下线：看板与列表职责重复，洞察数据并入检索与总览）
 * - 图谱：分类↔标签 共现关系 SVG 网络，节点尺寸∝数量，点击节点右侧面板给关联推荐
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/framework/Icon'
import type { Category, PostListItem, Tag } from '../../api'

interface OrgData {
  cats: Category[]
  tags: Tag[]
  posts: PostListItem[]
}

const CAT_PALETTE = ['#2563eb', '#0891b2', '#10a37f', '#f59e0b', '#e2544b', '#7c3aed']
const hashColor = (s: string) => {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0
  return CAT_PALETTE[Math.abs(h) % CAT_PALETTE.length]
}

/* ================= 图谱（分类↔标签共现） + 关联推荐 ================= */
export function OrgGraph({ cats, tags, posts }: OrgData) {
  const nav = useNavigate()
  const [focus, setFocus] = useState<{ kind: 'cat' | 'tag'; name: string } | null>(null)

  // 分类↔标签共现边（同属一篇文章），宽度∝共现篇数
  const edges = useMemo(() => {
    const w = new Map<string, { cat: string; tag: string; n: number }>()
    posts.forEach((p) => {
      if (!p.category) return
      p.tags.forEach((t) => {
        const k = `${p.category!.name}|${t}`
        const e = w.get(k)
        if (e) e.n++
        else w.set(k, { cat: p.category!.name, tag: t, n: 1 })
      })
    })
    return [...w.values()].sort((a, b) => b.n - a.n).slice(0, 16)
  }, [posts])
  const catNames = useMemo(() => cats.map((c) => c.name), [cats])
  const tagNames = useMemo(() => tags.map((t) => t.name), [tags])
  const catCount = (n: string) => cats.find((c) => c.name === n)?._count?.posts ?? 0
  const tagCount = (n: string) => tags.find((t) => t.name === n)?._count?.posts ?? 0

  const W = 1040, H = 480
  const catY = (i: number, n: number) => H * (n === 1 ? 0.5 : (i + 0.5) / n)
  const tagY = (i: number, n: number) => H * (n === 1 ? 0.5 : (i + 0.5) / n)

  // 关联推荐：聚焦标签 → 共享该标签的文章；聚焦分类 → 该分类文章
  const relatedPost = useMemo(() => {
    if (!focus) return []
    return posts
      .filter((p) => (focus.kind === 'tag' ? p.tags.includes(focus.name) : p.category?.name === focus.name))
      .sort((a, b) => b.tags.length - a.tags.length)
      .slice(0, 6)
  }, [focus, posts])

  return (
    <div className="org-graph-wrap">
      <div className="org-graph">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="分类与标签关系图谱">
          {/* 连线 */}
          {edges.map((e) => {
            const ci = catNames.indexOf(e.cat)
            const ti = tagNames.indexOf(e.tag)
            if (ci < 0 || ti < 0) return null
            const x1 = 150, x2 = W - 150
            const y1 = catY(ci, catNames.length), y2 = tagY(ti, tagNames.length)
            const dim = focus && e.cat !== focus.name && e.tag !== focus.name ? 0.15 : 1
            return (
              <path
                key={`${e.cat}|${e.tag}`}
                d={`M ${x1} ${y1} C ${x1 + 200} ${y1}, ${x2 - 200} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={hashColor(e.tag)}
                strokeWidth={1 + Math.min(3.2, e.n * 0.45)}
                opacity={0.34 * dim}
                className="org-edge"
              />
            )
          })}
          {/* 分类（左列） */}
          {catNames.map((c, i) => (
            <g key={c} className={`org-node-g${focus?.name === c ? ' on' : ''}`} onClick={() => setFocus(focus?.name === c && focus.kind === 'cat' ? null : { kind: 'cat', name: c })}>
              <circle cx={150} cy={catY(i, catNames.length)} r={Math.max(16, 10 + Math.sqrt(catCount(c)) * 3)} fill={hashColor(c)} opacity={0.82} />
              <text x={150} y={catY(i, catNames.length) + 3.5} textAnchor="middle" fontSize={11} fill="#fff" fontWeight={700}>{c.slice(0, 4)}</text>
            </g>
          ))}
          {/* 标签（右列） */}
          {tagNames.map((t, i) => (
            <g key={t} className={`org-node-g${focus?.name === t && focus.kind === 'tag' ? ' on' : ''}`} onClick={() => setFocus(focus?.name === t && focus.kind === 'tag' ? null : { kind: 'tag', name: t })}>
              <circle cx={W - 150} cy={tagY(i, tagNames.length)} r={Math.max(14, 8 + Math.sqrt(tagCount(t)) * 2.6)} fill="none" stroke={hashColor(t)} strokeWidth={2.2} />
              <text x={W - 150} y={tagY(i, tagNames.length) + 3.5} textAnchor="middle" fontSize={10.5} fill="#46577a" fontWeight={700}>{t.slice(0, 5)}</text>
            </g>
          ))}
          {/* 主轴装饰 */}
          <text x={W / 2} y={16} textAnchor="middle" fontSize={11} fill="#7c8fb0" letterSpacing="3">分 类 ↔ 标 签</text>
        </svg>
        <div className="org-graph-tip">点击节点查看关联推荐 · 连线粗细 = 共现文章数</div>
      </div>

      {/* 关联推荐面板 */}
      {focus && (
        <aside className="org-rel">
          <div className="org-rel-h">
            <Icon name={focus.kind === 'cat' ? 'folder' : 'tag'} size={15} />
            <b>{focus.name}</b>
            <button className="qop" title="关闭" onClick={() => setFocus(null)}><Icon name="x" size={14} /></button>
          </div>
          {focus.kind === 'tag' ? (
            <p className="org-rel-sub">共享「{focus.name}」标签的文章（{relatedPost.length}）</p>
          ) : (
            <p className="org-rel-sub">属于「{focus.name}」分类的文章（{relatedPost.length}）</p>
          )}
          <div className="org-rel-list">
            {relatedPost.length === 0 ? (
              <div className="org-col-empty">暂无关联内容</div>
            ) : relatedPost.map((p) => (
              <button key={p.id} className="org-rel-item" onClick={() => nav(`/posts?q=${encodeURIComponent(p.title)}`)}>
                <span className={`st-dot mini ${p.status}`} />
                <span className="ori-t">{p.title}</span>
                <em>{p.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}</em>
              </button>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}
