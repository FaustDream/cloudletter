import { errMsg } from '../lib/errors'
/** 灵感笔记：5 种布局（卡片/列表/时间线/瀑布流/便利贴，页头即点即换）；
 *  点卡片 → 右侧抽屉直接编辑详情（标题/分类/标签/富文本正文），随手记=抽屉新建，
 *  默认分类/标签「灵感」，与文章共用；分类/标签=Notion 式下拉（可搜索新建）。
 *  编辑器非受控（value 仅初值、外部不回灌），杜绝受控回灌把输入重置（表现如撤销）。
 *  计划类速记已并入今日计划。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, type Category, type NoteItem, type NoteStatus } from '../api'
import { Icon } from '../components/framework/Icon'
import { confirmDialog, Field } from '../components/framework/Modal'
import { Drawer } from '../components/framework/Drawer'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { TagMultiSelect } from '../components/editor/TagMultiSelect'
import { Dropdown } from '../components/framework/Dropdown'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { todayYMD } from '../lib/date'
import { resolveCategoryIdByName } from '../lib/taxonomy'
import { noteStyle, setNoteStyle, NOTE_STYLES, NOTE_STYLE_LABELS, type NoteStyle } from '../lib/layout'

/** 灵感状态字典：label=显示文案；filter 值 ''=全部 */
const NOTE_STATUS: Array<{ value: NoteStatus | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待使用' },
  { value: 'used', label: '已使用' },
  { value: 'expired', label: '已过期' },
]
const NOTE_STATUS_LABEL: Record<NoteStatus, string> = { pending: '待使用', used: '已使用', expired: '已过期' }

