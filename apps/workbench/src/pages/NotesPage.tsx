/** 灵感笔记：卡片网格（card/list/timeline 多风格）；随手记=新建灵感（默认分类/标签「灵感」）；
 *  点击查看详情侧栏 → 编辑弹窗（文章编辑器内核）→ 保存修改。计划类速记已并入今日计划。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import { todayYMD } from '../lib/date'
import { noteStyle, type NoteStyle } from '../lib/layout'

/** 标签输入 → 标签数组（逗号/中文逗号分隔） */
const parseTags = (s: string) => s.split(/[,，]/).map((t) => t.trim()).filter(Boolean)

export function NotesPage() {
  const [sp, setSp] = useSearchParams()
  const [items, setItems] = useState<NoteItem[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  /** creating=true 新建；editing 携带被编辑的笔记 */
  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<NoteItem | null>(null)
  /** 详情侧栏（查看全文） */
  const [detail, setDetail] = useState<NoteItem | null>(null)
  const [form, setForm] = useState<{ title: string; body: string; categoryId: string; tags: string }>({ title: '', body: '', categoryId: '', tags: '灵感' })
  const [saving, setSaving] = useState(false)
  const [style, setStyle] = useState<NoteStyle>(noteStyle)
  const toast = useToast()

  // 风格偏好切换：设置页写入后同 tab 内即时生效
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

  // 分类下拉数据（新建默认取「灵感」分类）
  useEffect(() => {
    api.get<{ items: Category[] }>('/categories').then((r) => setCats(r.items)).catch(() => {})
  }, [])

  const defaultCategoryId = useMemo(() => cats.find((c) => c.name === '灵感')?.id ?? '', [cats])

  // 分类标签页内容抽屉深链：/notes?focus=<id> → 直接打开该笔记详情
  useEffect(() => {
    const fid = sp.get('focus')
    if (!fid) return
    const hit = items.find((n) => n.id === fid)
    if (hit) setDetail(hit)
    setSp({}, { replace: true })
  }, [sp, items, setSp])

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [items],
  )

  const openCreate = () => {
    setForm({ title: '', body: '', categoryId: defaultCategoryId, tags: '灵感' })
    setCreating(true); setEditing(null); setFormOpen(true)
  }
  const openEdit = (n: NoteItem) => {
    setForm({ title: n.title, body: n.body, categoryId: n.categoryId ?? '', tags: n.tags.join(', ') })
    setCreating(false); setEditing(n); setFormOpen(true)
  }

  const submit = async () => {
    if (!form.title.trim() && !form.body.trim()) { toast('标题或内容至少写一样', 'err'); return }
    setSaving(true)
    try {
      const payload = {
        title: form.title.trim() || form.body.trim().split('\n')[0].slice(0, 120),
        body: form.body,
        categoryId: form.categoryId,
        tags: parseTags(form.tags),
      }
      if (creating) {
        await api.post('/workbench/notes', { ...payload, date: todayYMD() })
        toast('已记录')
      } else if (editing) {
        await api.put(`/workbench/notes/${editing.id}`, payload)
        toast('已保存修改')
        if (detail?.id === editing.id) setDetail({ ...editing, ...payload, tags: payload.tags })
      }
      setFormOpen(false); setEditing(null)
      load()
    } catch (e: any) {
      toast(e?.message || '保存失败', 'err')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (n: NoteItem) => {
    if (!(await confirmDialog({ title: '删除笔记', description: `确定删除「${n.title || '（无标题）'}」？删除后不可恢复。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/workbench/notes/${n.id}`)
      toast('已删除')
      setDetail(null)
      load()
    } catch (e: any) {
      toast(e?.message || '删除失败', 'err')
    }
  }

  return (
    <>
      <PageHeader
        title="灵感笔记"
        subtitle={`共 ${items.length} 条 · 分类标签与文章共用`}
        actions={<button className="btn" onClick={openCreate}><Icon name="plus" size={16} /> 随手记</button>}
      />

      <div className="grid g-2 note-grid" data-style={style}>
        {loading ? (
          <EmptyState>载入中…</EmptyState>
        ) : sorted.length === 0 ? (
          <EmptyState>还没有笔记，捕捉一个灵感吧</EmptyState>
        ) : (
          sorted.map((n) => {
            return (
              <div key={n.id} className="note" data-date={n.date} data-tags={n.tags[0] ?? ''} style={{ cursor: 'pointer' }} title="点击查看详情" onClick={() => { setDetail(n) }}>
                <div className="nt" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', color: 'var(--text-tertiary)' }}>
                    <Icon name="book" size={16} />
                  </span>
                  {n.title || '（无标题）'}
                </div>
                <div className="nb">{n.body.replace(/[#*`>\-[\]]/g, '').slice(0, 140) || '（暂无内容）'}</div>
                <div className="nm">
                  {n.category?.name && <span className="chip">{n.category.name}</span>}
                  {n.tags.slice(0, 2).map((t) => <span key={t} className="chip">#{t}</span>)}
                  <span className="dt">{n.date}</span>
                  <button className="ndel" title="编辑" onClick={(e) => { e.stopPropagation(); openEdit(n) }}>
                    <Icon name="pen" size={15} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* 详情侧栏：全文 + 编辑/删除 */}
      {detail && (
        <Drawer
          width={560}
          title={detail.title || '（无标题）'}
          hint={`${detail.date} 记录${detail.category?.name ? ` · ${detail.category.name}` : ''}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn ghost danger" onClick={() => remove(detail)}><Icon name="trash" size={15} /> 删除</button>
              <div className="spacer" />
              <button className="btn" onClick={() => openEdit(detail)}><Icon name="pen" size={15} /> 编辑</button>
            </>
          }
        >
          <MarkdownView value={detail.body} empty="（这条笔记没有正文）" />
          {detail.tags.length > 0 && (
            <div className="qn-tags">
              {detail.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
            </div>
          )}
        </Drawer>
      )}

      {formOpen && (
        <Modal
          title={creating ? '随手记' : '编辑笔记'}
          size="lg"
          onClose={() => { setFormOpen(false); setEditing(null) }}
          footer={
            <>
              <button className="btn ghost" onClick={() => { setFormOpen(false); setEditing(null) }}>取消</button>
              <button className="btn" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
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
