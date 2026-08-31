/**
 * 自定义下拉（DOM 渲染）：替代原生 <select>。
 * 内嵌 webview / 桌面壳中原生下拉的选项弹层渲染不可靠（点击无弹层），
 * 这里用按钮 + 弹出列表实现，任何环境表现一致；支持键盘（Enter 开关 / ↑↓ 选择 / Esc 关闭）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface DropdownOption {
  value: string
  label: string
  /** 可选色块（如组件主题色板），在按钮与选项前显示小色点 */
  swatch?: string
}

export function Dropdown({
  value,
  options,
  onChange,
  disabled,
  width,
  align = 'right',
  placeholder = '请选择',
  ariaLabel,
}: {
  value: string
  options: DropdownOption[]
  onChange: (v: string) => void
  disabled?: boolean
  /** 控件宽度（默认自适应，最小 180） */
  width?: number
  /** 弹出面板对齐方向：行内控件靠右（right），筛选条靠左（left） */
  align?: 'left' | 'right'
  placeholder?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [hi, setHi] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const current = options.find((o) => o.value === value)

  // 外点关闭 / Esc
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 打开时测量空间：下方不足则向上弹
  useLayoutEffect(() => {
    if (!open) return
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return
    setUp(innerHeight - r.bottom < 240 && r.top > 240)
    setHi(options.findIndex((o) => o.value === value))
  }, [open, options, value])

  const commit = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open && (e.key === 'Enter' || e.key === 'ArrowDown')) { e.preventDefault(); setOpen(true); return }
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); commit(options[hi].value) }
  }

  return (
    <div className={`dd${disabled ? ' disabled' : ''}`} ref={rootRef} style={width ? { width } : undefined}>
      <button
        type="button"
        className="dd-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        <span className={current ? '' : 'dim'}>
          {current?.swatch && <i className="dd-swatch" style={{ background: current.swatch }} />}
          {current?.label ?? placeholder}
        </span>
        <i className="dd-chev" />
      </button>
      {open && (
        <div className={`dd-menu ${align === 'right' ? 'right' : 'left'}${up ? ' up' : ''}`} role="listbox" ref={menuRef}>
          {options.length === 0 && <div className="dd-empty">没有可选项</div>}
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={`dd-item${o.value === value ? ' on' : ''}${i === hi ? ' hi' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(o.value)}
            >
              {o.swatch && <i className="dd-swatch" style={{ background: o.swatch }} />}
              {o.label}
              {o.value === value && <span className="dd-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
