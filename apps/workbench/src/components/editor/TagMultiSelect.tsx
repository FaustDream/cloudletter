/**
 * 标签下拉多选（Notion 式属性交互，替代 chip 手输）：
 * - 触发器内联展示已选标签（点 × 移除）；点击展开面板：搜索框 + 候选列表 + 「新建」项
 * - 候选构建走 lib/tagOptions.ts 纯函数（已选置顶可取消、查询过滤、无命中给新建）
 * - 键盘：↑↓ 移动 / Enter 勾选或新建 / Backspace 删除末尾 / Esc 关闭（对齐 ⌘K 浮层约定）
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { buildTagOptions, type TagOption } from '../../lib/tagOptions'

export function TagMultiSelect({ tags, suggestions, onChange, ariaLabel = '选择标签' }: {
  tags: string[]
  /** 全站标签名（候选来源） */
  suggestions: string[]
  onChange: (tags: string[]) => void
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const [up, setUp] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const options = buildTagOptions(suggestions, tags, query)

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
    if (r) setUp(innerHeight - r.bottom < 260 && r.top > 260)
    setHi(0)
  }, [open])

  const toggleTag = (name: string) => {
    onChange(tags.includes(name) ? tags.filter((t) => t !== name) : [...tags, name])
  }

  const commit = (o: TagOption) => {
    if (o.kind === 'create') onChange([...tags, o.name])
    else toggleTag(o.name)
    setQuery('')
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const o = options[hi]; if (o) commit(o) }
    else if (e.key === 'Backspace' && !query && tags.length) onChange(tags.slice(0, -1))
  }

  return (
    <div className="tag-ms" ref={rootRef}>
      <button
        type="button"
        className={`tag-ms-trigger${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => { setOpen((v) => !v); if (!open) setTimeout(() => inputRef.current?.focus(), 0) }}
      >
        {tags.length === 0 && <span className="tag-ms-ph">添加标签…</span>}
        {tags.map((t) => (
          <span key={t} className="tag-ms-chip">
            {t}
            <i title={`移除「${t}」`} onClick={(e) => { e.stopPropagation(); toggleTag(t) }}>×</i>
          </span>
        ))}
        <i className="dd-chev" />
      </button>
      {open && (
        <div className={`tag-ms-menu${up ? ' up' : ''}`} role="listbox" aria-multiselectable="true">
          <input
            ref={inputRef}
            className="tag-ms-search"
            value={query}
            placeholder="搜索或新建标签…"
            onChange={(e) => { setQuery(e.target.value); setHi(0) }}
            onKeyDown={onKeyDown}
          />
          {options.length === 0 && <div className="dd-empty">没有匹配的标签</div>}
          {options.map((o, i) => (
            <button
              key={`${o.kind}:${o.name}`}
              type="button"
              role="option"
              aria-selected={o.selected}
              className={`tag-ms-item${o.selected ? ' on' : ''}${i === hi ? ' hi' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(o)}
            >
              {o.kind === 'create'
                ? <span className="tag-ms-new">＋ 新建</span>
                : <span className="tag-ms-check">{o.selected ? '✓' : ''}</span>}
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
