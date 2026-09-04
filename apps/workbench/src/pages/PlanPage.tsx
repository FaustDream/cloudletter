/** 今日计划：优先级 + 截止时间 + 逾期/延期状态 + 完成时间 + 空状态引导；
 *  书写直接复用文章编辑器内核（MarkdownEditor），新建/编辑均可查看与修改全文备注 */
import { useCallback, useEffect, useState } from 'react'
import { api, type PlanItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field } from '../components/framework/Modal'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'

const LEVELS: Record<string, { label: string; color: string }> = {
  P0: { label: 'P0 · 紧急', color: 'var(--danger)' },
  P1: { label: 'P1 · 重要', color: 'var(--warn)' },
  P2: { label: 'P2 · 一般', color: 'var(--ok)' },
}
import { todayYMD } from '../lib/date'
import { celebrate, praise } from '../lib/celebrate'
import { Dropdown } from '../components/framework/Dropdown'

interface PlanForm { text: string; level: 'P0' | 'P1' | 'P2'; note: string; dueDate: string }

const EMPTY_FORM: PlanForm = { text: '', level: 'P1', note: '', dueDate: todayYMD() }

export function PlanPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<PlanItem[]>([])
  const [loading, setLoading] = useState(true)
  /** creating=true 新建；editing 携带被编辑的计划 */
  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PlanItem | null>(null)
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: PlanItem[] }>('/workbench/plan')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const done = items.filter((i) => i.done).length
  const overdue = items.filter((i) => !i.done && i.dueDate && i.dueDate < todayYMD()).length

  const openCreate = () => { setForm(EMPTY_FORM); setCreating(true); setEditing(null); setFormOpen(true) }
  const openEdit = (item: PlanItem) => {
    setForm({ text: item.text, level: item.level, note: item.note || '', dueDate: item.dueDate || todayYMD() })
    setCreating(false); setEditing(item); setFormOpen(true)
  }

  const submit = async () => {
    if (!form.text.trim()) { toast('写一下要做什么', 'err'); return }
    setSaving(true)
    try {
      if (creating) {
        await api.post('/workbench/plan', { text: form.text.trim(), level: form.level, note: form.note, dueDate: form.dueDate })
        toast('已添加')
      } else if (editing) {
        await api.put(`/workbench/plan/${editing.id}`, { text: form.text.trim(), level: form.level, note: form.note, dueDate: form.dueDate })
        toast('已保存修改')
      }
      setFormOpen(false); setEditing(null)
      load()
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
    finally { setSaving(false) }
  }

  const toggle = async (item: PlanItem) => {
    try {
      const now = !item.done
      await api.put(`/workbench/plan/${item.id}`, { done: now, doneAt: now ? new Date().toISOString() : '' })
      if (now) {
        celebrate(window.innerWidth / 2, window.innerHeight / 2, 26)
        toast(`✅ 完成计划「${item.text}」· ${praise()}`)
      }
      load()
    } catch (e: any) { toast(e?.message || '操作失败', 'err') }
  }

  const remove = async (item: PlanItem) => {
    try {
      await api.del(`/workbench/plan/${item.id}`)
      toast('已删除'); load()
    } catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }

  const stateOf = (item: PlanItem): { cls: string; label: string } | null => {
    if (item.done) return { cls: 'done', label: `完成于 ${(item.doneAt || item.updatedAt || '').slice(0, 16).replace('T', ' ')}` }
    if (item.dueDate && item.dueDate < todayYMD()) return { cls: 'overdue', label: '已逾期' }
    if (item.dueDate && item.dueDate === todayYMD()) return { cls: 'today', label: '今天到期' }
    if (item.dueDate && item.dueDate > todayYMD()) return { cls: 'soon', label: `${item.dueDate} 到期` }
    return null
  }

  return (
    <>
      <PageHeader
        title={withHeader ? '今日计划' : undefined}
        subtitle={withHeader ? `已完成 ${done} / ${items.length} ${overdue > 0 ? `· ${overdue} 项已逾期` : ''}` : undefined}
        actions={<button className={withHeader ? 'btn' : 'btn slim'} onClick={openCreate}>
          <Icon name="plus" size={15} /> 新建计划
        </button>}
      />

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState style={{ padding: '36px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>今天还没有安排</div>
          <div style={{ marginBottom: 16, color: 'var(--text-tertiary)' }}>创建计划 → 设置优先级与截止时间 → 完成勾选</div>
          <button className="btn slim" onClick={openCreate}>
            <Icon name="plus" size={14} /> 创建第一条计划
          </button>
        </EmptyState>
      ) : (
        <div className="wb-list">
          {items.map((item) => {
            const st = stateOf(item)
            return (
              <div key={item.id} className={`wb-item ${st?.cls ?? ''}`}>
                <div className={`wchk ${item.done ? 'on' : ''}`} onClick={() => toggle(item)}>
                  <Icon name="check" size={15} />
                </div>
                <div className="wtx" onClick={() => openEdit(item)} title="点击查看与编辑">
                  <div className={`wn ${item.done ? 'done' : ''}`}>{item.text}</div>
                  {item.note && <div className="wsub">{item.note.replace(/[#*`>\-[\]]/g, '').slice(0, 80)}</div>}
                  {st && <div className={`wst ${st.cls}`}>{st.label}</div>}
                </div>
                <span className="wlv" style={{ color: LEVELS[item.level]?.color, background: `color-mix(in srgb, ${LEVELS[item.level]?.color} 12%, transparent)` }}>
                  {LEVELS[item.level]?.label ?? item.level}
                </span>
                <button className="wdel" onClick={() => remove(item)} title="删除">
                  <Icon name="trash" size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {formOpen && (
        <Modal title={creating ? '新建计划' : '编辑计划'} size="lg" onClose={() => { setFormOpen(false); setEditing(null) }} footer={
          <>
            <button className="btn ghost" onClick={() => { setFormOpen(false); setEditing(null) }}>取消</button>
            <button className="btn" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </>
        }>
          <Field label="要做什么"><input type="text" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="要做什么？" autoFocus /></Field>
          <div className="grid g-2">
            <Field label="优先级">
              <Dropdown
                value={form.level}
                align="left"
                options={[
                  { value: 'P0', label: 'P0 · 紧急' },
                  { value: 'P1', label: 'P1 · 重要' },
                  { value: 'P2', label: 'P2 · 一般' },
                ]}
                onChange={(v) => setForm({ ...form, level: v as 'P0' | 'P1' | 'P2' })}
              />
            </Field>
            <Field label="截止时间">
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
            </Field>
          </div>
          <Field label="计划详情（文章编辑器 · 可留空）">
            <MarkdownEditor value={form.note} onChange={(md) => setForm((f) => ({ ...f, note: md }))} minHeight={220} />
          </Field>
        </Modal>
      )}
    </>
  )
}
