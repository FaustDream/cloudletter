/** 文章管理页：筛选（分类/标签/状态/搜索）+ 排序 + 多选批量 + hover 快捷操作 + Tab 数量 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type PostListItem, type Category } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { Dropdown } from '../components/framework/Dropdown'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { readLayoutTheme, POST_LIST_THEMES } from '../lib/componentTheme'

type Filter = 'all' | 'published' | 'draft'
type SortKey = 'updatedAt' | 'publishedAt' | 'title' | 'chars'

export function PostsPage() {
  const [sp] = useSearchParams()
  const nav = useNavigate()
  const [items, setItems] = useState<PostListItem[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<SortKey>('updatedAt')
  const [layout, setLayout] = useState<'table' | 'card'>('table')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [tagOpen, setTagOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [batchTags, setBatchTags] = useState('')
  const [batchCat, setBatchCat] = useState('')
  const toast = useToast()
  // 文章列表主题（骨架不变 · 样式抽离）
  const [listTheme, setListTheme] = useState(() => readLayoutTheme('postList', POST_LIST_THEMES, 'clean'))
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cl_theme_layout_postList') setListTheme(readLayoutTheme('postList', POST_LIST_THEMES, 'clean'))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 与分类 / 标签页联动：?cat= / ?tag= 路由参数自动筛选
  useEffect(() => {
    const c = sp.get('cat')
    const t = sp.get('tag')
    if (c) { setCat(c); setFilter('all') }
    if (t) { setTag(t); setFilter('all') }
  }, [sp])

  const load = useCallback(() => {
    if (filter !== 'all' || q.trim()) {
      // 精确筛选走后端
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      if (q.trim()) params.set('q', q.trim())
      setLoading(true)
      api.get<{ items: PostListItem[] }>(`/posts?${params}`)
        .then((r) => setItems(r.items)).catch(() => {}).finally(() => setLoading(false))
      return
    }
    setLoading(true)
    api.get<{ items: PostListItem[] }>('/posts')
      .then((r) => setItems(r.items)).catch(() => {}).finally(() => setLoading(false))
  }, [filter, q])

  useEffect(load, [load])
  useEffect(() => {
    api.get<{ items: Category[] }>('/categories').then((r) => setCats(r.items)).catch(() => {})
  }, [])

  // 客户端联动：分类 / 标签 / 排序（全量数据基础上过滤）
  const view = useMemo(() => {
    let list = items
    if (cat) list = list.filter((p) => p.category?.name === cat)
    if (tag) list = list.filter((p) => p.tags.includes(tag))
    const sorted = [...list]
    if (sort === 'publishedAt') sorted.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    else if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    else if (sort === 'chars') sorted.sort((a, b) => b.chars - a.chars)
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return sorted
  }, [items, cat, tag, sort])

  const allTags = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of items) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [items])

  const counters = {
    all: items.length,
    published: items.filter((p) => p.status === 'published').length,
    draft: items.filter((p) => p.status === 'draft').length,
  }

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const allChecked = sel.size === view.length && view.length > 0

  const batch = async (action: 'publish' | 'draft' | 'delete' | 'tag' | 'category', extra?: Record<string, unknown>) => {
    if (!sel.size) return
    if (action === 'delete' && !(await confirmDialog({ title: '批量删除文章', description: `确定删除选中的 ${sel.size} 篇文章？此操作不可恢复。`, type: 'danger', confirmText: '删除' }))) return
    try {
      const r = await api.post<{ ok: boolean; affected: number }>('/posts/batch', { ids: [...sel], action, payload: extra })
      toast(`已处理 ${r.affected} 篇`)
      setSel(new Set()); load()
    } catch (e: any) {
      toast(e?.message || '批量操作失败', 'err')
    }
  }

  const batchTag = async () => {
    const names = batchTags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    if (!names.length) return
    await batch('tag', { tags: names })
    setTagOpen(false); setBatchTags('')
  }

  const batchCategory = async () => {
    if (!batchCat) return
    await batch('category', { categoryId: batchCat })
    setCatOpen(false); setBatchCat('')
  }

  const delOne = async (p: PostListItem) => {
    if (!(await confirmDialog({ title: '删除文章', description: `确定删除「${p.title}」？此操作不可恢复。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/posts/${p.id}`)
      toast('已删除')
      load()
    } catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }

  return (
    <>
      {/* Tab（带数量）+ 主操作 */}
      <PageHeader
        title="文章"
        lead={<>
          {(['all', 'published', 'draft'] as const).map((f) => (
            <button key={f} className={`ptab ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? '全部' : f === 'published' ? '已发布' : '草稿'} <b>{counters[f]}</b>
            </button>
          ))}
        </>}
        actions={<>
          <div className="view-toggle">
            <button className={layout === 'table' ? 'on' : ''} title="表格视图" onClick={() => setLayout('table')}><Icon name="list" size={15} /></button>
            <button className={layout === 'card' ? 'on' : ''} title="卡片视图" onClick={() => setLayout('card')}><Icon name="grid" size={15} /></button>
          </div>
          <button className="btn" onClick={() => nav('/posts/new')}><Icon name="plus" size={16} /> 新建草稿</button>
        </>}
        className="posts-head"
      />

      {/* 搜索 + 筛选 + 排序（独立行，充分利用横向空间） */}
      <div className="fbar">
        <div className="search-box grow">
          <Icon name="search" size={16} />
          <input type="search" placeholder="搜索标题 / 正文…" value={q} onChange={(e) => { setQ(e.target.value); setSel(new Set()) }} />
        </div>
        <Dropdown
          value={cat}
          align="left"
          options={[{ value: '', label: '全部分类' }, ...cats.map((c) => ({ value: c.name, label: `${c.name}（${c._count?.posts ?? 0}）` }))]}
          onChange={setCat}
        />
        <Dropdown
          value={tag}
          align="left"
          options={[{ value: '', label: '全部标签' }, ...allTags.map(([t]) => ({ value: t, label: t }))]}
          onChange={setTag}
        />
        <Dropdown
          value={sort}
          align="left"
          options={[
            { value: 'updatedAt', label: '最近编辑' }, { value: 'publishedAt', label: '最近发布' },
            { value: 'title', label: '标题' }, { value: 'chars', label: '字数' },
          ]}
          onChange={(v) => setSort(v as SortKey)}
        />
      </div>

      {/* 批量工具栏 */}
      {sel.size > 0 && (
        <div className="btool">
          <span className="bt-n">已选 {sel.size} 篇</span>
          <button className="btn slim ghost" onClick={() => batch('publish')}>批量发布</button>
          <button className="btn slim ghost" onClick={() => batch('draft')}>批量转草稿</button>
          <button className="btn slim ghost" onClick={() => { setBatchTags(''); setTagOpen(true) }}>批量打标签</button>
          <button className="btn slim ghost" onClick={() => { setBatchCat(''); setCatOpen(true) }}>批量移分类</button>
          <button className="btn slim danger" onClick={() => batch('delete')}>批量删除</button>
          <button className="btn slim ghost" style={{ marginLeft: 'auto' }} onClick={() => setSel(new Set())}>取消选择</button>
        </div>
      )}

      {/* 高密度列表 / 卡片视图（data-posts 驱动列表外观主题） */}
      <div className="posts-body" data-posts={listTheme}>
      {layout === 'table' ? (
      <div className="ptable">
        <div className="ptable-hd">
          <div className="pcell chk">
            <input type="checkbox" checked={allChecked} onChange={() => setSel(allChecked ? new Set() : new Set(view.map((p) => p.id)))} title="全选" />
          </div>
          <div className="pcell title">标题</div>
          <div className="pcell cat">分类</div>
          <div className="pcell tags">标签</div>
          <div className="pcell st">状态</div>
          <div className="pcell num">字数 / 时长</div>
          <div className="pcell time">更新时间</div>
          <div className="pcell ops">操作</div>
        </div>
        {loading ? (
          <EmptyState>载入中…</EmptyState>
        ) : view.length === 0 ? (
          <EmptyState>{q || filter !== 'all' ? '没有符合条件的文章' : '暂无文章'}</EmptyState>
        ) : (
          view.map((p) => (
            <div key={p.id} className={`ptable-row ${sel.has(p.id) ? 'on' : ''}`}
              onClick={() => sel.has(p.id) ? toggle(p.id) : nav(`/posts/${p.id}/edit`)}>
              <div className="pcell chk" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
              </div>
              <div className="pcell title">
                <div className="ptitle">{p.title}</div>
                <div className="psum">{p.summary || '（无摘要）'}</div>
              </div>
              <div className="pcell cat">{p.category ? <span className="chip">{p.category.name}</span> : <span className="dim">—</span>}</div>
              <div className="pcell tags">{p.tags.slice(0, 3).map((t) => <span key={t} className="chip dim">#{t}</span>)}</div>
              <div className="pcell st">
                <span className={`pill ${p.status === 'published' ? 'ok' : 'warn'}`}>{p.status === 'published' ? '已发布' : '草稿'}</span>
              </div>
              <div className="pcell num dim">{p.chars} 字 · {p.readMin} 分</div>
              <div className="pcell time dim">{(p.updatedAt || '').slice(0, 16).replace('T', ' ')}</div>
              <div className="pcell ops" onClick={(e) => e.stopPropagation()}>
                <button className="qop" title="编辑" onClick={() => nav(`/posts/${p.id}/edit`)}><Icon name="pen" size={15} /></button>
                <button className="qop danger" title="删除" onClick={() => delOne(p)}><Icon name="trash" size={15} /></button>
              </div>
            </div>
          ))
        )}
      </div>
      ) : (
        <div className="post-grid">
          {view.length === 0 ? (
            <EmptyState>{q || filter !== 'all' ? '没有符合条件的文章' : '暂无文章'}</EmptyState>
          ) : (
            view.map((p) => (
              <div key={p.id} className={`post-card ${sel.has(p.id) ? 'on' : ''}`}
                onClick={() => sel.has(p.id) ? toggle(p.id) : nav(`/posts/${p.id}/edit`)}>
                {p.cover && <img className="pc-cover" src={p.cover} alt="" loading="lazy" />}
                <div className="pc-head">
                  <div className="pc-title">{p.title}</div>
                  <span className={`pill ${p.status === 'published' ? 'ok' : 'warn'}`}>{p.status === 'published' ? '已发布' : '草稿'}</span>
                  <div className="pc-chk" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                  </div>
                </div>
                <div className="pc-sum">{p.summary || '（无摘要）'}</div>
                <div className="pc-meta">
                  {p.category && <span className="chip">{p.category.name}</span>}
                  {p.tags.slice(0, 3).map((t) => <span key={t} className="chip dim">#{t}</span>)}
                </div>
                <div className="pc-foot">
                  <span className="dim">{p.chars} 字 · {p.readMin} 分</span>
                  <span className="dim">{(p.updatedAt || '').slice(0, 10)}</span>
                  <div className="pc-ops" onClick={(e) => e.stopPropagation()}>
                    <button className="qop" title="编辑" onClick={() => nav(`/posts/${p.id}/edit`)}><Icon name="pen" size={14} /></button>
                    <button className="qop danger" title="删除" onClick={() => delOne(p)}><Icon name="trash" size={14} /></button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      </div>

      {/* 批量打标签 */}
      {tagOpen && (
        <Modal title={`为 ${sel.size} 篇文章打标签`} onClose={() => setTagOpen(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setTagOpen(false)}>取消</button>
            <button className="btn" onClick={batchTag}>应用标签</button>
          </>
        }>
          <Field label="标签（逗号分隔，将覆盖目标文章已有标签）">
            <input type="text" value={batchTags} onChange={(e) => setBatchTags(e.target.value)} placeholder="读书, 技术" />
          </Field>
        </Modal>
      )}

      {/* 批量改分类 */}
      {catOpen && (
        <Modal title={`移动 ${sel.size} 篇文章到分类`} onClose={() => setCatOpen(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setCatOpen(false)}>取消</button>
            <button className="btn" onClick={batchCategory}>应用分类</button>
          </>
        }>
          <Field label="目标分类">
            <Dropdown
              value={batchCat}
              align="left"
              options={[{ value: '', label: '（无分类）' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]}
              onChange={setBatchCat}
            />
          </Field>
        </Modal>
      )}
    </>
  )
}