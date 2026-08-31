/** 今日计划：优先级 + 截止时间 + 逾期/延期状态 + 完成时间 + 空状态引导 */
import { useCallback, useEffect, useState } from 'react'
import { api, type PlanItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field } from '../components/framework/Modal'
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

export function PlanPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<PlanItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [text, setText] = useState('')
  const [level, setLevel] = useState<'P0' | 'P1' | 'P2'>('P1')
  const [note, setNote] = useState('')
  const [dueDate, setDueDate] = useState(todayYMD())
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

  const submit = async () => {
    if (!text.trim()) return
    try {
      await api.post('/workbench/plan', { text: text.trim(), level, note, dueDate })
      toast('已添加')
      setText(''); setNote(''); setCreating(false)
      load()
    } catch (e: any) { toast(e?.message || '添加失败', 'err') }
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
        actions={<button className={withHeader ? 'btn' : 'btn slim'} onClick={() => { setText(''); setNote(''); setLevel('P1'); setDueDate(todayYMD()); setCreating(true) }}>
          <Icon name="plus" size={15} /> 新建计划
        </button>}
      />

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState style={{ padding: '36px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>今天还没有安排</div>
          <div style={{ marginBottom: 16, color: 'var(--text-tertiary)' }}>创建计划 → 设置优先级与截止时间 → 完成勾选</div>
          <button className="btn slim" onClick={() => { setText(''); setNote(''); setLevel('P1'); setDueDate(todayYMD()); setCreating(true) }}>
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
                <div className="wtx">
                  <div className={`wn ${item.done ? 'done' : ''}`}>{item.text}</div>
                  {item.note && <div className="wsub">{item.note}</div>}
                  {st && <div className={`wst ${st.cls}`}>{st.label}</div>}
                </div>
                <span className="wlv" style={{ color: LEVELS[item.level]?.color, background: `color-mix(in srgb, ${LEVELS[item.level]?.color} 12%, transparent)` }}>
                  {LEVELS[item.level]?.label ?? item.level}
                </span>
                <button className="wdel" onClick={() => remove(item)}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {creating && (
        <Modal title="新建计划" onClose={() => setCreating(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setCreating(false)}>取消</button>
            <button className="btn" onClick={submit}>保存</button>
          </>
        }>
          <Field label="内容"><input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="要做什么？" maxLength={100} autoFocus /></Field>
          <div className="grid g-2">
            <Field label="优先级">
              <Dropdown
                value={level}
                align="left"
                options={[
                  { value: 'P0', label: 'P0 · 紧急' },
                  { value: 'P1', label: 'P1 · 重要' },
                  { value: 'P2', label: 'P2 · 一般' },
                ]}
                onChange={(v) => setLevel(v as 'P0' | 'P1' | 'P2')}
              />
            </Field>
            <Field label="截止时间">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <Field label="备注（可选）"><input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="补充说明" maxLength={200} /></Field>
        </Modal>
      )}
    </>
  )
}