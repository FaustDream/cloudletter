/** 习惯打卡：今日打卡 / 连续天数 / 打卡热图；笔图标 → 右侧抽屉编辑详情（文章编辑器内核），
 *  布局三式：舒适卡片（默认）/ 紧凑 / 分组（今日已打 / 今日未打） */
import { useCallback, useEffect, useState } from 'react'
import { api, type CheckinItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Field, confirmDialog } from '../components/framework/Modal'
import { Drawer } from '../components/framework/Drawer'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'

import { todayYMD } from '../lib/date'
import { parseLog, computeStreak } from '../lib/checkin'
import { checkinStyle, setCheckinStyle, CHECKIN_STYLE_LABELS, type CheckinStyle } from '../lib/layout'

interface CkForm { name: string; emoji: string; desc: string }

export function CheckinPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<CheckinItem[]>([])
  const [loading, setLoading] = useState(true)
  /** 编辑抽屉：editing=null 且抽屉开 = 新建 */
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CheckinItem | null>(null)
  const [form, setForm] = useState<CkForm>({ name: '', emoji: '✨', desc: '' })
  const [saving, setSaving] = useState(false)
  const [ls, setLs] = useState<CheckinStyle>(checkinStyle)
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: CheckinItem[] }>('/workbench/checkin')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const todayDone = items.filter((i) => parseLog(i.log)[todayYMD()]).length

  const openCreate = () => { setForm({ name: '', emoji: '✨', desc: '' }); setCreating(true); setEditing(null); setDrawerOpen(true) }
  const openEdit = (item: CheckinItem) => {
    setForm({ name: item.name, emoji: item.emoji || '✨', desc: item.desc || '' })
    setCreating(false); setEditing(item); setDrawerOpen(true)
  }

  const submit = async () => {
    if (!form.name.trim()) { toast('写一下习惯名称', 'err'); return }
    setSaving(true)
    try {
      if (creating) {
        await api.post('/workbench/checkin', { name: form.name.trim(), emoji: form.emoji, desc: form.desc })
        toast('已创建习惯')
        setDrawerOpen(false)
      } else if (editing) {
        await api.put(`/workbench/checkin/${editing.id}`, { name: form.name.trim(), emoji: form.emoji, desc: form.desc })
        toast('已保存修改')
      }
      setEditing(null)
      load()
    } catch (e: any) {
      toast(e?.message || '保存失败', 'err')
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (item: CheckinItem) => {
    const log = { ...parseLog(item.log), [todayYMD()]: !parseLog(item.log)[todayYMD()] }
    try {
      await api.put(`/workbench/checkin/${item.id}`, { log: JSON.stringify(log), streak: computeStreak(JSON.stringify(log)) })
      load()
    } catch (e: any) {
      toast(e?.message || '操作失败', 'err')
    }
  }

  const remove = async (item: CheckinItem) => {
    if (!(await confirmDialog({ title: '删除习惯', description: `确定删除习惯「${item.name}」？其打卡记录将一并清空。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/workbench/checkin/${item.id}`)
      toast('已删除')
      setDrawerOpen(false)
      load()
    } catch (e: any) {
      toast(e?.message || '删除失败', 'err')
    }
  }

  const ckCard = (item: CheckinItem) => {
    const done = !!parseLog(item.log)[todayYMD()]
    const streak = computeStreak(item.log)
    return (
      <div key={item.id} className={`ck-card ${done ? 'done' : ''}`} onClick={() => toggle(item)}>
        <div className="ck-ic">{item.emoji}</div>
        <div className="ck-tx">
          <div className="ckn">{item.name}</div>
          <div className="cks">
            <span>连续 <b>{streak}</b> 天</span>
            {streak >= 3 && <span className="fire">🔥</span>}
          </div>
        </div>
        <div className="ck-st">
          <Icon name={done ? 'check' : 'x'} size={18} />
        </div>
        <button
          className="ck-del"
          title="编辑习惯"
          onClick={(e) => { e.stopPropagation(); openEdit(item) }}
        >
          <Icon name="pen" size={15} />
        </button>
        <button
          className="ck-del"
          title="删除习惯"
          onClick={(e) => { e.stopPropagation(); remove(item) }}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
    )
  }

  // 分组视图：今日已打 / 今日未打
  const grouped = ls === 'group' ? [
    { label: '今日已打', list: items.filter((i) => parseLog(i.log)[todayYMD()]) },
    { label: '今日未打', list: items.filter((i) => !parseLog(i.log)[todayYMD()]) },
  ].filter((s) => s.list.length > 0) : null

  return (
    <>
      <PageHeader
        title={withHeader ? '习惯' : undefined}
        subtitle={withHeader ? `今日已完成 ${todayDone} / ${items.length}` : undefined}
        actions={
          <>
            <div className="seg" style={{ marginRight: 12 }} aria-label="习惯布局切换">
              {(Object.keys(CHECKIN_STYLE_LABELS) as CheckinStyle[]).map((s) => (
                <button key={s} type="button" className={`seg-btn ${ls === s ? 'on' : ''}`} onClick={() => { setCheckinStyle(s); setLs(s) }}>
                  {CHECKIN_STYLE_LABELS[s]}
                </button>
              ))}
            </div>
            <button className={withHeader ? 'btn' : 'btn slim'} onClick={openCreate}>
              <Icon name="plus" size={15} /> 新增习惯
            </button>
          </>
        }
      />

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState style={{ padding: '36px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>创建习惯，开始每天打卡</div>
          <div style={{ marginBottom: 16, color: 'var(--text-tertiary)' }}>创建习惯 → 每天勾选打卡 → 培养连续记录</div>
          <button className="btn slim" onClick={openCreate}>
            <Icon name="plus" size={14} /> 创建第一个习惯
          </button>
        </EmptyState>
      ) : (
        <>
          {/* 近 35 天热图（按习惯聚合） */}
          {items.length > 0 && (
            <div className="ck-heat card">
              <div className="sh" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>
                <Icon name="flame" size={15} /> 近 35 天打卡热图
                <span className="dim" style={{ marginLeft: 'auto', fontWeight: 500 }}>绿块 = 有打卡记录</span>
              </div>
              <div className="heat-grid">
                {[...Array(35)].map((_, i) => {
                  const d = new Date()
                  d.setDate(d.getDate() - (34 - i))
                  const key = d.toISOString().slice(0, 10)
                  const count = items.filter((it) => parseLog(it.log)[key]).length
                  const level = count === 0 ? 0 : count >= 3 ? 3 : count >= 2 ? 2 : 1
                  return (
                    <div key={key} className={`heat-cell lv${level}`} title={`${key} · ${count} 个习惯打卡`} />
                  )
                })}
              </div>
            </div>
          )}
          {grouped ? (
            grouped.map((sec) => (
              <div className="gl-group" key={sec.label}>
                <div className="gl-group-h">{sec.label}<em>{sec.list.length}</em></div>
                <div className="ck-grid" data-ls={ls}>{sec.list.map(ckCard)}</div>
              </div>
            ))
          ) : (
            <div className="ck-grid" data-ls={ls}>{items.map(ckCard)}</div>
          )}
        </>
      )}

      {/* 编辑抽屉：新增/编辑合一，说明用文章编辑器内核 */}
      {drawerOpen && (
        <Drawer
          width={560}
          title={creating ? '新增习惯' : `${editing?.emoji ?? '✨'} ${editing?.name ?? ''}`}
          hint={editing ? `连续 ${computeStreak(editing.log)} 天` : undefined}
          onClose={() => { setDrawerOpen(false); setEditing(null) }}
          footer={
            <>
              {editing && (
                <button className="btn ghost danger" onClick={() => remove(editing)}><Icon name="trash" size={15} /> 删除</button>
              )}
              <div className="spacer" />
              <button className="btn" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </>
          }
        >
          <Field label="名称">
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：晨跑 30 分钟" autoFocus />
          </Field>
          <Field label="图标（emoji）">
            <input type="text" value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} maxLength={4} placeholder="✨" />
          </Field>
          <Field label="习惯说明 / 执行计划（文章编辑器 · 可留空）">
            <MarkdownEditor value={form.desc} onChange={(md) => setForm((f) => ({ ...f, desc: md }))} minHeight={220} />
          </Field>
        </Drawer>
      )}
    </>
  )
}
