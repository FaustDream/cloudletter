/** 长期目标：进度可视化 + 关联下拉（目标 → 今日计划/习惯，形成拆解链路） */
import { useCallback, useEffect, useState } from 'react'
import { api, type GoalItem, type PlanItem, type CheckinItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { readLayoutTheme, GOALS_ROW_THEMES } from '../lib/componentTheme'

const EMOJIS = ['🎯', '📚', '💪', '🏃', '💰', '🧠', '🌍', '✍️', '🎨', '🎵']

function parseIds(s: string | undefined): string[] {
  try { return JSON.parse(s || '[]') as string[] } catch { return [] }
}

export function GoalsPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<GoalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🎯')
  const [current, setCurrent] = useState('0')
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
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

  const submit = async () => {
    const t = Number(target)
    const c = Number(current) || 0
    if (!name.trim() || !t || t <= 0) { toast('请填写目标名称和有效目标值', 'err'); return }
    try {
      await api.post('/workbench/goals', { name: name.trim(), emoji, current: c, target: t, unit })
      toast('已创建目标')
      setName(''); setCurrent('0'); setTarget(''); setUnit(''); setEmoji('🎯')
      setCreating(false); load()
    } catch (e: any) { toast(e?.message || '创建失败', 'err') }
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
        actions={<button className={withHeader ? 'btn' : 'btn slim'} onClick={() => setCreating(true)}>
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
              <div className="gtx">
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

      {creating && (
        <Modal title="新建目标" onClose={() => setCreating(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setCreating(false)}>取消</button>
            <button className="btn" onClick={submit}>保存</button>
          </>
        }>
          <Field label="名称"><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：读完 100 本书" maxLength={60} autoFocus /></Field>
          <Field label="图标">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {EMOJIS.map((e) => (
                <button key={e} className={`seg-btn ${emoji === e ? 'on' : ''}`} style={{ fontSize: 16, padding: '6px 10px' }} onClick={() => setEmoji(e)} type="button">{e}</button>
              ))}
            </div>
          </Field>
          <div className="grid g-2">
            <Field label="当前值"><input type="number" min={0} value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="0" /></Field>
            <Field label="目标值"><input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100" /></Field>
          </div>
          <Field label="单位（可选）"><input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="本 / 次 / 公里" maxLength={10} /></Field>
        </Modal>
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