/** 右栏：文档信息（Notion 式属性面板）+ 大纲统计 + 双链（自 write 应用并入后统一风格） */
import { useMemo, useRef, useState } from 'react'
import { Icon } from '../framework/Icon'
import { Dropdown } from '../framework/Dropdown'

export interface Frontmatter {
  title?: string
  category?: string
  tags?: string[]
  summary?: string
  cover?: string
  date?: string
}

export interface Heading {
  level: number
  text: string
}

/** 提取 1-4 级标题，跳过代码围栏内的伪标题 */
export function extractHeadings(markdown: string): Heading[] {
  const out: Heading[] = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = line.match(/^(#{1,4})\s+(.+)/)
    if (m) out.push({ level: m[1].length, text: m[2].trim() })
  }
  return out
}

export function Outline({ markdown }: { markdown: string }) {
  const headings = useMemo(() => extractHeadings(markdown), [markdown])

  const chars = markdown.replace(/\s/g, '').length
  const readMin = Math.max(1, Math.round(chars / 400))

  return (
    <div className="outline">
      <div className="ed-side-head"><Icon name="list" size={15} /> 大纲与统计</div>
      {headings.length === 0 && <div className="outline-empty">暂无标题</div>}
      {headings.map((h, i) => (
        <div key={i} className="outline-item" style={{ paddingLeft: (h.level - 1) * 12 }}>
          {h.text}
        </div>
      ))}
      <div className="outline-stats" style={{ marginTop: headings.length ? 10 : 0 }}>
        <span>{chars} 字</span>
        <span>约 {readMin} 分钟</span>
      </div>
    </div>
  )
}

/** 提取正文中的 [[双链]] 目标（去重，保留出现顺序） */
export function extractWikiLinks(markdown: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of markdown.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    const name = m[1].trim()
    if (name && !seen.has(name)) { seen.add(name); out.push(name) }
  }
  return out
}

export function WikiLinks({
  markdown,
  onOpen,
  currentTitle,
}: {
  markdown: string
  onOpen: (target: string) => void
  /** 当前文章标题（自身链接禁用） */
  currentTitle: string
}) {
  const links = useMemo(() => extractWikiLinks(markdown), [markdown])
  return (
    <div className="outline">
      <div className="ed-side-head"><Icon name="link" size={15} /> 双链</div>
      {links.length === 0 && <div className="outline-empty">用 [[文章标题]] 建立链接</div>}
      {links.map((name) => (
        <button
          key={name}
          className="wikilink-item"
          disabled={name === currentTitle}
          title={name === currentTitle ? '就是当前文章' : `打开「${name}」`}
          onClick={() => onOpen(name)}
        >
          🔗 {name}
        </button>
      ))}
    </div>
  )
}

/**
 * 文档属性面板（Notion 式）：分类下拉选择、标签 chip 增删（带全站标签候选）、
 * 封面上传/预览、摘要、Slug。元数据仍是 frontmatter 结构，仅交互控件化。
 */
