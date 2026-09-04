/**
 * 工作时间横幅：按 settings.schedule 判定当前处于「工作时间」还是「个人时间」。
 * 每 30s 自检一次（跨过边界自动切换）；onConfigure 提供时显示「设置」入口。
 */
import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { isWorkTime, fmtMinutes, type Schedule } from '../../lib/schedule'

export function WorkTimeBanner({ schedule, onConfigure }: {
  schedule: Schedule
  onConfigure?: () => void
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const st = isWorkTime(now, schedule)
  const days = ['日', '一', '二', '三', '四', '五', '六']
  const nextDay = schedule.workdays.length
    ? [...schedule.workdays].sort((a, b) => {
        const d = (n: number) => (n - now.getDay() + 7) % 7 || 7
        return d(a) - d(b)
      })[0]
    : null

  return (
    <div className={`wt-banner ${st.working ? 'working' : 'personal'}`}>
      <span className="wt-ico"><Icon name={st.working ? 'bolt' : 'moon'} size={16} /></span>
      <span className="wt-main">
        {st.working
          ? <>当前处于<b>工作时间</b> · 距下班约 {fmtMinutes(st.minutesUntilEdge ?? 0)}</>
          : st.workday
            ? <>当前处于<b>个人时间</b>{st.minutesUntilEdge != null ? ` · 距上班约 ${fmtMinutes(st.minutesUntilEdge)}` : ' · 今天的工作时段已结束'}</>
            : <>今天（周{days[now.getDay()]}）不是工作日{nextDay != null ? ` · 下个工作日：周${days[nextDay]}` : ''}</>}
      </span>
      <span className="wt-range">{schedule.workStart} ~ {schedule.workEnd} · 周{schedule.workdays.map((d) => days[d]).join('/')}</span>
      {onConfigure && (
        <button className="btn slim ghost" onClick={onConfigure}><Icon name="setting" size={14} /> 工作时间设置</button>
      )}
    </div>
  )
}
