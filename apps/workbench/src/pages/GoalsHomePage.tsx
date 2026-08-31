/** 目标页：长期目标 / 今日计划 / 习惯打卡 三合一（目标 → 拆解 → 今日计划 / 习惯） */
import { useSearchParams } from 'react-router-dom'
import { GoalsPage } from './GoalsPage'
import { PlanPage } from './PlanPage'
import { CheckinPage } from './CheckinPage'
import { PageHeader } from '../components/framework/PageHeader'

type Tab = 'goal' | 'plan' | 'checkin'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'goal', label: '长期目标' },
  { key: 'plan', label: '今日计划' },
  { key: 'checkin', label: '习惯打卡' },
]

export function GoalsHomePage() {
  const [sp, setSp] = useSearchParams()
  const raw = sp.get('tab')
  const tab: Tab = raw === 'plan' ? 'plan' : raw === 'checkin' ? 'checkin' : 'goal'

  const switchTab = (t: Tab) => setSp({ tab: t }, { replace: true })

  return (
    <div className="org-page">
      <PageHeader
        title="目标"
        subtitle="长期目标 → 拆解 → 今日计划 / 习惯打卡，形成每日行动链路"
        actions={<div className="tabbar">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => switchTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>}
      />

      {tab === 'goal' && <GoalsPage withHeader={false} />}
      {tab === 'plan' && <PlanPage withHeader={false} />}
      {tab === 'checkin' && <CheckinPage withHeader={false} />}
    </div>
  )
}