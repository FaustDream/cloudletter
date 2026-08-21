/** 右栏：大纲（标题层级）+ 实时统计 + frontmatter 面板 */
import { useMemo } from 'react'

export interface Frontmatter {
  title?: string
  category?: string
  tags?: string[]
  summary?: string
  cover?: string
  date?: string
}

export function Outline({ markdown }: { markdown: string }) {
  const headings = useMemo(() => {
    const out: { level: number; text: string }[] = []
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
  }, [markdown])

  const chars = markdown.replace(/\s/g, '').length
  const readMin = Math.max(1, Math.round(chars / 400))

  return (
    <div className="outline">
      <div className="panel-title">大纲</div>
      {headings.length === 0 && <div className="empty">暂无标题</div>}
      {headings.map((h, i) => (
        <div key={i} className="outline-item" style={{ paddingLeft: (h.level - 1) * 12 }}>
          {h.text}
        </div>
      ))}
      <div className="panel-title" style={{ marginTop: 16 }}>
        统计
      </div>
      <div className="stats">
        <span>{chars} 字</span>
        <span>约 {readMin} 分钟</span>
      </div>
    </div>
  )
}

export function FrontmatterPanel({
  fm,
  onChange,
}: {
  fm: Frontmatter
  onChange: (fm: Frontmatter) => void
}) {
  const set = (patch: Partial<Frontmatter>) => onChange({ ...fm, ...patch })
  return (
    <div className="fm-panel">
      <div className="panel-title">文档信息</div>
      <label>
        分类
        <input value={fm.category ?? ''} onChange={(e) => set({ category: e.target.value })} placeholder="未分类" />
      </label>
      <label>
        标签（逗号分隔）
        <input
          value={(fm.tags ?? []).join(', ')}
          onChange={(e) => set({ tags: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })}
          placeholder="技术, 随笔"
        />
      </label>
      <label>
        摘要
        <textarea
          rows={3}
          value={fm.summary ?? ''}
          onChange={(e) => set({ summary: e.target.value })}
          placeholder="列表页展示的摘要"
        />
      </label>
      <label>
        封面图
        <input value={fm.cover ?? ''} onChange={(e) => set({ cover: e.target.value })} placeholder="图片 URL" />
      </label>
    </div>
  )
}
