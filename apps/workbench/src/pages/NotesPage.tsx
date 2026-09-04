/** 灵感笔记：卡片网格（card/list/timeline 多风格）；点击查看详情侧栏 → 编辑弹窗（文章编辑器内核）→ 保存修改 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type NoteItem, type NoteType } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { Drawer } from '../components/framework/Drawer'
import { MarkdownView } from '../components/framework/MarkdownView'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { todayYMD } from '../lib/date'
import { noteStyle, type NoteStyle } from '../lib/layout'
import { NOTE_TYPES } from '../components/timeline/QuickNoteModal'

const TYPE_META: Record<NoteType, { label: string; color: string }> = {
  inspiration: { label: '灵感', color: '#D97706' },
  plan: { label: '计划', color: '#EA580C' },
}

export function NotesPage() {
  const [items, setItems] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(true)
  /** creating=true 新建；editing 携带被编辑的笔记 */
  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<NoteItem | null>(null)
  /** 详情侧栏（查看全文） */
  const [detail, setDetail] = useState<NoteItem | null>(null)
  const [form, setForm] = useState<{ title: string; body: string; type: NoteType; mood: string }>({ title: '', body: '', type: 'inspiration', mood: '' })
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

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [items],
  )

  const openCreate = () => {
    setForm({ title: '', body: '', type: 'inspiration', mood: '' })
    setCreating(true); setEditing(null); setFormOpen(true)
  }
  const openEdit = (n: NoteItem) => {
    setForm({ title: n.title, body: n.body, type: n.type === 'plan' ? 'plan' : 'inspiration', mood: n.mood || '' })
    setCreating(false); setEditing(n); setFormOpen(true)
  }

  const submit = async () => {
    if (!form.title.trim() && !form.body.trim()) { toast('标题或内容至少写一样', 'err'); return }
    setSaving(true)
    try {
      const payload = {
        title: form.title.trim() || form.body.trim().split('\n')[0].slice(0, 120),
        body: form.body,
        type: form.type,
        mood: form.mood.trim(),
      }
      if (creating) {
        await api.post('/workbench/notes', { ...payload, date: todayYMD() })
        toast('已记录')
      } else if (editing) {
        await api.put(`/workbench/notes/${editing.id}`, payload)
        toast('已保存修改')
        if (detail?.id === editing.id) setDetail({ ...editing, ...payload })
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
        subtitle={`共 ${items.length} 条`}
        actions={<button className="btn" onClick={openCreate}><Icon name="plus" size={16} /> 随手记</button>}
      />

      <div className="grid g-2 note-grid" data-style={style}>
        {loading ? (
          <EmptyState>载入中…</EmptyState>
        ) : sorted.length === 0 ? (
          <EmptyState>还没有笔记，捕捉一个灵感吧</EmptyState>
        ) : (
          sorted.map((n) => {
            const meta = TYPE_META[n.type === 'plan' ? 'plan' : 'inspiration']
            return (
              <div key={n.id} className="note" data-date={n.date} data-mood={n.mood} style={{ cursor: 'pointer' }} title="点击查看详情" onClick={() => { setDetail(n) }}>
                <div className="nt" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ display: 'inline-flex', color: 'var(--text-tertiary)' }}>
                    <Icon name="book" size={16} />
                  </span>
                  {n.title || '（无标题）'}
                </div>
                <div className="nb">{n.body.replace(/[#*`>\-[\]]/g, '').slice(0, 140) || '（暂无内容）'}</div>
                <div className="nm">
                  <span className="chip pill-color" style={{ background: `color-mix(in srgb, ${meta.color} 16%, transparent)`, color: meta.color }}>{meta.label}</span>
                  {n.mood && <span className="chip">{n.mood.split(',').filter(Boolean)[0]}</span>}
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
          title={<span className="qn-drawer-title"><span className="qn-type" style={{ color: TYPE_META[detail.type === 'plan' ? 'plan' : 'inspiration'].color, background: `color-mix(in srgb, ${TYPE_META[detail.type === 'plan' ? 'plan' : 'inspiration'].color} 12%, transparent)` }}>{TYPE_META[detail.type === 'plan' ? 'plan' : 'inspiration'].label}</span>{detail.title || '（无标题）'}</span>}
          hint={`${detail.date} 记录`}
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
          {detail.mood && (
            <div className="qn-tags">
              {detail.mood.split(',').filter(Boolean).map((t) => <span key={t} className="chip">#{t.trim()}</span>)}
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
            <Field label="类型">
              <div style={{ display: 'flex', gap: 6 }}>
                {NOTE_TYPES.map(([k, l]) => (
                  <button key={k} type="button" className={`seg-btn ${form.type === k ? 'on' : ''}`} onClick={() => setForm({ ...form, type: k as NoteType })}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label="标签（逗号分隔，可选）">
              <input type="text" value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })} placeholder="如：灵感，学习" />
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
