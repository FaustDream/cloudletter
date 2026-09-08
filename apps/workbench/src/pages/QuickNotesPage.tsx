/**
 * 速记汇总：集中查看全部速记灵感（计划类速记已并入今日计划，在「目标 → 今日计划」管理）。
 * 列表展示标题、内容预览、创建时间与共用分类/标签；
 * 点击 → 详情侧栏（全文渲染）→ 编辑弹窗（文章编辑器内核）→ 保存。
 * 编辑弹窗：分类/标签=Notion 式下拉（可搜索新建）；编辑器非受控（value 仅初值、
 * 外部不回灌），杜绝受控回灌把输入重置（表现如撤销）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Category, type NoteItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { Drawer } from '../components/framework/Drawer'
import { MarkdownView } from '../components/framework/MarkdownView'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { TagMultiSelect } from '../components/editor/TagMultiSelect'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { resolveCategoryIdByName } from '../lib/taxonomy'

export function QuickNotesPage() {
  const [items, setItems] = useState<NoteItem[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [kw, setKw] = useState('')
  /** 详情：note 全量展示；编辑：编辑态（detail 为空时也可从新建进入） */
  const [detail, setDetail] = useState<NoteItem | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<{ title: string; body: string; categoryName: string; tagNames: string[] }>({ title: '', body: '', categoryName: '', tagNames: ['灵感'] })
  /** 全站标签池（Notion 式标签下拉候选） */
  const [tagPool, setTagPool] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: NoteItem[] }>('/workbench/notes')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

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

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [items],
  )

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase()
    return sorted.filter((n) => {
      if (k && !(n.title.toLowerCase().includes(k) || n.body.toLowerCase().includes(k) || n.tags.join(',').toLowerCase().includes(k))) return false
      return true
    })
  }, [sorted, kw])

  const openCreate = () => {
    setForm({ title: '', body: '', categoryName: defaultCategoryName, tagNames: ['灵感'] })
    setCreating(true)
    setEditing(true)
  }

  const openEdit = (n: NoteItem) => {
    setForm({ title: n.title, body: n.body, categoryName: n.category?.name ?? '', tagNames: [...n.tags] })
    setDetail(n)
    setEditing(true)
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
      }
      if (creating) {
        await api.post('/workbench/notes', { ...payload, date: new Date().toISOString().slice(0, 10) })
        toast('已记录')
      } else if (detail) {
        await api.put(`/workbench/notes/${detail.id}`, payload)
        toast('已保存修改')
      }
      setEditing(false)
      setCreating(false)
      setDetail(null)
      load()
    } catch (e: any) {
      toast(e?.message || '保存失败', 'err')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (n: NoteItem) => {
    if (!(await confirmDialog({ title: '删除速记', description: `确定删除「${n.title || '（无标题）'}」？删除后不可恢复。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/workbench/notes/${n.id}`)
      toast('已删除')
      setDetail(null)
      load()
    } catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }

  return (
    <>
      <PageHeader
        title="速记汇总"
        subtitle={`共 ${items.length} 条 · 分类标签与文章共用 · 计划请到「目标 → 今日计划」`}
        actions={<button className="btn" onClick={openCreate}><Icon name="plus" size={16} /> 新增速记</button>}
      />

      <div className="qn-toolbar">
        <div className="spacer" />
        <input className="qn-search" type="search" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索标题 / 内容 / 标签" />
      </div>

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState style={{ padding: '36px 20px' }}>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 6 }}>没有符合条件的速记</div>
          <div style={{ marginBottom: 16, color: 'var(--text-tertiary)' }}>任意页面按 Ctrl/⌘+N 或点左下角 ⚡ 都能随时速记</div>
          <button className="btn slim" onClick={openCreate}><Icon name="plus" size={14} /> 新增速记</button>
        </EmptyState>
      ) : (
        <div className="wb-list qn-list">
          {filtered.map((n) => (
            <div key={n.id} className="wb-item" onClick={() => { setDetail(n); setEditing(false) }}>
              <div className="wtx">
                <div className="wn">{n.title || '（无标题）'}</div>
                {n.body && <div className="wsub">{n.body.replace(/[#*`>\-[\]]/g, '').slice(0, 90)}</div>}
                <div className="wst">
                  创建于 {(n.createdAt || '').slice(0, 16).replace('T', ' ')}
                  {n.category?.name ? ` · ${n.category.name}` : ''}
                  {n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(' ')}` : ''}
                </div>
              </div>
              <button className="wdel" title="编辑" onClick={(e) => { e.stopPropagation(); openEdit(n) }}>
                <Icon name="pen" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 详情侧栏：全文 + 编辑入口 */}
      {detail && !editing && (
        <Drawer
          width={560}
          title={detail.title || '（无标题）'}
          hint={`${(detail.createdAt || '').slice(0, 16).replace('T', ' ')} 创建${detail.category?.name ? ` · ${detail.category.name}` : ''}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn ghost danger" onClick={() => remove(detail)}><Icon name="trash" size={15} /> 删除</button>
              <div className="spacer" />
              <button className="btn" onClick={() => openEdit(detail)}><Icon name="pen" size={15} /> 编辑</button>
            </>
          }
        >
          <MarkdownView value={detail.body} empty="（这条速记没有正文）" />
          {detail.tags.length > 0 && (
            <div className="qn-tags">
              {detail.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
            </div>
          )}
        </Drawer>
      )}

      {/* 编辑弹窗（文章编辑器内核） */}
      {editing && (
        <Modal
          title={creating ? '新增速记' : '编辑速记'}
          onClose={() => { setEditing(false); setCreating(false) }}
          size="lg"
          footer={
            <>
              <button className="btn ghost" onClick={() => { setEditing(false); setCreating(false) }}>取消</button>
              <button className="btn" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </>
          }
        >
          <Field label="标题（留空自动取正文首行）">
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="一句话标题" autoFocus />
          </Field>
          <div className="grid g-2">
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
          <Field label="内容">
            <MarkdownEditor value={form.body} onChange={(md) => setForm((f) => ({ ...f, body: md }))} minHeight={120} uncontrolled />
          </Field>
        </Modal>
      )}
    </>
  )
}
