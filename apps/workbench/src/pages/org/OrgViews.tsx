/**
 * 组织子视图（需求 5）：看板 / 图谱 / 洞察 —— 由同一份分类+标签+文章数据派生的三种看法。
 * - 看板：按分类分列的卡片墙（未分类单独一列），点击列头跳文章筛选
 * - 图谱：分类↔标签 共现关系 SVG 网络，节点尺寸∝数量，点击节点右侧面板给关联推荐
 * - 洞察：内容增长趋势 / 标签榜 / 汇总统计
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

/* ================= 看板 ================= */
export function OrgKanban({ cats, posts }: OrgData) {
  const nav = useNavigate()
  const boards = useMemo(() => {
    const cols: { name: string; key: string; color: string; items: PostListItem[] }[] = cats.map((c) => ({
      name: c.name, key: c.id, color: hashColor(c.name), items: [],
    }))
    cols.push({ name: '未分类', key: '__none', color: '#7c8fb0', items: [] })
    posts.forEach((p) => {
      const col = p.category ? cols.find((c) => c.name === p.category?.name) : null
      ;(col ?? cols[cols.length - 1]).items.push(p)
    })
    return cols.filter((c) => c.items.length > 0 || c.key === '__none')
  }, [cats, posts])

  return (
    <div className="org-board">
      {boards.map((col) => (
        <div className="org-col" key={col.key}>
          <div className="org-col-h" style={{ ['--cc' as string]: col.color }}>
            <span className="oc-dot" />
            <b onClick={() => nav(col.key === '__none' ? '/posts' : `/posts?cat=${encodeURIComponent(col.name)}`)}>{col.name}</b>
            <em>{col.items.length}</em>
          </div>
          <div className="org-col-list">
            {col.items.length === 0 ? (
              <div className="org-col-empty">暂无文章</div>
            ) : (
              col.items.map((p) => (
                <div className="org-card" key={p.id} title={p.title} onClick={() => nav(`/posts?status=${p.status === 'published' ? '' : 'draft'}`)}>
                  <div className="oc-title"><span className={`st-dot ${p.status}`} title={p.status === 'published' ? '已发布' : '草稿'} />{p.title}</div>
                  <div className="oc-tags">{p.tags.slice(0, 3).map((t) => <span key={t}>#{t}</span>)}</div>
                  <div className="oc-meta">{new Date(p.updatedAt).toLocaleDateString('zh-CN')} · {p.readMin} 分钟</div>
                </div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
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
  const relevant = (name: string) => edges.some((e) => (focus?.kind === 'cat' ? e.cat : e.tag) === name && (focus?.kind === 'tag' ? e.cat : e.tag) === focus?.name)

  // 关联推荐：聚焦标签 → 共享该标签的文章 + 共现分类；聚焦分类 → 该分类文章 + 共现标签
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

/* ================= 洞察 ================= */
export function OrgInsights({ cats, tags, posts }: OrgData) {
  const stats = useMemo(() => ({
    total: posts.length,
    published: posts.filter((p) => p.status === 'published').length,
    cats: cats.length,
    tags: tags.length,
  }), [cats, tags, posts])

  // 近 6 个月发布/更新趋势
  const trend = useMemo(() => {
    const now = new Date()
    const months: { label: string; n: number; u: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ label: `${d.getMonth() + 1}月`, n: 0, u: 0 })
    }
    posts.forEach((p) => {
      const u = new Date(p.updatedAt)
      const idx = (u.getFullYear() - now.getFullYear()) * 12 + (u.getMonth() - now.getMonth()) + 5
      if (idx >= 0 && idx < 6) {
        months[idx].u++
        if (p.status === 'published') months[idx].n++
      }
    })
    return months
  }, [posts])

  const topTags = useMemo(() => [...tags].sort((a, b) => (b._count?.posts ?? 0) - (a._count?.posts ?? 0)).slice(0, 6), [tags])
  const desc = useMemo(() => {
    if (posts.length === 0) return '内容还在积蓄中 · 在「文章」里写下第一篇吧'
    const cat = [...cats].sort((a, b) => (b._count?.posts ?? 0) - (a._count?.posts ?? 0))[0]
    const tg = topTags[0]
    return `共沉淀 ${stats.total} 篇文章（发布 ${stats.published} 篇）${cat ? `，最常写「${cat.name}」（${cat._count?.posts} 篇）` : ''}${tg ? `，高频标签「#${tg.name}」（${tg._count?.posts} 篇）` : ''}。`
  }, [posts, cats, topTags, stats])

  const maxU = Math.max(1, ...trend.map((m) => m.u))
  const maxT = Math.max(1, ...topTags.map((t) => t._count?.posts ?? 0))

  return (
    <div className="org-insights">
      <div className="stat-grid">
        <div className="stat-card"><div className="sk"><Icon name="file" size={15} />文章总数</div><div className="sv">{stats.total}</div><div className="sd">全部状态</div></div>
        <div className="stat-card"><div className="sk"><Icon name="check" size={15} />已发布</div><div className="sv">{stats.published}</div><div className="sd">对外可见</div></div>
        <div className="stat-card"><div className="sk"><Icon name="folder" size={15} />分类</div><div className="sv">{stats.cats}</div><div className="sd">主题容器</div></div>
        <div className="stat-card"><div className="sk"><Icon name="tag" size={15} />标签</div><div className="sv">{stats.tags}</div><div className="sd">可叠加关键词</div></div>
      </div>

      <div className="org-ins-grid">
        <section className="card org-ins-sec">
          <div className="asec-h"><Icon name="chart" size={16} /> 近 6 个月产出趋势</div>
          <div className="bar-chart">
            {trend.map((m, i) => (
              <div className="bar-col" key={i}>
                <span className="bval">{m.n || ''}</span>
                <span className="b" style={{ height: `${Math.max(2, (m.u / maxU) * 100)}%`, background: 'linear-gradient(180deg, var(--accent), var(--info))' }} />
                <span className="bl">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="legend"><span><i style={{ background: 'var(--accent)' }} />当月产出</span><span className="dim">柱高按趋势加权</span></div>
        </section>

        <section className="card org-ins-sec">
          <div className="asec-h"><Icon name="target" size={16} /> 高频标签榜</div>
          <div className="catbar">
            {topTags.length === 0 ? (
              <div className="org-col-empty">暂无标签</div>
            ) : topTags.map((t) => (
              <div className="cbrow" key={t.id}>
                <span className="cbn"># {t.name}</span>
                <span className="cbt"><i style={{ width: `${((t._count?.posts ?? 0) / maxT) * 100}%`, background: hashColor(t.name) }} /></span>
                <span className="cbv">{t._count?.posts ?? 0}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="org-ins-desc"><Icon name="spark" size={15} /> 一句话洞察：{desc}</div>
    </div>
  )
}