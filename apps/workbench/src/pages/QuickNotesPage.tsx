/**
 * 速记汇总：集中查看全部速记（灵感 / 计划）。
 * 列表展示类型徽章、标题、内容预览、创建时间与状态（计划类可标记完成）；
 * 点击 → 详情侧栏（全文渲染）→ 编辑弹窗（文章编辑器内核）→ 保存。
 */
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
import { NOTE_TYPES } from '../components/timeline/QuickNoteModal'

const TYPE_META: Record<NoteType, { label: string; color: string }> = {
  inspiration: { label: '灵感', color: '#D97706' },
  plan: { label: '计划', color: '#EA580C' },
}

type TypeFilter = 'all' | NoteType
type StatusFilter = 'all' | 'open' | 'done'

export function QuickNotesPage() {
  const [items, setItems] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [kw, setKw] = useState('')
  /** 详情：note 全量展示；编辑：编辑态（detail 为空时也可从新建进入） */
  const [detail, setDetail] = useState<NoteItem | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<{ title: string; body: string; type: NoteType; mood: string }>({ title: '', body: '', type: 'inspiration', mood: '' })
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

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [items],
  )

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase()
    return sorted.filter((n) => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false
      if (statusFilter === 'open' && n.done) return false
      if (statusFilter === 'done' && !n.done) return false
      if (k && !(n.title.toLowerCase().includes(k) || n.body.toLowerCase().includes(k) || (n.mood || '').toLowerCase().includes(k))) return false
      return true
    })
  }, [sorted, typeFilter, statusFilter, kw])

  const openCreate = () => {
    setForm({ title: '', body: '', type: 'inspiration', mood: '' })
    setCreating(true)
    setEditing(true)
  }

  const openEdit = (n: NoteItem) => {
    setForm({ title: n.title, body: n.body, type: n.type === 'plan' ? 'plan' : 'inspiration', mood: n.mood || '' })
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
        type: form.type,
        mood: form.mood.trim(),
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

  const toggleDone = async (n: NoteItem) => {
    try {
      const now = !n.done
      await api.put(`/workbench/notes/${n.id}`, { done: now, doneAt: now ? new Date().toISOString() : '' })
      if (detail?.id === n.id) setDetail({ ...n, done: now, doneAt: now ? new Date().toISOString() : '' })
      load()
    } catch (e: any) { toast(e?.message || '操作失败', 'err') }
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

  const counts = useMemo(() => ({
    all: items.length,
    inspiration: items.filter((i) => i.type !== 'plan').length,
    plan: items.filter((i) => i.type === 'plan').length,
    done: items.filter((i) => i.done).length,
  }), [items])

  return (
    <>
      <PageHeader
        title="速记汇总"
        subtitle={`共 ${counts.all} 条 · 灵感 ${counts.inspiration} / 计划 ${counts.plan} · 已完成 ${counts.done}`}
        actions={<button className="btn" onClick={openCreate}><Icon name="plus" size={16} /> 新增速记</button>}
      />

      <div className="qn-toolbar">
        <div className="fchips">
          <button className={`fchip${typeFilter === 'all' ? ' on' : ''}`} onClick={() => setTypeFilter('all')}>全部</button>
          {NOTE_TYPES.map(([k, l]) => (
            <button key={k} className={`fchip${typeFilter === k ? ' on' : ''}`} onClick={() => setTypeFilter(k as NoteType)}>
              {l.slice(2)}
            </button>
          ))}
        </div>
        <div className="fchips">
          <button className={`fchip${statusFilter === 'all' ? ' on' : ''}`} onClick={() => setStatusFilter('all')}>全部状态</button>
          <button className={`fchip${statusFilter === 'open' ? ' on' : ''}`} onClick={() => setStatusFilter('open')}>未完成</button>
          <button className={`fchip${statusFilter === 'done' ? ' on' : ''}`} onClick={() => setStatusFilter('done')}>已完成</button>
        </div>
        <div className="spacer" />
        <input className="qn-search" type="search" value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索标题 / 内容 / 标签" />
      </div>

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState style={{ padding: '36px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>没有符合条件的速记</div>
          <div style={{ marginBottom: 16, color: 'var(--text-tertiary)' }}>任意页面按 Ctrl/⌘+N 或点右下角 ⚡ 都能随时速记</div>
          <button className="btn slim" onClick={openCreate}><Icon name="plus" size={14} /> 新增速记</button>
        </EmptyState>
      ) : (
        <div className="wb-list qn-list">
          {filtered.map((n) => {
            const meta = TYPE_META[n.type === 'plan' ? 'plan' : 'inspiration']
            return (
              <div key={n.id} className={`wb-item ${n.done ? 'done' : ''}`} onClick={() => { setDetail(n); setEditing(false) }}>
                <span className="qn-type" style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}>{meta.label}</span>
                <div className="wtx">
                  <div className={`wn ${n.done ? 'done' : ''}`}>{n.title || '（无标题）'}</div>
                  {n.body && <div className="wsub">{n.body.replace(/[#*`>\-[\]]/g, '').slice(0, 90)}</div>}
                  <div className="wst">
                    创建于 {(n.createdAt || '').slice(0, 16).replace('T', ' ')}
                    {n.mood ? ` · #${n.mood.split(',').join(' #')}` : ''}
                  </div>
                </div>
                {n.type === 'plan' && (
                  <button
                    className={`qn-done ${n.done ? 'on' : ''}`}
                    title={n.done ? `完成于 ${(n.doneAt || '').slice(0, 16).replace('T', ' ')}` : '标记完成'}
                    onClick={(e) => { e.stopPropagation(); toggleDone(n) }}
                  >
                    <Icon name={n.done ? 'check' : 'clock'} size={15} /> {n.done ? '已完成' : '未完成'}
                  </button>
                )}
                <button className="wdel" title="编辑" onClick={(e) => { e.stopPropagation(); openEdit(n) }}>
                  <Icon name="pen" size={15} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* 详情侧栏：全文 + 编辑入口 */}
      {detail && !editing && (
        <Drawer
          width={560}
          title={<span className="qn-drawer-title"><span className="qn-type" style={{ color: TYPE_META[detail.type === 'plan' ? 'plan' : 'inspiration'].color, background: `color-mix(in srgb, ${TYPE_META[detail.type === 'plan' ? 'plan' : 'inspiration'].color} 12%, transparent)` }}>{TYPE_META[detail.type === 'plan' ? 'plan' : 'inspiration'].label}</span>{detail.title || '（无标题）'}</span>}
          hint={`${(detail.createdAt || '').slice(0, 16).replace('T', ' ')} 创建`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn ghost danger" onClick={() => remove(detail)}><Icon name="trash" size={15} /> 删除</button>
              <div className="spacer" />
              {detail.type === 'plan' && (
                <button className={`btn ghost${detail.done ? ' ok' : ''}`} onClick={() => toggleDone(detail)}>
                  <Icon name="check" size={15} /> {detail.done ? '取消完成' : '标记完成'}
                </button>
              )}
              <button className="btn" onClick={() => openEdit(detail)}><Icon name="pen" size={15} /> 编辑</button>
            </>
          }
        >
          <MarkdownView value={detail.body} empty="（这条速记没有正文）" />
          {detail.mood && (
            <div className="qn-tags">
              {detail.mood.split(',').filter(Boolean).map((t) => <span key={t} className="chip">#{t.trim()}</span>)}
            </div>
          )}
          {detail.done && detail.doneAt && <div className="wst done" style={{ marginTop: 10 }}>✅ 完成于 {detail.doneAt.slice(0, 16).replace('T', ' ')}</div>}
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
            <Field label="类型">
              <div style={{ display: 'flex', gap: 6 }}>
                {NOTE_TYPES.map(([k, l]) => (
                  <button key={k} type="button" className={`seg-btn ${form.type === k ? 'on' : ''}`} onClick={() => setForm({ ...form, type: k as NoteType })}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label="标签（逗号分隔，可选）">
              <input type="text" value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })} placeholder="如：灵感，工作" />
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