export function NotesPage() {
  const [sp, setSp] = useSearchParams()
  const [items, setItems] = useState<NoteItem[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  /** 状态筛选：''=全部（默认），避免漏看旧灵感 */
  const [statusFilter, setStatusFilter] = useState<NoteStatus | ''>('')
  /** 编辑抽屉：editingNote=null 且抽屉开 = 新建随手记 */
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<NoteItem | null>(null)
  const [form, setForm] = useState<{ title: string; body: string; categoryName: string; tagNames: string[]; status: NoteStatus }>({ title: '', body: '', categoryName: '', tagNames: ['灵感'], status: 'pending' })
  /** 全站标签池（Notion 式标签下拉候选） */
  const [tagPool, setTagPool] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [style, setStyle] = useState<NoteStyle>(noteStyle)
  const toast = useToast()

  // 风格偏好：本页切换即写回；设置页改动后同 tab 内即时生效
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'cl_note_style') setStyle(noteStyle()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: NoteItem[] }>('/workbench/notes')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  // 分类/标签下拉数据（新建默认取「灵感」分类与标签）
  useEffect(() => {
    api.get<{ items: Category[] }>('/categories').then((r) => setCats(r.items)).catch(() => {})
  }, [])
  useEffect(() => {
    api.get<{ items: Array<{ id: string; name: string }> }>('/tags').then((r) => setTagPool(r.items.map((t) => t.name))).catch(() => {})
  }, [])

  const defaultCategoryName = useMemo(() => cats.find((c) => c.name === '灵感')?.name ?? '', [cats])

  /** Notion 式下拉「新建分类」：立即落库并同步本页候选（「分类标签」菜单可见） */
  const createCategory = async (name: string): Promise<{ id: string; name: string }> => {
    const r = await api.post<{ item: Category }>('/categories', { name })
    setCats((list) => (list.some((c) => c.id === r.item.id) ? list : [...list, r.item]))
    return r.item
  }

  // 分类标签页内容抽屉深链：/notes?focus=<id> → 直接打开该笔记编辑
  useEffect(() => {
    const fid = sp.get('focus')
    if (!fid) return
    const hit = items.find((n) => n.id === fid)
    if (hit) openNote(hit)
    setSp({}, { replace: true })
  }, [sp, items, setSp])

  const sorted = useMemo(
    () => [...items]
      .filter((n) => !statusFilter || n.status === statusFilter)
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [items, statusFilter],
  )

  const openCreate = () => {
    setForm({ title: '', body: '', categoryName: defaultCategoryName, tagNames: ['灵感'], status: 'pending' })
    setEditingNote(null)
    setDrawerOpen(true)
  }
  const openNote = (n: NoteItem) => {
    setEditingNote(n)
    setForm({ title: n.title, body: n.body, categoryName: n.category?.name ?? '', tagNames: [...n.tags], status: n.status })
    setDrawerOpen(true)
  }

  const save = async () => {
    if (!form.title.trim() && !form.body.trim()) { toast('标题或内容至少写一样', 'err'); return }
    setSaving(true)
    try {
      const payload = {
        title: form.title.trim() || form.body.trim().split('\n')[0].slice(0, 120),
        body: form.body,
        categoryId: await resolveCategoryIdByName(cats, form.categoryName, createCategory),
        tags: form.tagNames,
        status: form.status,
      }
      if (editingNote) {
        const saved = await api.put<NoteItem>(`/workbench/notes/${editingNote.id}`, payload)
        toast('已保存修改')
        setEditingNote(saved)
      } else {
        await api.post('/workbench/notes', { ...payload, date: todayYMD() })
        toast('已记录')
        setDrawerOpen(false)
      }
      load()
    } catch (e: unknown) {
      toast(errMsg(e, '保存失败'), 'err')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (n: NoteItem) => {
    if (!(await confirmDialog({ title: '删除笔记', description: `确定删除「${n.title || '（无标题）'}」？删除后不可恢复。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/workbench/notes/${n.id}`)
      toast('已删除')
      setDrawerOpen(false)
      load()
    } catch (e: unknown) {
      toast(errMsg(e, '删除失败'), 'err')
    }
  }

  return (
    <>
      <PageHeader
        title="灵感笔记"
        subtitle={`共 ${items.length} 条 · 分类标签与文章共用`}
        actions={
          <>
            <div className="seg" style={{ marginRight: 12 }} aria-label="状态筛选">
              {NOTE_STATUS.map((s) => (
                <button key={s.value} type="button" className={`seg-btn ${statusFilter === s.value ? 'on' : ''}`} onClick={() => setStatusFilter(s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="seg" style={{ marginRight: 12 }} aria-label="笔记布局切换">
              {NOTE_STYLES.map((s) => (
                <button key={s} type="button" className={`seg-btn ${style === s ? 'on' : ''}`} onClick={() => { setNoteStyle(s); setStyle(s) }}>
                  {NOTE_STYLE_LABELS[s]}
                </button>
              ))}
            </div>
            <button className="btn" onClick={openCreate}><Icon name="plus" size={16} /> 随手记</button>
          </>
        }
      />

      <div className="grid g-2 note-grid" data-style={style}>
        {loading ? (
          <EmptyState>载入中…</EmptyState>
        ) : sorted.length === 0 ? (
          <EmptyState>还没有笔记，捕捉一个灵感吧</EmptyState>
        ) : (
          sorted.map((n) => {
            return (
              <div key={n.id} className="note" data-date={n.date} data-tags={n.tags[0] ?? ''} style={{ cursor: 'pointer' }} title="点击查看与编辑" onClick={() => { openNote(n) }}>
                <div className="nt" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', color: 'var(--text-tertiary)' }}>
                    <Icon name="book" size={16} />
                  </span>
                  {n.title || '（无标题）'}
                </div>
                <div className="nb">{n.body.replace(/[#*`>\-[\]]/g, '').slice(0, 140) || '（暂无内容）'}</div>
                <div className="nm">
                  {n.category?.name && <span className="chip">{n.category.name}</span>}
                  <span className={`chip nst st-${n.status}`} title={`状态：${NOTE_STATUS_LABEL[n.status]}`}>{NOTE_STATUS_LABEL[n.status]}</span>
                  {n.tags.slice(0, 2).map((t) => <span key={t} className="chip">#{t}</span>)}
                  <span className="dt">{n.date}</span>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 编辑抽屉：查看=编辑，标题/分类/标签/正文直接在此修改，不再弹二次弹窗 */}
      {drawerOpen && (
        <Drawer
          width={720}
          title={editingNote ? (editingNote.title || '（无标题）') : '随手记'}
          hint={editingNote ? `${editingNote.date} 记录` : '新灵感 · 默认分类/标签「灵感」'}
          onClose={() => { setDrawerOpen(false); setEditingNote(null) }}
          footer={
            <>
              {editingNote && (
                <button className="btn ghost danger" onClick={() => remove(editingNote)}><Icon name="trash" size={15} /> 删除</button>
              )}
              <div className="spacer" />
              <button className="btn" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </>
          }
        >
          <Field label="标题（留空自动取正文首行）">
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="一句话标题" autoFocus />
          </Field>
          <div className="grid g-3">
            <Field label="分类（可搜索新建）">
              <TagMultiSelect
                multiple={false}
                ariaLabel="分类（与文章共用，可搜索新建）"
                placeholder="选择或新建分类…"
                tags={form.categoryName ? [form.categoryName] : []}
                suggestions={cats.map((c) => c.name)}
                onCreate={createCategory}
                onChange={(names) => setForm((f) => ({ ...f, categoryName: names[0] ?? '' }))}
              />
            </Field>
            <Field label="状态">
              <Dropdown
                value={form.status}
                align="left"
                options={NOTE_STATUS.filter((s): s is { value: NoteStatus; label: string } => s.value !== '').map((s) => ({ value: s.value, label: s.label }))}
                onChange={(v) => setForm((f) => ({ ...f, status: v as NoteStatus }))}
              />
            </Field>
            <Field label="标签（可搜索新建）">
              <TagMultiSelect
                ariaLabel="标签（与文章共用，可搜索新建）"
                placeholder="添加标签…"
                tags={form.tagNames}
                suggestions={tagPool}
                onChange={(tagNames) => setForm((f) => ({ ...f, tagNames }))}
              />
            </Field>
          </div>
          <Field label="内容" as="div">
            <MarkdownEditor value={form.body} onChange={(md) => setForm((f) => ({ ...f, body: md }))} minHeight={120} uncontrolled />
          </Field>
        </Drawer>
      )}
    </>
  )
}
