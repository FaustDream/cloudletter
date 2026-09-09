/**
 * 工作台 /hub：今天（概览首屏）| 计划 | 目标 | 习惯 | 想法（原型 B 变体落地）。
 * - 四模块共用本页 Tab，Tab 状态进 URL（?tab=，可刷新/分享）；
 *   旧独立页 /plan /goals /checkin /notes /goals-home /quick-notes 全部 Redirect 到此。
 * - 「想法」Tab 收编灵感笔记与速记汇总（同一张 NoteItem 表的两种视图）。
 * - 数据层不变量：4 张表与统计聚合层（services/dashboard.ts）零改动，本页只做前端聚合。
 * - 编辑器/表单统一：各 Tab 内复用各自页面组件（withHeader=false），编辑器已是全局统一非受控协议。
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { PageHeader } from '../components/framework/PageHeader'
import { PlanPage } from './PlanPage'
import { GoalsPage } from './GoalsPage'
import { CheckinPage } from './CheckinPage'
import { NotesPage } from './NotesPage'
import { QuickNotesPage } from './QuickNotesPage'

type HubTab = 'today' | 'plan' | 'goals' | 'checkin' | 'ideas'

const TABS: Array<{ key: HubTab; label: string; emoji: string }> = [
  { key: 'today', label: '今天', emoji: '🌅' },
  { key: 'plan', label: '计划', emoji: '☑️' },
  { key: 'goals', label: '目标', emoji: '🎯' },
  { key: 'checkin', label: '习惯', emoji: '✨' },
  { key: 'ideas', label: '想法', emoji: '💡' },
]

const parseTab = (raw: string | null): HubTab =>
  raw === 'plan' || raw === 'goals' || raw === 'checkin' || raw === 'ideas' ? raw : 'today'

export function HubPage() {
  const [sp, setSp] = useSearchParams()
  const tab = parseTab(sp.get('tab'))
  const switchTab = (t: HubTab) => setSp({ tab: t }, { replace: true })

  return (
    <>
      <PageHeader
        title="工作台"
        subtitle="计划 · 目标 · 习惯 · 想法，一个入口"
        lead={
          <div className="tabbar">
            {TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => switchTab(t.key)}>
                {t.emoji} {t.label}
              </button>
            ))}
          </div>
        }
      />
      {tab === 'today' && <TodayOverview onOpen={(t) => switchTab(t)} />}
      {tab === 'plan' && <PlanPage withHeader={false} />}
      {tab === 'goals' && <GoalsPage withHeader={false} />}
      {tab === 'checkin' && <CheckinPage withHeader={false} />}
      {tab === 'ideas' && <IdeasTab />}
    </>
  )
}

/* ================= 今天（概览首屏）：四类摘要 + 快捷跳转 ================= */

interface Summary { total?: number; done?: number; todayDone?: number; maxStreak?: number; pct?: number }

function TodayOverview({ onOpen }: { onOpen: (t: HubTab) => void }) {
  const [s, setS] = useState<Record<HubTab, Summary | null>>({ today: null, plan: null, goals: null, checkin: null, ideas: null })
  useEffect(() => {
    const pick = (scope: string) =>
      api.get<Summary>(`/workbench/${scope}/summary`).then((r) => r).catch(() => null)
    void Promise.all([pick('plan'), pick('goals'), pick('checkin'), pick('notes')]).then(([plan, goals, checkin, notes]) => {
      setS({ today: null, plan, goals, checkin, ideas: notes })
    })
  }, [])

  const cards: Array<{ tab: HubTab; emoji: string; title: string; desc: string }> = [
    {
      tab: 'plan', emoji: '☑️', title: '今日计划',
      desc: s.plan ? `${s.plan.done ?? 0} / ${s.plan.total ?? 0} 已完成` : '—',
    },
    {
      tab: 'goals', emoji: '🎯', title: '目标',
      desc: s.goals ? `${s.goals.total ?? 0} 个目标${s.goals.pct != null ? ` · 平均进度 ${s.goals.pct}%` : ''}` : '—',
    },
    {
      tab: 'checkin', emoji: '✨', title: '习惯',
      desc: s.checkin ? `今日 ${s.checkin.todayDone ?? 0} / ${s.checkin.total ?? 0} 已打卡 · 最长连续 ${s.checkin.maxStreak ?? 0} 天` : '—',
    },
    {
      tab: 'ideas', emoji: '💡', title: '想法',
      desc: s.ideas ? `共 ${s.ideas.total ?? 0} 条想法与速记` : '—',
    },
  ]

  return (
    <div className="grid g-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
      {cards.map((c) => (
        <div key={c.tab} className="note" style={{ cursor: 'pointer' }} onClick={() => onOpen(c.tab)} title="进入">
          <div className="nt" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-lg)' }}>
            <span>{c.emoji}</span>
            <span style={{ fontWeight: 800 }}>{c.title}</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>进入 →</span>
          </div>
          <div className="nb" style={{ marginTop: 6 }}>{c.desc}</div>
        </div>
      ))}
    </div>
  )
}

/* ================= 想法 Tab：灵感笔记流 ↔ 速记汇总 两种视图 ================= */

function IdeasTab() {
  const [view, setView] = useState<'ideas' | 'quick'>('ideas')
  return (
    <>
      <div className="seg" style={{ marginBottom: 10 }} aria-label="想法视图切换">
        <button type="button" className={`seg-btn ${view === 'ideas' ? 'on' : ''}`} onClick={() => setView('ideas')}>想法流</button>
        <button type="button" className={`seg-btn ${view === 'quick' ? 'on' : ''}`} onClick={() => setView('quick')}>速记汇总</button>
      </div>
      {view === 'ideas' ? <NotesPage withHeader={false} /> : <QuickNotesPage withHeader={false} />}
    </>
  )
}
