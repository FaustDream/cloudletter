/** 长期目标：进度可视化 + 关联（目标 → 今日计划/习惯）；点目标行 → 右侧抽屉直接编辑，
 *  布局三式：舒适（默认）/ 紧凑 / 分组（未开始/进行中/已完成） */
import { useCallback, useEffect, useState } from 'react'
import { api, type GoalItem, type PlanItem, type CheckinItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Field, confirmDialog } from '../components/framework/Modal'
import { Drawer } from '../components/framework/Drawer'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { readLayoutTheme, GOALS_ROW_THEMES } from '../lib/componentTheme'
import { goalStyle, setGoalStyle, GOAL_STYLE_LABELS, type GoalStyle } from '../lib/layout'

const EMOJIS = ['🎯', '📚', '💪', '🏃', '💰', '🧠', '🌍', '✍️', '🎨', '🎵']

function parseIds(s: string | undefined): string[] {
  try { return JSON.parse(s || '[]') as string[] } catch { return [] }
}

interface GoalForm { name: string; emoji: string; current: string; target: string; unit: string; desc: string }

const pctOf = (g: GoalItem) => (g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0)

export function GoalsPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<GoalItem[]>([])
  const [loading, setLoading] = useState(true)
  /** 编辑抽屉：editing=null 且抽屉开 = 新建 */
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<GoalItem | null>(null)
  const [form, setForm] = useState<GoalForm>({ name: '', emoji: '🎯', current: '0', target: '', unit: '', desc: '' })
  const [saving, setSaving] = useState(false)
  /** 绑定抽屉：目标 ↔ 今日计划 / 习惯 */
  const [link, setLink] = useState<null | { goal: GoalItem; type: 'plan' | 'checkin' }>(null)
  const [linkItems, setLinkItems] = useState<Array<PlanItem | CheckinItem>>([])
  const [linkSel, setLinkSel] = useState<Set<string>>(new Set())
  const toast = useToast()
  const [ls, setLs] = useState<GoalStyle>(goalStyle)
  // 目标行主题（骨架不变 · 样式抽离）
  const [rowTheme, setRowTheme] = useState(() => readLayoutTheme('goalsRow', GOALS_ROW_THEMES, 'flat'))
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cl_theme_layout_goalsRow') setRowTheme(readLayoutTheme('goalsRow', GOALS_ROW_THEMES, 'flat'))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: GoalItem[] }>('/workbench/goals')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const openCreate = () => {
    setForm({ name: '', emoji: '🎯', current: '0', target: '', unit: '', desc: '' })
    setEditing(null); setDrawerOpen(true)
  }
  const openEdit = (g: GoalItem) => {
    setForm({ name: g.name, emoji: g.emoji || '🎯', current: String(g.current), target: String(g.target), unit: g.unit || '', desc: g.desc || '' })
    setEditing(g); setDrawerOpen(true)
  }

  const submit = async () => {
    const t = Number(form.target)
    const c = Number(form.current) || 0
    if (!form.name.trim() || !t || t <= 0) { toast('请填写目标名称和有效目标值', 'err'); return }
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), emoji: form.emoji, current: c, target: t, unit: form.unit, desc: form.desc }
      if (editing) {
        await api.put(`/workbench/goals/${editing.id}`, payload)
        toast('已保存修改')
      } else {
        await api.post('/workbench/goals', payload)
        toast('已创建目标')
        setDrawerOpen(false)
      }
      setEditing(null)
      load()
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
    finally { setSaving(false) }
  }

  const add = async (g: GoalItem, d: number) => {
    try {
      await api.put(`/workbench/goals/${g.id}`, { current: Math.max(0, g.current + d) })
      load()
    } catch (e: any) { toast(e?.message || '操作失败', 'err') }
  }

  const remove = async (g: GoalItem) => {
    if (!(await confirmDialog({ title: '删除目标', description: `确定删除目标「${g.name}」？其关联的计划与习惯关系将一并解除。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/workbench/goals/${g.id}`)
      toast('已删除'); setDrawerOpen(false); load()
    } catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }

  const openLink = async (g: GoalItem, type: 'plan' | 'checkin') => {
    setLink({ goal: g, type })
    try {
      const scope = type === 'plan' ? 'plan' : 'checkin'
      const r = await api.get<{ items: Array<PlanItem | CheckinItem> }>(`/workbench/${scope}`)
      setLinkItems(r.items ?? [])
      const key = type === 'plan' ? g.relatedPlanIds : g.relatedCheckinIds
      setLinkSel(new Set(parseIds(key)))
    } catch (e: any) { toast(e?.message || '加载失败', 'err') }
  }

  const saveLink = async () => {
    if (!link) return
    const key = link.type === 'plan' ? 'relatedPlanIds' : 'relatedCheckinIds'
    const val = JSON.stringify([...linkSel])
    try {
      await api.put(`/workbench/goals/${link.goal.id}`, { [key]: val })
      toast('关联已保存')
      setLink(null); load()
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }

  const linkLabel = (it: PlanItem | CheckinItem) => {
    if (link?.type === 'plan') return (it as PlanItem).text
    return `${(it as CheckinItem).emoji} ${(it as CheckinItem).name}`
  }

  const toggleLink = (id: string) => setLinkSel((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const goalRow = (g: GoalItem) => {
    const pct = pctOf(g)
    const planN = parseIds(g.relatedPlanIds).length
    const checkinN = parseIds(g.relatedCheckinIds).length
    return (
      <div key={g.id} className="goal-row">
        <div className="gtx" style={{ cursor: 'pointer' }} title="点击查看与编辑" onClick={() => { openEdit(g) }}>
          <div className="gtt">
            <span>{g.emoji}</span> {g.name}
            <span className="gtn">{g.current} / {g.target}{g.unit}</span>
          </div>
          <div className="gbar">
            <i style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--ok)' : 'linear-gradient(90deg, var(--accent), var(--info))' }} />
          </div>
          {(planN > 0 || checkinN > 0) && (
            <div className="glinks">
              {planN > 0 && <span className="glk"><Icon name="list" size={12} /> {planN} 计划</span>}
              {checkinN > 0 && <span className="glk"><Icon name="flame" size={12} /> {checkinN} 习惯</span>}
            </div>
          )}
        </div>
        <span className="gval">{pct}%</span>
        <button className="gplus" title="绑定今日计划" onClick={() => openLink(g, 'plan')}><Icon name="list" size={15} /></button>
        <button className="gplus" title="绑定习惯" onClick={() => openLink(g, 'checkin')}><Icon name="flame" size={15} /></button>
        <button className="gplus" title="增加进度 +1" onClick={() => add(g, 1)}><Icon name="plus" size={16} /></button>
        <button className="wdel" style={{ position: 'static', opacity: 1 }} onClick={() => remove(g)}>
          <Icon name="trash" size={16} />
        </button>
      </div>
    )
  }

  // 分组视图：未开始 / 进行中 / 已完成
  const grouped = ls === 'group' ? [
    { label: '未开始', match: (p: number) => p === 0 },
    { label: '进行中', match: (p: number) => p > 0 && p < 100 },
    { label: '已完成', match: (p: number) => p >= 100 },
  ].map(({ label, match }) => ({
    label,
    list: items.filter((g) => match(pctOf(g))),
  })).filter((s) => s.list.length > 0) : null

  return (
    <>
      <PageHeader
        title={withHeader ? '长期目标' : undefined}
        subtitle={withHeader ? `共 ${items.length} 个目标 · 目标 → 拆解 → 今日计划 / 习惯` : undefined}
        actions={
          <>
            <div className="seg" style={{ marginRight: 12 }} aria-label="目标布局切换">
              {(Object.keys(GOAL_STYLE_LABELS) as GoalStyle[]).map((s) => (
                <button key={s} type="button" className={`seg-btn ${ls === s ? 'on' : ''}`} onClick={() => { setGoalStyle(s); setLs(s) }}>
                  {GOAL_STYLE_LABELS[s]}
                </button>
              ))}
            </div>
            <button className={withHeader ? 'btn' : 'btn slim'} onClick={openCreate}>
              <Icon name="plus" size={15} /> 新建目标
            </button>
          </>
        }
      />

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>还没有长期目标，立一个吧</EmptyState>
      ) : grouped ? (
        grouped.map((sec) => (
          <div className="gl-group" key={sec.label}>
            <div className="gl-group-h">{sec.label}<em>{sec.list.length}</em></div>
            <div className="goal-list" data-goals={rowTheme} data-ls={ls}>{sec.list.map(goalRow)}</div>
          </div>
        ))
      ) : (
        <div className="goal-list" data-goals={rowTheme} data-ls={ls}>{items.map(goalRow)}</div>
      )}

      {/* 编辑抽屉：查看=编辑，进度/名称/数值/描述直接在此修改 */}
      {drawerOpen && (
        <Drawer
          width={620}
          title={editing ? `${editing.emoji} ${editing.name}` : '新建目标'}
          hint={editing ? `当前 ${editing.current} / ${editing.target}${editing.unit ? ' ' + editing.unit : ''}` : undefined}
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
          <Field label="名称"><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：读完 100 本书" autoFocus /></Field>
          <Field label="图标">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {EMOJIS.map((e) => (
                <button key={e} className={`seg-btn ${form.emoji === e ? 'on' : ''}`} style={{ fontSize: 16, padding: '6px 10px' }} onClick={() => setForm({ ...form, emoji: e })} type="button">{e}</button>
              ))}
            </div>
          </Field>
          <div className="grid g-3">
            <Field label="当前值"><input type="number" min={0} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} placeholder="0" /></Field>
            <Field label="目标值"><input type="number" min={1} value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} placeholder="100" /></Field>
            <Field label="单位（可选）"><input type="text" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="本 / 次 / 公里" /></Field>
          </div>
          <Field label="目标描述 / 拆解思路（文章编辑器 · 可留空）">
            <MarkdownEditor value={form.desc} onChange={(md) => setForm((f) => ({ ...f, desc: md }))} minHeight={220} />
          </Field>
        </Drawer>
      )}

      {/* 绑定抽屉：目标 ↔ 今日计划 / 习惯 */}
      {link && (
        <Drawer
          width={480}
          title={`${link.type === 'plan' ? '绑定今日计划' : '绑定习惯'} · ${link.goal.name}`}
          onClose={() => setLink(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setLink(null)}>取消</button>
              <div className="spacer" />
              <button className="btn" onClick={saveLink}>保存关联</button>
            </>
          }
        >
          <div className="link-list">
            {linkItems.length === 0 ? (
              <div className="dim" style={{ fontSize: 13, padding: '12px 4px' }}>
                暂无{link.type === 'plan' ? '今日计划' : '习惯'}，可先到「目标 → 今日计划/习惯打卡」创建
              </div>
            ) : (
              linkItems.map((it) => (
                <label key={it.id} className="link-item">
                  <input type="checkbox" checked={linkSel.has(it.id)} onChange={() => toggleLink(it.id)} />
                  <span>{linkLabel(it)}</span>
                </label>
              ))
            )}
          </div>
        </Drawer>
      )}
    </>
  )
}
