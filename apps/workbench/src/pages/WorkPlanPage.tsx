import { errMsg } from '../lib/errors'
/**
 * 工作计划（日常子模块 · 核心功能）：服务周一至周五的工作安排。
 * - 周视图：周一~周日 7 列（工作日高亮），每列该日任务与完成度；周导航 + 回到本周
 * - 任务：新建（日期/内容/详情）/ 查看（详情侧栏全文）/ 编辑 / 完成（庆祝 + 完成时间）/ 删除
 * - 工作时间设置：开始/结束时间 + 工作日多选，存服务端 schedule 分组；
 *   顶部横幅按当前时间自动判定「工作时间 / 个人时间」
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type WorkTask } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { Drawer } from '../components/framework/Drawer'
import { MarkdownView } from '../components/framework/MarkdownView'
import { MarkdownEditor } from '../components/editor/MarkdownEditor'
import { WorkTimeBanner } from '../components/framework/WorkTimeBanner'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { todayYMD, addDays, dateToYMD } from '../lib/date'
import { fetchSchedule, normalizeSchedule, type Schedule } from '../lib/schedule'
import { celebrate, praise } from '../lib/celebrate'

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 本周周一（本地时区） */
function mondayOf(d: Date): Date {
  const diff = (d.getDay() + 6) % 7
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff)
  return m
}

interface TaskForm { date: string; text: string; note: string }

