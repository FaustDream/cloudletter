/**
 * 类型筛选下拉（时光/总览共用）：多选「日志/灵感/计划/习惯/记账/目标/专注」，空数组 = 全部。
 * - 触发器胶囊：全部 / 已选 N 类
 * - 浮层内「全部」「类型」勾选；外部点击 / Esc 关闭
 */
import { useEffect, useRef, useState } from 'react'
import { TL_COLOR, TL_TYPES, type TimelineType } from './timeline'

export function TypeFilter({ selected, onChange }: {
  selected: TimelineType[]
  onChange: (t: TimelineType[]) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (t: TimelineType) => {
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]
    onChange(next.length === TL_TYPES.length ? [] : next)
  }
  const label = selected.length === 0 ? '全部' : `已选 ${selected.length} 类`

  return (
    <div className="tfilter" ref={wrapRef}>
      <button
        type="button"
        className={`fchip tfilter-trigger${open ? ' on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="按类型筛选（可多选）"
      >
        {label} <span className="tfilter-caret">▾</span>
      </button>
      {open && (
        <div className="tfilter-pop" role="listbox" aria-multiselectable="true">
          <button
            type="button"
            role="option"
            aria-selected={selected.length === 0}
            className={`tfilter-opt${selected.length === 0 ? ' on' : ''}`}
            onClick={() => onChange([])}
          >
            <i className="tf-dot all" />全部
          </button>
          {TL_TYPES.map(([k, l]) => {
            const on = selected.includes(k)
            return (
              <button
                key={k}
                type="button"
                role="option"
                aria-selected={on}
                className={`tfilter-opt${on ? ' on' : ''}`}
                onClick={() => toggle(k)}
              >
                <i className="tf-dot" style={{ background: TL_COLOR[k] }} />
                {l}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}