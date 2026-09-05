/**
 * 分类标签页（原「组织」，路由 /organize 不变；需求 5：内容组织中枢）
 * 定位：把散落的内容，组织成可以被理解、被检索、被复用的结构。
 * 能力导览（首次进入展示）→ 五种视图同源派生：分类 / 标签 / 看板 / 图谱(关联推荐) / 洞察。
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type Category, type PostListItem, type Tag } from '../api'
import { loadTourRecord, readLoginEpoch, saveTourRecord, shouldShowTour, type TourScope } from '../lib/tour'
import { Icon } from '../components/framework/Icon'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { readLayoutTheme, ORG_KANBAN_THEMES } from '../lib/componentTheme'
import { CategoriesPage } from './CategoriesPage'
import { TagsPage } from './TagsPage'
import { OrgKanban, OrgGraph, OrgInsights } from './org/OrgViews'

type View = 'category' | 'tag' | 'board' | 'graph' | 'insight'
const VIEWS: { id: View; label: string; icon: string }[] = [
  { id: 'category', label: '分类', icon: 'folder' },
  { id: 'tag', label: '标签', icon: 'tag' },
  { id: 'board', label: '看板', icon: 'columns' },
  { id: 'graph', label: '图谱', icon: 'spark' },
  { id: 'insight', label: '洞察', icon: 'chart' },
]
const TAB_PARAM: Record<View, string> = { category: 'category', tag: 'tag', board: 'board', graph: 'graph', insight: 'insight' }

export function OrganizePage() {
  const [sp, setSp] = useSearchParams()
  const raw = sp.get('tab')
  const view: View = dup(raw)
  // 功能导览：新账户必弹、重新登录后弹一次（同会话不重复），关闭记录见 lib/tour
  const loginEpoch = readLoginEpoch()
  const [toured, setToured] = useState(() => !shouldShowTour(loadTourRecord(), loginEpoch))
  // 共享数据：仅看板/图谱/洞察需要文章列表；分类/标签各自加载
  const [data, setData] = useState<{ cats: Category[]; tags: Tag[]; posts: PostListItem[] } | null>(null)

  function dup(v: string | null): View {
    return v === 'tag' || v === 'board' || v === 'graph' || v === 'insight' ? v : 'category'
  }

  const switchTab = (t: View) => setSp({ tab: TAB_PARAM[t] }, { replace: true })

  useEffect(() => {
    if (!(view === 'board' || view === 'graph' || view === 'insight')) return
    let on = true
    Promise.all([
      api.get<{ items: Category[] }>('/categories'),
      api.get<{ items: Tag[] }>('/tags'),
      api.get<{ items: PostListItem[] }>('/posts'),
    ])
      .then(([c, t, p]) => { if (on) setData({ cats: c.items, tags: t.items, posts: p.items }) })
      .catch(() => {})
    return () => { on = false }
  }, [view])

  const dismissTour = (scope: TourScope) => { saveTourRecord(scope, loginEpoch); setToured(true) }
  // 看板卡片主题（骨架不变 · 样式抽离）
  const [kanbanTheme, setKanbanTheme] = useState(() => readLayoutTheme('orgKanban', ORG_KANBAN_THEMES, 'clean'))
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cl_theme_layout_orgKanban') setKanbanTheme(readLayoutTheme('orgKanban', ORG_KANBAN_THEMES, 'clean'))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return (
    <div className="org-page" data-org={kanbanTheme}>
      <PageHeader
        title="分类标签"
        subtitle="把散落的内容，组织成可以被理解、被检索、被复用的结构"
        actions={<div className="org-head-tools">
          <button className="tour-reopen" title="重看功能导览" onClick={() => setToured(false)}>
            <Icon name="spark" size={13} />导览
          </button>
          <div className="tabbar">
            {VIEWS.map((v) => (
              <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => switchTab(v.id)}>
                <Icon name={v.icon} size={13} />{v.label}
              </button>
            ))}
          </div>
        </div>}
      />

      {/* 能力导览：新账户/重新登录后进入本页展示；「我知道了」本会话隐藏，「永不提示」永久，页头「导览」可重开 */}
      {!toured && (
        <div className="org-tour">
          <div className="org-tour-t">
            <Icon name="spark" size={15} /> 这里不只是「分类 + 标签」
            <button className="qop" title="本次不再提示" onClick={() => dismissTour('session')}><Icon name="x" size={14} /></button>
          </div>
          <div className="org-tour-chips">
            <span><b>地址 </b>分类定主题、标签做索引</span>
            <span><b>看法 </b>同一份内容，五种视图换着读</span>
            <span><b>关系 </b>图谱里看见分类与标签的共现网络</span>
            <span><b>发散 </b>点击节点，推荐关联内容与灵感</span>
          </div>
          <div className="org-tour-acts">
            <button className="btn slim" onClick={() => dismissTour('session')}>我知道了</button>
            <button className="btn slim ghost" onClick={() => dismissTour('forever')}>永不提示</button>
          </div>
        </div>
      )}

      {view === 'category' && <CategoriesPage withHeader={false} />}
      {view === 'tag' && <TagsPage withHeader={false} />}
      {view === 'board' && (data ? (
        <OrgKanban cats={data.cats} tags={data.tags} posts={data.posts} />
      ) : <EmptyState>载入内容中…</EmptyState>)}
      {view === 'graph' && (data ? (
        <OrgGraph cats={data.cats} tags={data.tags} posts={data.posts} />
      ) : <EmptyState>载入关系图谱…</EmptyState>)}
      {view === 'insight' && (data ? (
        <OrgInsights cats={data.cats} tags={data.tags} posts={data.posts} />
      ) : <EmptyState>载入洞察…</EmptyState>)}
    </div>
  )
}