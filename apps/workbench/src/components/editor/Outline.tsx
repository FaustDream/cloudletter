/** 右栏：文档信息（Notion 式属性面板，可折叠）+ 大纲统计 + 双链（自 write 应用并入后统一风格） */
import { useMemo, useRef, useState } from 'react'
import { Icon } from '../framework/Icon'
import { TagMultiSelect } from './TagMultiSelect'

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

/** 单行标题匹配：支持无空格（#标题，手写习惯）与 5 级以上排除、空标题排除 */
function matchHeadingLine(line: string): Heading | null {
  // 引用前缀（外部粘贴场景）与至多 3 个前导空格（CommonMark 允许）
  const stripped = line.replace(/^\s{0,3}(?:>\s*)+/, '')
  const m = stripped.match(/^(#{1,4})(?!#)\s*(\S.*)$/)
  if (!m) return null
  const text = m[2].replace(/\s+#+\s*$/, '').trim() // 兼容 ATX 收尾（## 标题 ##）
  if (!text) return null
  return { level: m[1].length, text }
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
    const m = matchHeadingLine(line)
    if (m) out.push(m)
  }
  return out
}

export function Outline({ markdown, title, onTitleClick, onItemClick }: {
  markdown: string
  /** 文章大标题（画布标题输入框内容）：作为大纲首条，点击回到开头 */
  title?: string
  onTitleClick?: () => void
  /** 点击标题项：参数为标题文本（按文本定位正文块，重名取第一个） */
  onItemClick?: (text: string) => void
}) {
  const headings = useMemo(() => extractHeadings(markdown), [markdown])
  const hasTitle = Boolean(title?.trim())

  const chars = markdown.replace(/\s/g, '').length
  const readMin = Math.max(1, Math.round(chars / 400))

  return (
    <div className="outline">
      <div className="ed-side-head"><Icon name="list" size={15} /> 大纲与统计</div>
      {hasTitle && (
        <button className="outline-title" onClick={onTitleClick} title="回到文章开头">{title}</button>
      )}
      {headings.length === 0 && <div className="outline-empty">暂无标题</div>}
      {headings.map((h, i) => (
        <button
          key={i}
          className="outline-item"
          style={{ paddingLeft: 12 + (h.level - 1) * 12 }}
          onClick={() => onItemClick?.(h.text)}
          title="跳转到此标题"
        >
          {h.text}
        </button>
      ))}
      <div className="outline-stats" style={{ marginTop: hasTitle || headings.length ? 10 : 0 }}>
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
      {links.length === 0 && (
        <div className="outline-empty">在正文输入 [[文章标题]] 建立双链，点击正文中的双链文字可跳转</div>
      )}
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
 * 文档属性面板（Notion 式，右栏内嵌主体）：分类下拉（可搜索/新建，单选）、
 * 标签下拉多选（可搜索/新建）、封面上传/预览、摘要（默认折叠省空间）、Slug（带说明）。
 * 元数据仍是 frontmatter 结构，仅交互控件化；新建的分类/标签都会落库并同步到「分类标签」菜单。
 */
export function FrontmatterPanel({
  fm,
  slug,
  onSlugChange,
  onChange,
  categories = [],
  tagSuggestions = [],
  onUploadCover,
  onCreateCategory,
}: {
  fm: Frontmatter
  /** 文章 slug（URL/文件名标识），可编辑（保存时校验唯一性） */
  slug: string
  onSlugChange: (slug: string) => void
  onChange: (fm: Frontmatter) => void
  /** 全站分类（下拉选择，替代手填） */
  categories?: Array<{ id: string; name: string }>
  /** 全站标签名（多选候选） */
  tagSuggestions?: string[]
  /** 封面上传：返回可访问 URL */
  onUploadCover?: (file: File) => Promise<string | null>
  /** 新建分类：落库后同步全站列表（「分类标签」菜单可见） */
  onCreateCategory?: (name: string) => Promise<unknown> | unknown
}) {
  const set = (patch: Partial<Frontmatter>) => onChange({ ...fm, ...patch })
  const [summaryOpen, setSummaryOpen] = useState(false)
  const catName = fm.category ?? ''

  return (
    <>
      <div className="fm-row">
        <span className="fm-k">分类</span>
        <span className="fm-v">
          <TagMultiSelect
            multiple={false}
            tags={catName ? [catName] : []}
            suggestions={categories.map((c) => c.name)}
            placeholder="选择或新建分类…"
            ariaLabel="选择分类"
            onCreate={onCreateCategory}
            onChange={(names) => set({ category: names[0] || undefined })}
          />
        </span>
      </div>

      <div className="fm-row fm-tags-row">
        <span className="fm-k">标签</span>
        <span className="fm-v">
          <TagMultiSelect tags={fm.tags ?? []} suggestions={tagSuggestions} onChange={(tags) => set({ tags })} />
        </span>
      </div>

      {summaryOpen || fm.summary ? (
        <label className="fm-label">
          摘要
          <textarea
            rows={3}
            value={fm.summary ?? ''}
            onChange={(e) => set({ summary: e.target.value })}
            onBlur={() => { if (!fm.summary?.trim()) setSummaryOpen(false) }}
            placeholder="列表页展示的摘要"
          />
        </label>
      ) : (
        <button className="fm-add-btn" onClick={() => setSummaryOpen(true)}>＋ 摘要</button>
      )}

      <CoverPicker cover={fm.cover ?? ''} onUpload={onUploadCover} onChange={(cover) => set({ cover: cover || undefined })} />

      <div className="fm-row">
        <span className="fm-k">Slug</span>
        <span className="fm-v">
          <input
            value={slug}
            onChange={(e) => onSlugChange(e.target.value.replace(/\s+/g, '-'))}
            placeholder="url-标识"
            title="Slug 是文章的 URL 标识：用于文章链接与服务器文件名；建议英文、数字与连字符，保存时校验唯一性"
          />
          <span className="fm-hint">文章的 URL 标识（链接与文件名用），建议英文/数字/连字符</span>
        </span>
      </div>
    </>
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
 * 右栏首节：可折叠「文档信息」（cl_ed_meta 记忆折叠态）。
 * 置于右栏顶部（大纲与统计之上），不再以顶部横条挤占画布纵向空间。
 */
export function EdSideMeta(props: Parameters<typeof FrontmatterPanel>[0]) {
  const [open, setOpen] = useState(() => localStorage.getItem('cl_ed_meta') !== '0')

  const toggle = () => {
    const next = !open
    setOpen(next)
    localStorage.setItem('cl_ed_meta', next ? '1' : '0')
  }

  return (
    <div className="fm-panel ed-side-meta" data-open={open}>
      <button className="ed-side-fold" onClick={toggle} aria-expanded={open} title={open ? '收起文档信息' : '展开文档信息'}>
        <Icon name={open ? 'panelFold' : 'panel'} size={14} />
        文档信息
        <i className="ed-side-fold-chev">▾</i>
      </button>
      {open && <FrontmatterPanel {...props} />}
    </div>
  )
}
