/**
 * 磁盘同步（§5.1 唯一真相源）：
 * Post(DB) → fuwari-blog/src/content/posts/{slug}.md（frontmatter YAML + §5 正文）
 * Astro 构建管线从这个目录读取内容，因此保存/发布必须落盘。
 */
import fs from 'node:fs'
import path from 'node:path'

export interface PostLike {
  slug: string
  type: string
  title: string
  rawMarkdown: string
  frontmatter: string
  status: string
  publishedAt: Date | null
}

const PROJECT_DIR = path.resolve(process.env.PROJECT_DIR || path.join(process.cwd(), '..', 'fuwari-blog'))

function postsDir(type: string): string {
  return type === 'note' ? path.join(PROJECT_DIR, 'src', 'content', 'note') : path.join(PROJECT_DIR, 'src', 'content', 'posts')
}

export function projectDir(): string {
  return PROJECT_DIR
}

export function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|#^\[\]]/g, '')
    .replace(/\s+/g, '-')
  return base || `post-${Date.now()}`
}

/** frontmatter JSON → YAML 文本（Astro/Fuwari 字段：title/published/tags/description/category） */
function frontmatterToYaml(fm: Record<string, unknown>): string {
  const lines: string[] = []
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return
    if (Array.isArray(v)) lines.push(`${k}: [${v.map(String).join(', ')}]`)
    else if (typeof v === 'object') lines.push(`${k}: ${JSON.stringify(v)}`)
    else lines.push(`${k}: ${typeof v === 'string' ? v : String(v)}`)
  }
  push('title', fm.title)
  push('published', fm.date ?? fm.published)
  push('description', fm.summary ?? fm.description)
  push('category', fm.category)
  push('tags', fm.tags)
  push('cover', fm.cover)
  push('draft', fm.draft)
  return lines.join('\n')
}

export function writePostFile(post: PostLike): string {
  const dir = postsDir(post.type)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${post.slug}.md`)
  let fm: Record<string, unknown> = {}
  try {
    fm = JSON.parse(post.frontmatter || '{}')
  } catch {
    fm = {}
  }
  if (!fm.title) fm.title = post.title
  if (!fm.date && !fm.published) fm.date = (post.publishedAt ?? new Date()).toISOString().slice(0, 10)
  // Fuwari 用 draft 标记草稿
  fm.draft = post.status !== 'published'

  const yaml = frontmatterToYaml(fm)
  const content = `---\n${yaml}\n---\n\n${post.rawMarkdown}\n`
  fs.writeFileSync(file, content, 'utf-8')
  return file
}

export function removePostFile(post: Pick<PostLike, 'slug' | 'type'>): void {
  const file = path.join(postsDir(post.type), `${post.slug}.md`)
  if (fs.existsSync(file)) fs.rmSync(file)
}

/** 站点设置写入 fuwari 配置入口（Phase 2 由设置台细化；Phase 0 保留 JSON 落盘） */
export function writeSettingsFile(valueJson: string): void {
  const dir = path.join(PROJECT_DIR, 'src', 'content', '_settings')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'site.json'), valueJson, 'utf-8')
}
