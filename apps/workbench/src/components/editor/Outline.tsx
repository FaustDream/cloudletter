/** 右栏：文档信息（应用卡片风格）+ 大纲统计 + 双链（自 write 应用并入后统一风格） */
import { useMemo } from 'react'
import { Icon } from '../framework/Icon'

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

export function FrontmatterPanel({
  fm,
  slug,
  onSlugChange,
  onChange,
}: {
  fm: Frontmatter
  /** 文章 slug（URL/文件名标识），可编辑（保存时校验唯一性） */
  slug: string
  onSlugChange: (slug: string) => void
  onChange: (fm: Frontmatter) => void
}) {
  const set = (patch: Partial<Frontmatter>) => onChange({ ...fm, ...patch })
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
          <input value={fm.category ?? ''} onChange={(e) => set({ category: e.target.value })} placeholder="未分类" />
        </span>
      </div>
      <div className="fm-row">
        <span className="fm-k">标签</span>
        <span className="fm-v">
          <input
            value={(fm.tags ?? []).join(', ')}
            onChange={(e) => set({ tags: e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean) })}
            placeholder="技术, 随笔"
          />
        </span>
      </div>
      <label>
        摘要
        <textarea
          rows={3}
          value={fm.summary ?? ''}
          onChange={(e) => set({ summary: e.target.value })}
          placeholder="列表页展示的摘要"
        />
      </label>
      <div className="fm-row">
        <span className="fm-k">封面图</span>
        <span className="fm-v">
          <input value={fm.cover ?? ''} onChange={(e) => set({ cover: e.target.value })} placeholder="图片 URL" />
        </span>
      </div>
    </div>
  )
}