export function FrontmatterPanel({
  fm,
  slug,
  onSlugChange,
  onChange,
  categories = [],
  tagSuggestions = [],
  onUploadCover,
}: {
  fm: Frontmatter
  /** 文章 slug（URL/文件名标识），可编辑（保存时校验唯一性） */
  slug: string
  onSlugChange: (slug: string) => void
  onChange: (fm: Frontmatter) => void
  /** 全站分类（下拉选择，替代手填） */
  categories?: Array<{ id: string; name: string }>
  /** 全站标签名（输入建议候选） */
  tagSuggestions?: string[]
  /** 封面上传：返回可访问 URL */
  onUploadCover?: (file: File) => Promise<string | null>
}) {
  const set = (patch: Partial<Frontmatter>) => onChange({ ...fm, ...patch })
  const tags = fm.tags ?? []
  const catName = fm.category ?? ''
  const catKnown = !catName || categories.some((c) => c.name === catName)

  return (
    <div className="fm-panel">
      <div className="ed-side-head"><Icon name="file" size={15} /> 文档信息</div>

      <div className="fm-row">
        <span className="fm-k">Slug</span>
        <span className="fm-v">
          <input value={slug} onChange={(e) => onSlugChange(e.target.value.replace(/\s+/g, '-'))} placeholder="url-标识" />
        </span>
      </div>

      <div className="fm-row">
        <span className="fm-k">分类</span>
        <span className="fm-v">
          <Dropdown
            value={catName}
            width={0}
            align="left"
            placeholder="未分类"
            ariaLabel="选择分类"
            options={[
              { value: '', label: '未分类' },
              ...categories.map((c) => ({ value: c.name, label: c.name })),
            ]}
            onChange={(v) => set({ category: v || undefined })}
          />
          {!catKnown && <span className="fm-hint">当前值「{catName}」不在分类列表，选择后覆盖</span>}
        </span>
      </div>

      <TagChips
        tags={tags}
        suggestions={tagSuggestions}
        onChange={(tags) => set({ tags })}
      />

      <label className="fm-label">
        摘要
        <textarea
          rows={3}
          value={fm.summary ?? ''}
          onChange={(e) => set({ summary: e.target.value })}
          placeholder="列表页展示的摘要"
        />
      </label>

      <CoverPicker cover={fm.cover ?? ''} onUpload={onUploadCover} onChange={(cover) => set({ cover: cover || undefined })} />
    </div>
  )
}

