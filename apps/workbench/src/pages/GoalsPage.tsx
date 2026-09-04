/** 长期目标：进度可视化 + 关联下拉（目标 → 今日计划/习惯，形成拆解链路）；点击目标行可查看并编辑详情 */
import { useCallback, useEffect, useState } from 'react'
import { api, type GoalItem, type PlanItem, type CheckinItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { Drawer } from '../components/framework/Drawer'
import { MarkdownView } from '../components/framework/MarkdownView'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { readLayoutTheme, GOALS_ROW_THEMES } from '../lib/componentTheme'

const EMOJIS = ['🎯', '📚', '💪', '🏃', '💰', '🧠', '🌍', '✍️', '🎨', '🎵']

function parseIds(s: string | undefined): string[] {
  try { return JSON.parse(s || '[]') as string[] } catch { return [] }
}

interface GoalForm { name: string; emoji: string; current: string; target: string; unit: string; desc: string }

export function GoalsPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<GoalItem[]>([])
  const [loading, setLoading] = useState(true)
  /** creating=true 新建；editing 携带被编辑的目标 */
  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<GoalItem | null>(null)
  const [form, setForm] = useState<GoalForm>({ name: '', emoji: '🎯', current: '0', target: '', unit: '', desc: '' })
  const [saving, setSaving] = useState(false)
  /** 详情侧栏（查看全文与关联） */
  const [detail, setDetail] = useState<GoalItem | null>(null)
  const [link, setLink] = useState<null | { goal: GoalItem; type: 'plan' | 'checkin' }>(null)
  const [linkItems, setLinkItems] = useState<Array<PlanItem | CheckinItem>>([])
  const [linkSel, setLinkSel] = useState<Set<string>>(new Set())
  const toast = useToast()
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
    setCreating(true); setEditing(null); setFormOpen(true)
  }
  const openEdit = (g: GoalItem) => {
    setForm({ name: g.name, emoji: g.emoji || '🎯', current: String(g.current), target: String(g.target), unit: g.unit || '', desc: g.desc || '' })
    setCreating(false); setEditing(g); setFormOpen(true)
  }

  const submit = async () => {
    const t = Number(form.target)
    const c = Number(form.current) || 0
    if (!form.name.trim() || !t || t <= 0) { toast('请填写目标名称和有效目标值', 'err'); return }
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), emoji: form.emoji, current: c, target: t, unit: form.unit, desc: form.desc }
      if (creating) {
        await api.post('/workbench/goals', payload)
        toast('已创建目标')
      } else if (editing) {
        await api.put(`/workbench/goals/${editing.id}`, payload)
        toast('已保存修改')
      }
      setFormOpen(false); setEditing(null)
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
      toast('已删除'); load()
    } catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }

  // 打开关联弹窗：拉取对应类型的可选列表
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

  return (
    <>
      <PageHeader
        title={withHeader ? '长期目标' : undefined}
        subtitle={withHeader ? `共 ${items.length} 个目标 · 目标 → 拆解 → 今日计划 / 习惯` : undefined}
        actions={<button className={withHeader ? 'btn' : 'btn slim'} onClick={openCreate}>
          <Icon name="plus" size={15} /> 新建目标
        </button>}
      />

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>还没有长期目标，立一个吧</EmptyState>
      ) : (
        <div className="goal-list" data-goals={rowTheme}>
        {items.map((g) => {
          const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0
          const planN = parseIds(g.relatedPlanIds).length
          const checkinN = parseIds(g.relatedCheckinIds).length
          return (
            <div key={g.id} className="goal-row">
              <div className="gtx" style={{ cursor: 'pointer' }} title="点击查看详情" onClick={() => { setDetail(g) }}>
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
        })
        }
        </div>
      )}

      {formOpen && (
        <Modal title={creating ? '新建目标' : '编辑目标'} size="lg" onClose={() => { setFormOpen(false); setEditing(null) }} footer={
          <>
            <button className="btn ghost" onClick={() => { setFormOpen(false); setEditing(null) }}>取消</button>
            <button className="btn" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </>
        }>
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
            <MarkdownEditor value={form.desc} onChange={(md) => setForm((f) => ({ ...f, desc: md }))} minHeight={200} />
          </Field>
        </Modal>
      )}

      {/* 详情侧栏：进度 + 描述全文 + 关联 + 编辑入口 */}
      {detail && (
        <Drawer
          width={560}
          title={<span className="qn-drawer-title"><span>{detail.emoji}</span>{detail.name}</span>}
          hint={`目标 ${detail.current} / ${detail.target}${detail.unit ? ' ' + detail.unit : ''}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn ghost danger" onClick={() => { const g = detail; setDetail(null); remove(g) }}><Icon name="trash" size={15} /> 删除</button>
              <div className="spacer" />
              <button className="btn ghost" onClick={() => { const g = detail; setDetail(null); openLink(g, 'plan') }}><Icon name="list" size={15} /> 绑定计划</button>
              <button className="btn ghost" onClick={() => { const g = detail; setDetail(null); openLink(g, 'checkin') }}><Icon name="flame" size={15} /> 绑定习惯</button>
              <button className="btn" onClick={() => { const g = detail; setDetail(null); openEdit(g) }}><Icon name="pen" size={15} /> 编辑</button>
            </>
          }
        >
          <div className="gbar" style={{ marginBottom: 14 }}>
            <i style={{ width: `${detail.target > 0 ? Math.min(100, Math.round((detail.current / detail.target) * 100)) : 0}%`, background: 'linear-gradient(90deg, var(--accent), var(--info))' }} />
          </div>
          <MarkdownView value={detail.desc} empty="（暂无描述，点下方「编辑」补充拆解思路）" />
        </Drawer>
      )}

      {/* 关联绑定弹窗：目标 ↔ 今日计划 / 习惯 */}
      {link && (
        <Modal
          title={`${link.type === 'plan' ? '绑定今日计划' : '绑定习惯'} · ${link.goal.name}`}
          onClose={() => setLink(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setLink(null)}>取消</button>
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
        </Modal>
      )}
    </>
  )
}