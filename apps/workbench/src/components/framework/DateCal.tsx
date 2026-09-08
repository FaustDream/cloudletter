/**
 * 通用月历浮层（替代原生 <input type="date"> 弹层）：
 * - 位置完全可控（本月视图浮层，视口翻转），永不出现"日期选择器浮到奇怪位置"的问题
 * - 支持 上/下月翻页、今天标记、选中高亮、min/max 禁用
 * - 纯 React + CSS，无原生 datepicker 兼容性差异
 */
import { useMemo, useState } from 'react'
import { todayYMD, ymdToDate, monthMatrix } from '../../lib/date'

const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export interface DateCalProps {
  value: string // YYYY-MM-DD（空 = 未选中）
  onChange: (ymd: string) => void
  min?: string
  max?: string
  /** 浮层顶部展示的操作槽（如快捷按钮），可为 null */
  header?: React.ReactNode | null
}

function useCalMonth(value: string): [number, number, () => void, () => void] {
  const base = ymdToDate(value || todayYMD())
  const [ym, setYm] = useState(() => [base.getFullYear(), base.getMonth()] as const)
  const prev = () => setYm(([y, m]) => (m === 0 ? [y - 1, 11] : [y, m - 1]))
  const next = () => setYm(([y, m]) => (m === 11 ? [y + 1, 0] : [y, m + 1]))
  return [ym[0], ym[1], prev, next]
}

export function DateCal({ value, onChange, min, max, header = null }: DateCalProps) {
  const [y, m, prev, next] = useCalMonth(value)
  const today = todayYMD()
  const matrix = useMemo(() => monthMatrix(y, m), [y, m])

  const disabled = (ymd: string): boolean => Boolean(min && ymd < min) || Boolean(max && ymd > max)

  return (
    <div className="calshell">
      {header}
      <div className="cal-head">
        <button type="button" className="cal-nav" aria-label="上个月" onClick={prev}>‹</button>
        <b>{y} 年 {String(m + 1).padStart(2, '0')} 月</b>
        <button type="button" className="cal-nav" aria-label="下个月" onClick={next}>›</button>
      </div>
      <div className="cal-week">
        {WEEK.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="cal-grid">
        {matrix.cells.map((c) => {
          const isSel = c.ymd === value
          const isToday = c.ymd === today
          const isOff = !c.inMonth || disabled(c.ymd)
          return (
            <button
              key={c.ymd}
              type="button"
              className={`cal-cell${isSel ? ' sel' : ''}${isToday ? ' today' : ''}${isOff ? ' off' : ''}`}
              disabled={isOff}
              onClick={() => onChange(c.ymd)}
            >
              {c.day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 浮层方向判定（相对锚点容器）：向上翻如果容器上方空间不足 */
export function flipDir(el: HTMLElement | null): 'down' | 'up' {
  if (!el) return 'down'
  const r = el.getBoundingClientRect()
  const spaceBelow = window.innerHeight - r.bottom
  return spaceBelow < 320 && r.top > 320 ? 'up' : 'down'
}