/** 标签 chip 输入：回车/逗号新增、退格删除末尾、点 × 移除；候选来自全站标签 */
function TagChips({ tags, suggestions, onChange }: {
  tags: string[]
  suggestions: string[]
  onChange: (tags: string[]) => void
}) {
  const [input, setInput] = useState('')
  const add = (raw: string) => {
    const n = raw.trim().replace(/[,，]$/, '')
    if (n && !tags.includes(n)) onChange([...tags, n])
    setInput('')
  }
  const cand = suggestions
    .filter((s) => !tags.includes(s))
    .filter((s) => (input ? s.toLowerCase().includes(input.toLowerCase()) : true))
    .slice(0, 6)

  return (
    <div className="fm-row fm-tags-row">
      <span className="fm-k">标签</span>
      <span className="fm-v">
        <div className="fm-tags">
          {tags.map((t) => (
            <span key={t} className="fm-chip">
              {t}
              <button title={`移除「${t}」`} onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChange(tags.filter((x) => x !== t))}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          <input
            className="fm-tags-input"
            value={input}
            placeholder={tags.length ? '添加…' : '添加标签…'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); add(input) }
              if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1))
            }}
            onBlur={() => input.trim() && add(input)}
          />
        </div>
        {cand.length > 0 && (
          <div className="fm-tag-cand">
            {cand.map((s) => (
              <button key={s} title={`使用「${s}」`} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)}>
                + {s}
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  )
}

/** 封面选择器：预览 + 上传 + URL 兜底输入 + 移除 */
function CoverPicker({ cover, onUpload, onChange }: {
  cover: string
  onUpload?: (file: File) => Promise<string | null>
  onChange: (cover: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [showUrl, setShowUrl] = useState(false)

  const upload = async (file: File) => {
    if (!onUpload) return
    setBusy(true)
    try {
      const url = await onUpload(file)
      if (url) onChange(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fm-row fm-cover-row">
      <span className="fm-k">封面</span>
      <span className="fm-v">
        {cover
          ? <img className="fm-cover-thumb" src={cover} alt="封面预览" />
          : <div className="fm-cover-empty">未设置封面</div>}
        <div className="fm-cover-ops">
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
          <button className="fm-op-btn" disabled={busy || !onUpload} onClick={() => fileRef.current?.click()}>
            {busy ? '上传中…' : '上传图片'}
          </button>
          {cover && <button className="fm-op-btn" onClick={() => onChange('')}>移除</button>}
          <button className="fm-op-btn" onClick={() => setShowUrl((v) => !v)}>{showUrl ? '收起' : '用 URL'}</button>
        </div>
        {showUrl && (
          <input className="fm-cover-url" value={cover} onChange={(e) => onChange(e.target.value)} placeholder="粘贴图片 URL" />
        )}
      </span>
    </div>
  )
}

/**
 * 紧凑文档信息条（编辑页顶部）：Slug / 分类 / 标签 / 摘要 / 封面 横向排布，
 * 不再长期占用右侧编辑空间；可整体折叠（cl_ed_meta 记忆）。
 */
export function EdMetaBar({
  fm,
  slug,
  onSlugChange,
  onChange,
  categories = [],
  tagSuggestions = [],
  onUploadCover,
}: {
  fm: Frontmatter
  slug: string
  onSlugChange: (slug: string) => void
  onChange: (fm: Frontmatter) => void
  categories?: Array<{ id: string; name: string }>
  tagSuggestions?: string[]
  onUploadCover?: (file: File) => Promise<string | null>
}) {
  const [open, setOpen] = useState(() => localStorage.getItem('cl_ed_meta') !== '0')
  const [showSummary, setShowSummary] = useState(Boolean(fm.summary))
  const set = (patch: Partial<Frontmatter>) => onChange({ ...fm, ...patch })
  const tags = fm.tags ?? []
  const catName = fm.category ?? ''
  const catKnown = !catName || categories.some((c) => c.name === catName)

  const toggle = () => {
    const next = !open
    setOpen(next)
    localStorage.setItem('cl_ed_meta', next ? '1' : '0')
  }

  return (
    <div className={`ed-meta${open ? '' : ' folded'}`}>
      <div className="ed-meta-head">
        <button className="ed-meta-toggle" onClick={toggle} title={open ? '收起文档信息' : '展开文档信息'}>
          <Icon name={open ? 'panelFold' : 'panel'} size={14} />
          文档信息
        </button>
        <span className="ed-meta-tip">Slug / 分类 / 标签 / 摘要 / 封面</span>
      </div>
      {open && (
        <div className="ed-meta-body">
          <label className="ed-meta-item slug">
            <span>Slug</span>
            <input value={slug} onChange={(e) => onSlugChange(e.target.value.replace(/\s+/g, '-'))} placeholder="url-标识" />
          </label>
          <label className="ed-meta-item">
            <span>分类</span>
            <Dropdown
              value={catName}
              width={0}
              align="left"
              placeholder="未分类"
              ariaLabel="选择分类"
              options={[
                { value: '', label: '未分类' },
                ...categories.map((c) => ({ value: c.name, label: c.name })),
              ]}
              onChange={(v) => set({ category: v || undefined })}
            />
            {!catKnown && <em className="ed-meta-warn">「{catName}」不在分类列表</em>}
          </label>
          <div className="ed-meta-item">
            <span>标签</span>
            <TagChips
              tags={tags}
              suggestions={tagSuggestions}
              onChange={(t) => set({ tags: t })}
            />
          </div>
          <div
            className="ed-meta-item summary"
            title="摘要"
            onClick={() => setShowSummary(true)}
          >
            {showSummary ? (
              <>
                <span>摘要</span>
                <textarea
                  rows={2}
                  value={fm.summary ?? ''}
                  onChange={(e) => set({ summary: e.target.value })}
                  onBlur={() => { if (!fm.summary?.trim()) setShowSummary(false) }}
                  placeholder="列表页展示的摘要"
                />
              </>
            ) : (
              <button className="ed-meta-add-summary" onClick={() => setShowSummary(true)}>＋ 摘要</button>
            )}
          </div>
          <div className="ed-meta-item cover">
            <span>封面</span>
            <CoverPicker cover={fm.cover ?? ''} onUpload={onUploadCover} onChange={(c) => set({ cover: c || undefined })} />
          </div>
        </div>
      )}
    </div>
  )
}