export function WorkPlanPage() {
  const [tasks, setTasks] = useState<WorkTask[]>([])
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState<Schedule>(() => normalizeSchedule(undefined))
  /** 周视图锚点（该周的周一，YMD 字符串） */
  const [weekAnchor, setWeekAnchor] = useState(() => todayYMD(mondayOf(new Date())))
  const [workdaysOnly, setWorkdaysOnly] = useState(false)
  /** creating=true 新建；editing 携带被编辑任务；detail 查看详情 */
  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<WorkTask | null>(null)
  const [detail, setDetail] = useState<WorkTask | null>(null)
  const [form, setForm] = useState<TaskForm>({ date: todayYMD(), text: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [cfgOpen, setCfgOpen] = useState(false)
  const [cfg, setCfg] = useState<Schedule>(() => normalizeSchedule(undefined))
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get<{ items: WorkTask[] }>('/workbench/worktask'),
      fetchSchedule(),
    ])
      .then(([r, s]) => { setTasks(r.items); setSchedule(s) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekAnchor, i)
      return { date: d, label: WEEK_LABELS[new Date(d + 'T00:00:00').getDay()] }
    })
  }, [weekAnchor])

  const shownDays = useMemo(
    () => (workdaysOnly ? weekDays.filter((d) => schedule.workdays.includes(new Date(d.date + 'T00:00:00').getDay())) : weekDays),
    [weekDays, workdaysOnly, schedule.workdays],
  )

  const weekTasks = useMemo(() => {
    const w0 = weekDays[0].date
    const w1 = weekDays[6].date
    return tasks.filter((t) => t.date >= w0 && t.date <= w1)
  }, [tasks, weekDays])
  const weekDone = weekTasks.filter((t) => t.done).length

  const tasksOf = (date: string) =>
    tasks
      .filter((t) => t.date === date)
      .sort((a, b) => (a.done === b.done ? a.order - b.order || a.createdAt.localeCompare(b.createdAt) : a.done ? 1 : -1))

  const openCreate = (date?: string) => {
    setForm({ date: date || todayYMD(), text: '', note: '' })
    setCreating(true); setEditing(null); setFormOpen(true)
  }
  const openEdit = (t: WorkTask) => {
    setForm({ date: t.date, text: t.text, note: t.note || '' })
    setCreating(false); setEditing(t); setFormOpen(true)
  }

  const submit = async () => {
    if (!form.text.trim()) { toast('写一下要做什么', 'err'); return }
    setSaving(true)
    try {
      if (creating) {
        await api.post('/workbench/worktask', { date: form.date, text: form.text.trim(), note: form.note })
        toast('已加入工作计划')
      } else if (editing) {
        await api.put(`/workbench/worktask/${editing.id}`, { date: form.date, text: form.text.trim(), note: form.note })
        toast('已保存修改')
        if (detail?.id === editing.id) setDetail({ ...editing, date: form.date, text: form.text.trim(), note: form.note })
      }
      setFormOpen(false); setEditing(null)
      load()
    } catch (e: unknown) { toast(errMsg(e, '保存失败'), 'err') }
    finally { setSaving(false) }
  }

  const toggle = async (t: WorkTask) => {
    try {
      const now = !t.done
      await api.put(`/workbench/worktask/${t.id}`, { done: now, doneAt: now ? new Date().toISOString() : '' })
      if (now) {
        celebrate(window.innerWidth / 2, window.innerHeight / 2, 26)
        toast(`✅ 完成工作计划「${t.text}」· ${praise()}`)
      }
      load()
    } catch (e: unknown) { toast(errMsg(e, '操作失败'), 'err') }
  }

  const remove = async (t: WorkTask) => {
    if (!(await confirmDialog({ title: '删除任务', description: `确定删除「${t.text}」？`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/workbench/worktask/${t.id}`)
      toast('已删除')
      setDetail(null)
      load()
    } catch (e: unknown) { toast(errMsg(e, '删除失败'), 'err') }
  }

  /* ── 工作时间设置 ── */
  const openCfg = () => { setCfg(schedule); setCfgOpen(true) }
  const saveCfg = async () => {
    try {
      await api.put('/settings', { schedule: { workStart: cfg.workStart, workEnd: cfg.workEnd, workdays: cfg.workdays } })
      setSchedule({ ...cfg })
      setCfgOpen(false)
      toast('工作时间已保存')
    } catch (e: unknown) { toast(errMsg(e, '保存失败'), 'err') }
  }
  const toggleWorkday = (d: number) => setCfg((c) => ({
    ...c,
    workdays: c.workdays.includes(d) ? c.workdays.filter((x) => x !== d) : [...c.workdays, d].sort((a, b) => a - b),
  }))

  const today = todayYMD()

  return (
    <div className="wp-page">
      <PageHeader
        title="工作计划"
        subtitle={`本周 ${weekDone} / ${weekTasks.length} 项完成 · 专注周一至周五的工作安排`}
        actions={
          <>
            <button className="btn slim" onClick={() => setWorkdaysOnly((v) => !v)} title="仅显示设定的工作日">
              <Icon name="columns" size={15} /> {workdaysOnly ? '显示全周' : '仅工作日'}
            </button>
            <button className="btn" onClick={() => openCreate()}><Icon name="plus" size={15} /> 新建任务</button>
          </>
        }
      />

      <WorkTimeBanner schedule={schedule} onConfigure={openCfg} />

      {/* 周导航 */}
      <div className="wp-weeknav">
        <button className="btn slim ghost" onClick={() => setWeekAnchor(addDays(weekAnchor, -7))}>‹ 上一周</button>
        <b>{weekAnchor.slice(0, 10).replace(/-/g, '.')} 那一周</b>
        <button className="btn slim ghost" onClick={() => setWeekAnchor(dateToYMD(mondayOf(new Date())))}>本周</button>
        <button className="btn slim ghost" onClick={() => setWeekAnchor(addDays(weekAnchor, 7))}>下一周 ›</button>
      </div>

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : (
        <div className="wp-grid">
          {shownDays.map((d) => {
            const list = tasksOf(d.date)
            const isToday = d.date === today
            const isWorkday = schedule.workdays.includes(new Date(d.date + 'T00:00:00').getDay())
            const doneN = list.filter((t) => t.done).length
            return (
              <div key={d.date} className={`wp-col card${isToday ? ' today' : ''}`}>
                <div className="wp-col-head">
                  <b>{d.label}</b>
                  <span className="wp-col-date">{d.date.slice(5).replace('-', '/')}</span>
                  {isToday && <span className="wp-today-tag">今天</span>}
                  {!isWorkday && <span className="wp-rest-tag">休</span>}
                  <span className="spacer" />
                  <button className="wp-add" title="这天加任务" onClick={() => openCreate(d.date)}><Icon name="plus" size={14} /></button>
                </div>
                {list.length === 0 ? (
                  <div className="wp-empty">暂无安排</div>
                ) : (
                  <div className="wp-tasks">
                    {list.map((t) => (
                      <div key={t.id} className={`wp-task ${t.done ? 'done' : ''}`} onClick={() => setDetail(t)} title="点击查看详情">
                        <div className={`wchk ${t.done ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(t) }}>
                          <Icon name="check" size={14} />
                        </div>
                        <span className="wp-task-tx">{t.text}</span>
                        {t.note && <span className="wp-note-ico"><Icon name="log" size={12} /></span>}
                      </div>
                    ))}
                  </div>
                )}
                {list.length > 0 && (
                  <div className="wp-col-foot">{doneN} / {list.length} 完成</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 任务详情侧栏 */}
      {detail && (
        <Drawer
          width={560}
          title={<span className="qn-drawer-title">{detail.done ? '✅ ' : '📋 '}{detail.text}</span>}
          hint={`${detail.date} · ${WEEK_LABELS[new Date(detail.date + 'T00:00:00').getDay()]}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn ghost danger" onClick={() => { const t = detail; setDetail(null); remove(t) }}><Icon name="trash" size={15} /> 删除</button>
              <div className="spacer" />
              <button className={`btn ghost${detail.done ? ' ok' : ''}`} onClick={() => toggle(detail)}><Icon name="check" size={15} /> {detail.done ? '取消完成' : '标记完成'}</button>
              <button className="btn" onClick={() => { const t = detail; setDetail(null); openEdit(t) }}><Icon name="pen" size={15} /> 编辑</button>
            </>
          }
        >
          {detail.done
            ? <div className="wst done" style={{ marginBottom: 12 }}>完成于 {(detail.doneAt || '').slice(0, 16).replace('T', ' ')}</div>
            : null}
          <MarkdownView value={detail.note} empty="（这条任务没有详情备注，点「编辑」补充工作内容）" />
        </Drawer>
      )}

      {/* 新建/编辑任务弹窗 */}
      {formOpen && (
        <Modal title={creating ? '新建工作计划任务' : '编辑任务'} size="lg" onClose={() => { setFormOpen(false); setEditing(null) }} footer={
          <>
            <button className="btn ghost" onClick={() => { setFormOpen(false); setEditing(null) }}>取消</button>
            <button className="btn" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
          </>
        }>
          <div className="grid g-2">
            <Field label="哪一天">
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="任务内容">
              <input type="text" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="要完成什么工作？" autoFocus />
            </Field>
          </div>
          <Field label="具体工作内容 / 备注（文章编辑器 · 可留空）" as="div">
            <MarkdownEditor value={form.note} onChange={(md) => setForm((f) => ({ ...f, note: md }))} minHeight={120} uncontrolled />
          </Field>
        </Modal>
      )}

      {/* 工作时间设置弹窗 */}
      {cfgOpen && (
        <Modal title="工作时间设置" onClose={() => setCfgOpen(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setCfgOpen(false)}>取消</button>
            <button className="btn" onClick={saveCfg}>保存</button>
          </>
        }>
          <div className="grid g-2">
            <Field label="上班时间">
              <input type="time" value={cfg.workStart} onChange={(e) => setCfg({ ...cfg, workStart: e.target.value || '09:00' })} />
            </Field>
            <Field label="下班时间">
              <input type="time" value={cfg.workEnd} onChange={(e) => setCfg({ ...cfg, workEnd: e.target.value || '18:00' })} />
            </Field>
          </div>
          <Field label="工作日（其余为个人时间）">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button key={d} type="button" className={`seg-btn ${cfg.workdays.includes(d) ? 'on' : ''}`} onClick={() => toggleWorkday(d)}>
                  周{WEEK_LABELS[d].slice(1)}
                </button>
              ))}
            </div>
          </Field>
          <p className="dim" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
            系统按此配置自动判定当前处于「工作时间」或「个人时间」，并在日常页与工作计划页优先展示对应内容。
          </p>
        </Modal>
      )}
    </div>
  )
}
