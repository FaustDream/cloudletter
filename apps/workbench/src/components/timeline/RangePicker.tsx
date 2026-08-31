/**
 * 时间范围选择器（Overview 双视图共用）：快捷档位 + 自定义起止日期，替代原「仅快捷天数」下拉。
 * - 模式：quick（近 7/30/60/365 天）| custom（起止日期，搭配月历浮层选择）
 * - 浮层方位自动翻转（贴近视口边缘时向上展开），彻底规避原生日期弹层的位置怪癖
 */
import { useEffect, useRef, useState } from 'react'
import { addDays, todayYMD } from '../../lib/date'
import { DateCal, flipDir } from '../framework/DateCal'

export interface RangeState {
  mode: 'quick' | 'custom'
  quick: number
  from: string
  to: string
}

export const DEFAULT_RANGE: RangeState = { mode: 'quick', quick: 30, from: addDays(todayYMD(), -29), to: todayYMD() }

const QUICKS = [
  { v: 7, l: '近 7 天' },
  { v: 30, l: '近 30 天' },
  { v: 60, l: '近 60 天' },
  { v: 365, l: '近一年' },
]

/** 默认把快捷天数同步进 from/to（切到自定义时呈现为对应区间，形成"近 30 天与范围选择融合"） */
export function quickToRange(v: number): { from: string; to: string } {
  return { from: addDays(todayYMD(), -(v - 1)), to: todayYMD() }
}

export function rangeLabel(r: RangeState): string {
  if (r.mode === 'custom' && r.from && r.to) return `${r.from.slice(5)} ~ ${r.to.slice(5)}`
  const q = QUICKS.find((x) => x.v === r.quick)
  return q ? q.l : `近 ${r.quick} 天`
}

export function RangePicker({ value, onChange }: {
  value: RangeState
  onChange: (r: RangeState) => void
}) {
  const [open, setOpen] = useState(false)
  const [dir, setDir] = useState<'down' | 'up'>('down')
  const wrapRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<'from' | 'to'>('from')

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, dir])

  const pickQuick = (v: number) => {
    const from = addDays(todayYMD(), -(v - 1))
    onChange({ mode: 'quick', quick: v, from, to: todayYMD() })
    setOpen(false)
  }
  const editCustom = (field: 'from' | 'to', ymd: string) => {
    const next = { ...value }
    if (field === 'from') next.from = ymd
    else next.to = ymd
    next.mode = 'custom'
    onChange(next)
    // 选完「起」自动跳到「止」
    if (field === 'from') setEditing('to')
    else setOpen(false)
  }

  return (
    <div className="rp-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`btn slim rp-trigger${open ? ' on' : ''}`}
        onClick={() => { setOpen((o) => { const n = !o; if (n) setDir(flipDir(wrapRef.current)); return n }) }}
        title="快捷档位 / 自定义起止日期"
      >
        🗓 {rangeLabel(value)} <span className="rp-caret">▾</span>
      </button>
      {open && (
        <div className={`rp-popup ${dir === 'up' ? 'up' : ''}`}>
          <div className="rp-seg">
            {QUICKS.map((q) => (
              <button
                key={q.v}
                type="button"
                className={`rp-seg-btn${value.mode === 'quick' && value.quick === q.v ? ' on' : ''}`}
                onClick={() => pickQuick(q.v)}
              >
                {q.l}
              </button>
            ))}
          </div>
          <div className="rp-custom">
            <span className="rp-custom-cap">自定义区间</span>
            <div className="rp-ends">
              <button type="button" className={`rp-end${editing === 'from' ? ' editing' : ''}`} onClick={() => setEditing('from')}>
                <em>起</em><b>{value.from || '未选'}</b>
              </button>
              <span className="rp-tilde">~</span>
              <button type="button" className={`rp-end${editing === 'to' ? ' editing' : ''}`} onClick={() => setEditing('to')}>
                <em>止</em><b>{value.to || '未选'}</b>
              </button>
            </div>
            <div className="rp-cal">
              <DateCal
                value={editing === 'from' ? value.from : value.to}
                onChange={(ymd) => editCustom(editing, ymd)}
                max={editing === 'from' ? value.to || undefined : undefined}
                min={editing === 'to' ? value.from || undefined : undefined}
              />
            </div>
            <div className="rp-apply">
              <button
                type="button"
                className="btn slim"
                disabled={!value.from || !value.to || value.from > value.to}
                onClick={() => setOpen(false)}
                title={value.from > value.to ? '起始日期不能晚于结束日期' : '应用当前区间'}
              >
                {value.from > value.to ? '区间不合法' : '应用'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}