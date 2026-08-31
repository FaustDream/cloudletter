/**
 * 内容真相源层（V2）：文章正文 = Markdown 文件（apps/blog/src/content/posts/{slug}.md）。
 * SQLite 仅存元数据索引；本模块负责文件读写，frontmatter 用轻量序列化（Phase P1 可换 js-yaml）。
 * 版本历史正文快照另存 projects/.revisions/<slug>/<version>.md。
 */
import fs from 'node:fs'
import path from 'node:path'
import { postsRootDir, revisionsDir, settingsDir } from './config'

export interface PostFile {
  slug: string
  title: string
  rawMarkdown: string
  frontmatter?: string
  status: string
  publishedAt: Date | null
}

const POSTS_DIR = postsRootDir()
const REVISIONS_DIR = revisionsDir

export function postsDir(): string {
  return POSTS_DIR
}

export function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|#^\[\]]/g, '')
    .replace(/\s+/g, '-')
  return base || `post-${Date.now()}`
}

/**
 * YAML 标量安全化：含特殊字符（冒号/井号/换行/引号/首尾空格等）的字符串用单引号包裹，
 * 避免「标题带换行」「摘要带冒号」产出非法 frontmatter 破坏文件真相源。单引号按 YAML 规则翻倍转义。
 */
function yamlScalar(v: string): string {
  const safeChars = /^[A-Za-z0-9_\-.][A-Za-z0-9_\-./: ]*$/.test(v) && v.trim() === v
  // YAML 纯标量里「: 」（冒号+空格）会被解析成键值分隔，结尾冒号同样非法 → 必须引号包裹
  if (safeChars && !/:\s/.test(v) && !v.endsWith(':')) return v
  return `'${v.replace(/'/g, "''")}'`
}

/** frontmatter JSON → YAML 文本（Astro/Fuwari 字段：title/published/description/category/tags/cover/draft） */
function frontmatterToYaml(fm: Record<string, unknown>): string {
  const lines: string[] = []
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => yamlScalar(String(x))).join(', ')}]`)
    else if (typeof v === 'object') lines.push(`${k}: ${JSON.stringify(v)}`)
    else lines.push(`${k}: ${yamlScalar(String(v))}`)
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

/** 原子写：临时文件 + rename 覆盖，避免写入中断留下半篇文件 */
export function writePostFile(post: PostFile): string {
  fs.mkdirSync(POSTS_DIR, { recursive: true })
  const file = path.join(POSTS_DIR, `${post.slug}.md`)

  let fm: Record<string, unknown> = {}
  try {
    fm = JSON.parse(post.frontmatter || '{}')
  } catch {
    fm = {}
  }
  if (!fm.title) fm.title = post.title
  if (!fm.date && !fm.published) fm.date = (post.publishedAt ?? new Date()).toISOString().slice(0, 10)
  fm.draft = post.status !== 'published'

  const content = `---\n${frontmatterToYaml(fm)}\n---\n\n${post.rawMarkdown}\n`
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, content, 'utf-8')
    fs.renameSync(tmp, file)
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.rmSync(tmp)
    } catch {}
    throw e
  }
  return file
}

export function removePostFile(slug: string): void {
  const file = path.join(POSTS_DIR, `${slug}.md`)
  if (fs.existsSync(file)) fs.rmSync(file)
}

/** slug 变更：同步改名文章文件与版本快照目录（保持真相源与索引一致） */
export function renamePostAssets(oldSlug: string, newSlug: string): void {
  const oldFile = path.join(POSTS_DIR, `${oldSlug}.md`)
  const newFile = path.join(POSTS_DIR, `${newSlug}.md`)
  if (fs.existsSync(oldFile) && oldSlug !== newSlug) fs.renameSync(oldFile, newFile)
  const oldDir = path.join(REVISIONS_DIR, oldSlug)
  const newDir = path.join(REVISIONS_DIR, newSlug)
  if (fs.existsSync(oldDir) && oldSlug !== newSlug) fs.renameSync(oldDir, newDir)
}

/* ===== 版本历史（正文快照存文件） ===== */

export function writeRevisionFile(slug: string, version: number, rawMarkdown: string): string {
  const dir = path.join(REVISIONS_DIR, slug)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${version}.md`)
  fs.writeFileSync(file, rawMarkdown, 'utf-8')
  return file
}

export function readRevisionFile(slug: string, version: number): string | null {
  const file = path.join(REVISIONS_DIR, slug, `${version}.md`)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null
}

export function removeRevisionDir(slug: string): void {
  const dir = path.join(REVISIONS_DIR, slug)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

/** 站点设置写入 fuwari 配置入口 */
export function writeSettingsFile(valueJson: string): void {
  const dir = settingsDir()
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'site.json'), valueJson, 'utf-8')
}