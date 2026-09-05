/**
 * 速记汇总：集中查看全部速记灵感（计划类速记已并入今日计划，在「目标 → 今日计划」管理）。
 * 列表展示标题、内容预览、创建时间与共用分类/标签；
 * 点击 → 详情侧栏（全文渲染）→ 编辑弹窗（文章编辑器内核）→ 保存。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Category, type NoteItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { Drawer } from '../components/framework/Drawer'
import { MarkdownView } from '../components/framework/MarkdownView'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { Dropdown } from '../components/framework/Dropdown'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'

export function QuickNotesPage() {
  const [items, setItems] = useState<NoteItem[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [kw, setKw] = useState('')
  /** 详情：note 全量展示；编辑：编辑态（detail 为空时也可从新建进入） */
  const [detail, setDetail] = useState<NoteItem | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<{ title: string; body: string; categoryId: string; tags: string }>({ title: '', body: '', categoryId: '', tags: '灵感' })
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

  const defaultCategoryId = useMemo(() => cats.find((c) => c.name === '灵感')?.id ?? '', [cats])

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

  const parseTags = () => form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)

  const openCreate = () => {
    setForm({ title: '', body: '', categoryId: defaultCategoryId, tags: '灵感' })
    setCreating(true)
    setEditing(true)
  }

  const openEdit = (n: NoteItem) => {
    setForm({ title: n.title, body: n.body, categoryId: n.categoryId ?? '', tags: n.tags.join(', ') })
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
        categoryId: form.categoryId,
        tags: parseTags(),
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
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>没有符合条件的速记</div>
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
            <Field label="分类（与文章共用）">
              <Dropdown
                value={form.categoryId}
                align="left"
                options={[{ value: '', label: '无分类' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]}
                onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
              />
            </Field>
            <Field label="标签（逗号分隔，与文章共用）">
              <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="如：灵感，学习" />
            </Field>
          </div>
          <Field label="内容">
            <MarkdownEditor value={form.body} onChange={(md) => setForm((f) => ({ ...f, body: md }))} minHeight={260} />
          </Field>
        </Modal>
      )}
    </>
  )
}
