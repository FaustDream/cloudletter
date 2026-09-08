/** 记账本：多视图（列表/卡片/多列）+ 多维筛选（类型/分类/月份/关键词）+ 预算 + 趋势 + 编辑/删除/详情 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type LedgerEntry } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { todayYMD } from '../lib/date'
import { Dropdown } from '../components/framework/Dropdown'

const CATS = ['餐饮', '交通', '购物', '居住', '娱乐', '学习', '健康', '工作', '理财', '其他']
const BUDGET_KEY = 'cl_budget'
type ViewMode = 'list' | 'card' | 'calendar' | 'columns'
type KindFilter = '' | 'income' | 'expense'

function useMonthlyTrend(items: LedgerEntry[]) {
  const months: string[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const rows = months.map((m) => {
    let income = 0, expense = 0
    for (const it of items) {
      if (String(it.date).slice(0, 7) !== m) continue
      if (it.kind === 'income') income += it.amount
      else expense += it.amount
    }
    return { m, income, expense, net: income - expense }
  })
  const max = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.income), Math.abs(r.expense))))
  return { rows, max }
}

const emptyForm = { kind: 'expense' as 'income' | 'expense', cat: '餐饮', amount: '', note: '', date: todayYMD() }

export function LedgerPage() {
  const [items, setItems] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<LedgerEntry | null>(null)
  const [detail, setDetail] = useState<LedgerEntry | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem('cl_ledger_view') as ViewMode) || 'list')
  const [kindFilter, setKindFilter] = useState<KindFilter>('')
  const [catFilter, setCatFilter] = useState('')
  const [monthFilter, setMonthFilter] = useState('')
  const [kw, setKw] = useState('')
  const [budget, setBudget] = useState<number>(() => {
    try { return Number(localStorage.getItem(BUDGET_KEY)) || 5000 } catch { return 5000 }
  })
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: LedgerEntry[] }>('/workbench/ledger')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const month = todayYMD().slice(0, 7)
  const { income, expense } = useMemo(() => {
    let i = 0, e = 0
    for (const it of items) {
      if (String(it.date).slice(0, 7) !== month) continue
      if (it.kind === 'income') i += it.amount
      else e += it.amount
    }
    return { income: i, expense: e }
  }, [items, month])

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [items],
  )
  const trend = useMonthlyTrend(items)

  const viewed = useMemo(() => {
    let list = sorted
    if (kindFilter) list = list.filter((it) => it.kind === kindFilter)
    if (catFilter) list = list.filter((it) => it.cat === catFilter)
    if (monthFilter) list = list.filter((it) => String(it.date).slice(0, 7) === monthFilter)
    const k = kw.trim().toLowerCase()
    if (k) list = list.filter((it) => `${it.cat}${it.note}`.toLowerCase().includes(k))
    return list
  }, [sorted, kindFilter, catFilter, monthFilter, kw])

  /** 多列视图：按月分列（近 3 个有数据的月份，最新在左） */
  const columns = useMemo(() => {
    const byMonth = new Map<string, LedgerEntry[]>()
    for (const it of viewed) {
      const m = String(it.date).slice(0, 7)
      if (!byMonth.has(m)) byMonth.set(m, [])
      byMonth.get(m)!.push(it)
    }
    return [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 3)
  }, [viewed])

  const budgetPct = budget > 0 ? Math.min(100, Math.round((expense / budget) * 100)) : 0
  const overBudget = expense > budget
  const viewedIncome = viewed.filter((i) => i.kind === 'income').reduce((a, b) => a + b.amount, 0)
  const viewedExpense = viewed.filter((i) => i.kind === 'expense').reduce((a, b) => a + b.amount, 0)

  const openCreate = () => {
    setForm(emptyForm)
    setEditing(null)
    setCreating(true)
  }
  const openEdit = (it: LedgerEntry) => {
    setForm({ kind: it.kind, cat: it.cat, amount: String(it.amount), note: it.note, date: String(it.date).slice(0, 10) })
    setEditing(it)
    setCreating(true)
  }

  const submit = async () => {
    const amt = Number(form.amount)
    if (!amt || amt <= 0) { toast('请输入有效的金额', 'err'); return }
    try {
      if (editing) {
        await api.put(`/workbench/ledger/${editing.id}`, { ...form, amount: amt })
        toast('已更新')
      } else {
        await api.post('/workbench/ledger', { ...form, amount: amt })
        toast('已记账')
      }
      setCreating(false); setEditing(null); load()
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }

  const remove = async (it: LedgerEntry) => {
    if (!(await confirmDialog({ title: '删除记账', description: `确定删除「${it.cat}${it.note ? ' · ' + it.note : ''}」这一笔？不可恢复。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/workbench/ledger/${it.id}`)
      toast('已删除')
      setDetail(null)
      load()
    } catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }

  const saveBudget = (v: string) => {
    const n = Number(v)
    if (n > 0) { setBudget(n); localStorage.setItem(BUDGET_KEY, String(n)) }
  }

  const entryRow = (it: LedgerEntry) => (
    <div key={it.id} className="lg-row" onClick={() => setDetail(it)} title="点击查看详情">
      <div className="lg-ic" style={{ background: it.kind === 'income' ? 'color-mix(in srgb, var(--ok) 16%, transparent)' : 'color-mix(in srgb, var(--danger) 16%, transparent)', color: it.kind === 'income' ? 'var(--ok)' : 'var(--danger)' }}>
        <Icon name={it.kind === 'income' ? 'leaf' : 'card'} size={17} />
      </div>
      <div className="lg-tx">
        <div className="ln">{it.cat}{it.note ? ` · ${it.note}` : ''}</div>
        <div className="ls">{it.date}</div>
      </div>
      <div className={`lg-am ${it.kind}`}>
        {it.kind === 'income' ? '+' : '-'}¥{it.amount.toFixed(2)}
      </div>
      <button className="lg-del" title="编辑" onClick={(e) => { e.stopPropagation(); openEdit(it) }}>
        <Icon name="pen" size={15} />
      </button>
      <button className="lg-del" title="删除" onClick={(e) => { e.stopPropagation(); remove(it) }}>
        <Icon name="trash" size={16} />
      </button>
    </div>
  )

  const entryCard = (it: LedgerEntry) => (
    <div key={it.id} className="lg-card" onClick={() => setDetail(it)}>
      <div className="lgc-head">
        <span className={`pill ${it.kind === 'income' ? 'ok' : 'warn'}`}>{it.kind === 'income' ? '收入' : '支出'}</span>
        <span className="dim">{it.date}</span>
      </div>
      <div className={`lg-am ${it.kind}`}>{it.kind === 'income' ? '+' : '-'}¥{it.amount.toFixed(2)}</div>
      <div className="lgc-cat">{it.cat}</div>
      {it.note && <div className="lgc-note">{it.note}</div>}
      <div className="lgc-ops" onClick={(e) => e.stopPropagation()}>
        <button className="qop" title="编辑" onClick={() => openEdit(it)}><Icon name="pen" size={14} /></button>
        <button className="qop danger" title="删除" onClick={() => remove(it)}><Icon name="trash" size={14} /></button>
      </div>
    </div>
  )

  return (
    <>
      <PageHeader
        title="记账本"
        subtitle={`${month} · 收入 ¥${income.toFixed(2)} / 支出 ¥${expense.toFixed(2)}`}
        actions={<button className="btn" onClick={openCreate}><Icon name="plus" size={16} /> 记一笔</button>}
      />

      {/* 预算进度条 */}
      <div className={`budget-bar ${overBudget ? 'over' : ''}`}>
        <div className="bb-head">
          <span><Icon name="card" size={14} /> 本月预算</span>
          <span className="bb-nums">已花 ¥{expense.toFixed(0)} / ¥{budget.toFixed(0)} · 剩余 <b>¥{Math.max(0, budget - expense).toFixed(0)}</b></span>
        </div>
        <div className="bb-track"><i style={{ width: `${budgetPct}%` }} /></div>
        <div className="bb-foot">
          {overBudget ? <span className="dim" style={{ color: 'var(--danger)' }}>本月已超预算</span> : <span className="dim">预算剩余 {100 - budgetPct}%</span>}
          <label className="bb-edit dim">预算
            <input type="number" defaultValue={budget} min={0} onBlur={(e) => saveBudget(e.target.value)} style={{ width: 90, minHeight: 28, fontSize: 'var(--fs-sm)' }} />
          </label>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card">
          <div className="sk"><Icon name="wallet" size={15} /> 本月支出</div>
          <div className="sv" style={{ color: 'var(--danger)' }}>¥{expense.toFixed(2)}</div>
          <div className="sd">支出 / {items.filter((i) => i.kind === 'expense').length} 笔</div>
        </div>
        <div className="stat-card">
          <div className="sk"><Icon name="leaf" size={15} /> 本月收入</div>
          <div className="sv" style={{ color: 'var(--ok)' }}>¥{income.toFixed(2)}</div>
          <div className="sd">收入 / {items.filter((i) => i.kind === 'income').length} 笔</div>
        </div>
        <div className="stat-card">
          <div className="sk"><Icon name="card" size={15} /> 结余</div>
          <div className="sv" style={{ color: income - expense >= 0 ? 'var(--ok)' : 'var(--text)' }}>¥{(income - expense).toFixed(2)}</div>
          <div className="sd">本月收支差额</div>
        </div>
        <div className="stat-card">
          <div className="sk"><Icon name="list" size={15} /> 累计流水</div>
          <div className="sv">{items.length}</div>
          <div className="sd">全部笔数 · 当前筛选 {viewed.length} 笔</div>
        </div>
      </div>

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : (
        <>
          {items.length > 0 && (
            <div className="card" style={{ padding: '16px 18px', marginBottom: 14 }}>
              <div className="sec-title">近 6 个月收支趋势
                {monthFilter && <span className="dim" style={{ fontSize: 'var(--fs-sm)', marginLeft: 10 }}>
                  已筛选 {monthFilter}（点击柱状或筛选可切换）
                </span>}
              </div>
              <div className="bar-chart">
                {trend.rows.map((r) => {
                  const active = monthFilter === r.m
                  return (
                    <div key={r.m} className={`bar-col ${active ? 'on' : ''}`} onClick={() => setMonthFilter(active ? '' : r.m)} title={`${r.m}：支出 ${r.expense.toFixed(0)} · 收入 ${r.income.toFixed(0)}`}>
                      <span className="bval" style={{ color: 'var(--danger)' }}>{r.expense > 0 ? r.expense.toFixed(0) : ''}</span>
                      <div className="b" style={{ height: `${(Math.abs(r.expense) / trend.max) * 100}%`, background: 'var(--danger)', opacity: r.expense ? .85 : .15 }} />
                      <div className="b" style={{ height: `${(Math.abs(r.income) / trend.max) * 100}%`, background: 'var(--ok)', opacity: r.income ? .85 : .15, marginTop: 2 }} />
                      <span className="bval" style={{ color: 'var(--ok)' }}>{r.income > 0 ? r.income.toFixed(0) : ''}</span>
                      <div className="bl">{r.m.slice(5)}</div>
                    </div>
                  )
                })}
              </div>
              <div className="legend">
                <span><i style={{ background: 'var(--danger)' }} />支出</span>
                <span><i style={{ background: 'var(--ok)' }} />收入</span>
                <span className="dim" style={{ marginLeft: 'auto' }}>点击月份柱查看该月明细</span>
              </div>
            </div>
          )}

          {/* 多维筛选：类型 + 关键词 + 分类 */}
          <div className="fbar" style={{ marginBottom: 10 }}>
            <div className="seg" style={{ display: 'flex', gap: 6 }}>
              <button className={`seg-btn ${kindFilter === '' ? 'on' : ''}`} onClick={() => setKindFilter('')}>全部</button>
              <button className={`seg-btn ${kindFilter === 'expense' ? 'on' : ''}`} onClick={() => setKindFilter('expense')}>支出</button>
              <button className={`seg-btn ${kindFilter === 'income' ? 'on' : ''}`} onClick={() => setKindFilter('income')}>收入</button>
            </div>
            <div className="search-box grow">
              <Icon name="search" size={15} />
              <input type="search" placeholder="搜索分类 / 备注…" value={kw} onChange={(e) => setKw(e.target.value)} />
            </div>
            {(kindFilter || catFilter || monthFilter || kw) && (
              <button className="btn slim ghost" onClick={() => { setKindFilter(''); setCatFilter(''); setMonthFilter(''); setKw('') }}>清空筛选</button>
            )}
            {/* 视图切换：紧贴数据区，随视图即时切换 */}
            <div className="spacer" />
            <div className="view-toggle">
              <button className={view === 'list' ? 'on' : ''} title="列表视图" onClick={() => { setView('list'); localStorage.setItem('cl_ledger_view', 'list') }}><Icon name="list" size={15} /></button>
              <button className={view === 'card' ? 'on' : ''} title="卡片视图" onClick={() => { setView('card'); localStorage.setItem('cl_ledger_view', 'card') }}><Icon name="grid" size={15} /></button>
              <button className={view === 'calendar' ? 'on' : ''} title="日历视图" onClick={() => { setView('calendar'); localStorage.setItem('cl_ledger_view', 'calendar') }}><Icon name="target" size={15} /></button>
              <button className={view === 'columns' ? 'on' : ''} title="多列视图（按月）" onClick={() => { setView('columns'); localStorage.setItem('cl_ledger_view', 'columns') }}><Icon name="columns" size={15} /></button>
            </div>
          </div>
          <div className="cfilter">
            <button className={`chip ${!catFilter ? 'on' : ''}`} onClick={() => setCatFilter('')}>全部分类</button>
            {CATS.map((c) => (
              <button key={c} className={`chip ${catFilter === c ? 'on' : ''}`} onClick={() => setCatFilter(catFilter === c ? '' : c)}>{c}</button>
            ))}
          </div>

          {/* 筛选汇总条 */}
          {viewed.length > 0 && (
            <div className="dim" style={{ fontSize: 12.5, margin: '6px 2px 10px' }}>
              当前筛选 {viewed.length} 笔 · 收入 <b style={{ color: 'var(--ok)' }}>¥{viewedIncome.toFixed(2)}</b> · 支出 <b style={{ color: 'var(--danger)' }}>¥{viewedExpense.toFixed(2)}</b> · 净额 <b>¥{(viewedIncome - viewedExpense).toFixed(2)}</b>
            </div>
          )}

          {viewed.length === 0 ? (
            <EmptyState>没有符合条件的流水 · 调整筛选或记一笔</EmptyState>
          ) : view === 'list' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {viewed.map(entryRow)}
            </div>
          ) : view === 'card' ? (
            <div className="post-grid">
              {viewed.map(entryCard)}
            </div>
          ) : view === 'calendar' ? (
            <LedgerCalendar
              items={viewed}
              month={monthFilter || todayYMD().slice(0, 7)}
              onMonthChange={setMonthFilter}
              onSelectDay={(d) => setMonthFilter(d.slice(0, 7))}
            />
          ) : (
            <div className="lg-columns">
              {columns.map(([m, list]) => (
                <div key={m} className="lg-col">
                  <div className="lg-col-head">
                    <b>{m}</b>
                    <span className="dim">{list.length} 笔</span>
                  </div>
                  {list.map(entryRow)}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* 新建 / 编辑 */}
      {creating && (
        <Modal title={editing ? '编辑这一笔' : '记一笔'} onClose={() => { setCreating(false); setEditing(null) }} footer={
          <>
            <button className="btn ghost" onClick={() => { setCreating(false); setEditing(null) }}>取消</button>
            <button className="btn" onClick={submit}>保存</button>
          </>
        }>
          <div className="seg" style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <button className={`seg-btn ${form.kind === 'expense' ? 'on' : ''}`} onClick={() => setForm({ ...form, kind: 'expense' })}>支出</button>
            <button className={`seg-btn ${form.kind === 'income' ? 'on' : ''}`} onClick={() => setForm({ ...form, kind: 'income' })}>收入</button>
          </div>
          <Field label="金额"><input type="number" min={0} step={0.01} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" autoFocus /></Field>
          <Field label="分类">
            <Dropdown
              value={form.cat}
              align="left"
              options={CATS.map((c) => ({ value: c, label: c }))}
              onChange={(c) => setForm({ ...form, cat: c })}
            />
          </Field>
          <Field label="日期"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="备注（可选）"><input type="text" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="用途说明" maxLength={100} /></Field>
        </Modal>
      )}

      {/* 详情 */}
      {detail && (
        <Modal title="账目详情" onClose={() => setDetail(null)} footer={
          <>
            <button className="btn ghost danger-ghost" onClick={() => remove(detail)}>删除</button>
            <button className="btn" onClick={() => { openEdit(detail); setDetail(null) }}>编辑</button>
          </>
        }>
          <div style={{ textAlign: 'center', margin: '4px 0 14px' }}>
            <div className={`lg-am ${detail.kind}`} style={{ fontSize: 30, display: 'inline-block' }}>
              {detail.kind === 'income' ? '+' : '-'}¥{detail.amount.toFixed(2)}
            </div>
          </div>
          <div className="ro-list">
            <div className="ro-row"><span className="ro-k">类型</span><span className={`pill ${detail.kind === 'income' ? 'ok' : 'warn'}`}>{detail.kind === 'income' ? '收入' : '支出'}</span></div>
            <div className="ro-row"><span className="ro-k">分类</span><span className="ro-v">{detail.cat}</span></div>
            <div className="ro-row"><span className="ro-k">日期</span><span className="ro-v">{detail.date}</span></div>
            <div className="ro-row"><span className="ro-k">备注</span><span className="ro-v">{detail.note || <span className="dim">—</span>}</span></div>
            <div className="ro-row"><span className="ro-k">记录时间</span><span className="ro-v dim">{(detail.createdAt || '').slice(0, 16).replace('T', ' ')}</span></div>
          </div>
        </Modal>
      )}
    </>
  )
}


/* ================= 日历视图（市面记账应用的标准形态） ================= */

function LedgerCalendar({ items, month, onMonthChange, onSelectDay }: {
  items: LedgerEntry[]
  month: string
  onMonthChange: (m: string) => void
  onSelectDay: (d: string) => void
}) {
  const [year, setYear] = useState(Number(month.slice(0, 4)))
  const [mon, setMon] = useState(Number(month.slice(5, 7)) - 1)
  useEffect(() => { setYear(Number(month.slice(0, 4))); setMon(Number(month.slice(5, 7)) - 1) }, [month])

  // 按天聚合
  const byDay = useMemo(() => {
    const map = new Map<string, { income: number; expense: number; count: number }>()
    for (const it of items) {
      const d = String(it.date).slice(0, 10)
      const cur = map.get(d) ?? { income: 0, expense: 0, count: 0 }
      if (it.kind === 'income') cur.income += it.amount
      else cur.expense += it.amount
      cur.count++
      map.set(d, cur)
    }
    return map
  }, [items])

  // 周一开头的月历格子
  const first = new Date(year, mon, 1)
  const lead = (first.getDay() + 6) % 7
  const daysIn = new Date(year, mon + 1, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= daysIn; d++) cells.push(`${year}-${String(mon + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

  const shift = (delta: number) => {
    const nm = new Date(year, mon + delta, 1)
    onMonthChange(`${nm.getFullYear()}-${String(nm.getMonth() + 1).padStart(2, '0')}`)
  }

  const mTotal = items.filter((i) => String(i.date).slice(0, 7) === `${year}-${String(mon + 1).padStart(2, '0')}`)
  const mIn = mTotal.filter((i) => i.kind === 'income').reduce((a, b) => a + b.amount, 0)
  const mEx = mTotal.filter((i) => i.kind === 'expense').reduce((a, b) => a + b.amount, 0)

  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <div className="lg-cal-head">
        <button className="btn slim ghost" onClick={() => shift(-1)}>‹ 上月</button>
        <b>{year} 年 {mon + 1} 月</b>
        <button className="btn slim ghost" onClick={() => shift(1)}>下月 ›</button>
        <span className="dim" style={{ marginLeft: 'auto' }}>
          本月收入 <b style={{ color: 'var(--ok)' }}>¥{mIn.toFixed(0)}</b> · 支出 <b style={{ color: 'var(--danger)' }}>¥{mEx.toFixed(0)}</b> · {mTotal.length} 笔 · 点击日期查看明细
        </span>
      </div>
      <div className="lg-cal-grid">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => <div key={w} className="lg-cal-w">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} className="lg-cal-cell empty" />
          const agg = byDay.get(d)
          return (
            <button key={d} className={`lg-cal-cell${agg ? ' has' : ''}`} onClick={() => onSelectDay(d)} title={agg ? `支出 ¥${agg.expense.toFixed(0)} · 收入 ¥${agg.income.toFixed(0)}` : '无流水'}>
              <span className="d">{Number(d.slice(8))}</span>
              {agg && (
                <span className="nums">
                  {agg.income > 0 && <em style={{ color: 'var(--ok)' }}>+{agg.income.toFixed(0)}</em>}
                  {agg.expense > 0 && <em style={{ color: 'var(--danger)' }}>-{agg.expense.toFixed(0)}</em>}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
