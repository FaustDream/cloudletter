/**
 * 时间范围选择器（Overview 共用）：快捷档位 + 自定义起止日期。
 * - 快捷档位：当天 / 近 7 天 / 近 30 天 / 本月 / 近一年（原「时间缩放档位」并入此处，顶栏不再单列按钮组）
 * - 自定义：起止日期，搭配月历浮层选择
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

/** 近 N 天区间（含当天：from = 今天 - (N-1)） */
function quickRange(v: number): { from: string; to: string } {
  return { from: addDays(todayYMD(), -(v - 1)), to: todayYMD() }
}

const quicks: Array<{ v: number; l: string; to: () => { from: string; to: string } }> = [
  { v: 0, l: '当天', to: () => ({ from: todayYMD(), to: todayYMD() }) },
  { v: 7, l: '近 7 天', to: () => quickRange(7) },
  { v: 30, l: '近 30 天', to: () => quickRange(30) },
  { v: 61, l: '本月', to: () => ({ from: `${todayYMD().slice(0, 7)}-01`, to: todayYMD() }) },
  { v: 365, l: '近一年', to: () => quickRange(365) },
]

/** 由档位值构造完整区间状态（v 不在档位表中时回退默认近 30 天） */
export function quickStateOf(v: number): RangeState {
  const q = quicks.find((x) => x.v === v)
  if (q) {
    const r = q.to()
    return { mode: 'quick', quick: v, from: r.from, to: r.to }
  }
  return DEFAULT_RANGE
}

/** 默认近 30 天 */
export const DEFAULT_RANGE: RangeState = { mode: 'quick', quick: 30, from: addDays(todayYMD(), -29), to: todayYMD() }

export function rangeLabel(r: RangeState): string {
  if (r.mode === 'custom' && r.from && r.to) return `${r.from.slice(5)} ~ ${r.to.slice(5)}`
  const q = quicks.find((x) => x.v === r.quick)
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
    onChange(quickStateOf(v))
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
        <svg className="rp-cal-ic" viewBox="0 0 1024 1024" width="14" height="14" aria-hidden="true"><path d="M771.104 145.056l0-60.096c0-17.664-14.304-32-32-32s-32 14.336-32 32l0 60.096-384 0 0-60.096c0-17.664-14.336-32-32-32s-32 14.336-32 32l0 60.096-202.208 0 0 825.952 910.208 0 0-825.952L771.104 145.056zM259.104 209.952l0 67.04c0 17.664 14.336 32 32 32s32-14.336 32-32l0-67.04 384 0 0 67.04c0 17.664 14.304 32 32 32s32-14.336 32-32l0-67.04 131.136 0 0 99.04-163.136 0-448 0-169.344 0 0-99.04L259.104 209.952zM121.76 906.176l0-533.184 780.48 0 0 533.184L121.76 906.176z" fill="#03A9F4"/><path d="M214.208 473.728l123.904 0 0 123.712-123.904 0 0-123.712Z" fill="#03A9F4"/><path d="M442.912 473.728l123.904 0 0 123.712-123.904 0 0-123.712Z" fill="#03A9F4"/><path d="M671.648 473.728l123.904 0 0 123.712-123.904 0 0-123.712Z" fill="#03A9F4"/><path d="M214.208 692.32l123.904 0 0 123.712-123.904 0 0-123.712Z" fill="#03A9F4"/><path d="M442.912 692.32l123.904 0 0 123.712-123.904 0 0-123.712Z" fill="#03A9F4"/><path d="M671.648 692.32l123.904 0 0 123.712-123.904 0 0-123.712Z" fill="#03A9F4"/></svg>
        {rangeLabel(value)} <span className="rp-caret">▾</span>
      </button>
      {open && (
        <div className={`rp-popup ${dir === 'up' ? 'up' : ''}`}>
          <div className="rp-seg">
            {quicks.map((q) => (
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