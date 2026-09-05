/**
 * 下拉选择器（Notion 式属性交互，多选/单选两用）：
 * - 多选（默认）：标签场景——已选 chip、搜索过滤、勾选切换、无命中给「新建」
 * - 单选：分类场景——同一下拉范式，点选即替换；配 onCreate 可在无命中时直接新建
 *   （如分类会 POST /categories 落库，自动同步到「分类标签」菜单）
 * 候选构建走 lib/tagOptions.ts 纯函数；键盘：↑↓/Enter/Backspace/Esc（对齐 ⌘K 浮层约定）
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { buildTagOptions, type TagOption } from '../../lib/tagOptions'

export function TagMultiSelect({ tags, suggestions, onChange, onCreate, multiple = true, placeholder = '添加标签…', ariaLabel = '选择标签' }: {
  /** 多选=已选标签列表；单选=长度 0/1 的当前值 */
  tags: string[]
  /** 全站候选（标签=全站标签名；分类=全部分类名） */
  suggestions: string[]
  onChange: (next: string[]) => void
  /** 「新建」回调（如分类需先 POST /categories 落库再选中）；缺省时仅本地新增 */
  onCreate?: (name: string) => Promise<unknown> | unknown
  multiple?: boolean
  placeholder?: string
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
    if (!multiple) {
      onChange(tags.includes(name) ? [] : [name])
      setOpen(false)
      return
    }
    onChange(tags.includes(name) ? tags.filter((t) => t !== name) : [...tags, name])
  }

  const commit = (o: TagOption) => {
    void Promise.resolve(onCreate?.(o.name)).then(() => {
      if (o.kind === 'create') onChange(multiple ? [...tags, o.name] : [o.name])
      else toggleTag(o.name)
      setQuery('')
      inputRef.current?.focus()
    })
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
        {tags.length === 0 && <span className="tag-ms-ph">{placeholder}</span>}
        {tags.map((t) => (
          <span key={t} className="tag-ms-chip">
            {t}
            <i title={`移除「${t}」`} onClick={(e) => { e.stopPropagation(); if (!multiple) onChange([]); else toggleTag(t) }}>×</i>
          </span>
        ))}
        <i className="dd-chev" />
      </button>
      {open && (
        <div className={`tag-ms-menu${up ? ' up' : ''}`} role="listbox" aria-multiselectable={multiple}>
          <input
            ref={inputRef}
            className="tag-ms-search"
            value={query}
            placeholder={multiple ? '搜索或新建标签…' : '搜索或新建…'}
            onChange={(e) => { setQuery(e.target.value); setHi(0) }}
            onKeyDown={onKeyDown}
          />
          {options.length === 0 && <div className="dd-empty">没有匹配的选项</div>}
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
