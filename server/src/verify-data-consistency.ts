/**
 * 数据安全校验：比对文章真相源目录（默认读取 config.postsRootDir()，即 POSTS_ROOT 或
 * <DATA_ROOT>/posts）与本服务 SQLite 索引的数量一致 / 内容一致 / 关联一致。
 * 用法：corepack pnpm exec tsx src/verify-data-consistency.ts （可 SRC_POSTS 覆盖源目录）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { prisma } from './prisma'
import { postsRootDir } from './config'

const SRC = path.resolve(process.env.SRC_POSTS || postsRootDir())

function walk(dir: string, base: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, base, out)
    else if (ent.name.endsWith('.md')) out.push(path.relative(base, full).replace(/\\/g, '/').replace(/\.md$/, ''))
  }
  return out
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const fm: Record<string, unknown> = {}
  if (!m) return fm
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim()
    let val = line.slice(idx + 1).trim()
    if (!key || !val) continue
    if (val.startsWith('[')) {
      fm[key] = val
        .slice(1, -1)
        .split(',')
        .map((t) => t.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      continue
    }
    val = val.replace(/^["']|["']$/g, '')
    if (val === 'true') fm[key] = true
    else if (val === 'false') fm[key] = false
    else fm[key] = val
  }
  return fm
}

function slugFrom(rel: string): string {
  return rel.split('/').map((seg) => seg.toLowerCase().replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, '-') || `post-${Date.now()}`).join('-') || ''
}

async function main() {
  const files = walk(SRC, SRC)
  const posts = await prisma.post.findMany({ include: { category: true, tags: { include: { tag: true } } } })
  const categories = await prisma.category.findMany()
  const tags = await prisma.tag.findMany()

  const problems: string[] = []
  let checked = 0

  console.log(`源文件 ${files.length} 篇 | DB 文章 ${posts.length} 篇`)

  // 1) 数量一致（文件 ↔ DB；子目录合并成 slug；「无标题」跳过 slug 映射不一致的检查）
  const fileSet = new Set(files.map(slugFrom).filter(Boolean))
  const dbSet = new Set(posts.map((p) => p.slug))
  const missDb = [...fileSet].filter((s) => !dbSet.has(s))
  if (missDb.length) problems.push(`文件存在但 DB 缺失: ${missDb.join(', ')}`)
  const missFile = [...dbSet].filter((s) => !fileSet.has(s))
  if (missFile.length) problems.push(`DB 存在但文件缺失: ${missFile.join(', ')}`)

  // 2) 逐篇内容一致
  for (const f of files) {
    const abs = path.join(SRC, f + '.md')
    const raw = fs.readFileSync(abs, 'utf-8')
    const fm = parseFrontmatter(raw)
    const slug = slugFrom(f)
    const post = posts.find((p) => p.slug === slug)
    if (!post) continue
    checked++
    const rel = `${f} (${slug})`

    if (post.title !== String(fm.title)) problems.push(`[${rel}] title 不一致: DB="${post.title}" vs FM="${fm.title}"`)
    const expectStatus = fm.draft === true ? 'draft' : 'published'
    if (post.status !== expectStatus) problems.push(`[${rel}] status 不一致: DB="${post.status}" vs FM=${fm.draft === true ? 'draft' : 'published'}`)
    if (String(post.summary) !== String(fm.description ?? '')) problems.push(`[${rel}] summary 不一致`)
    const expectCat = String(fm.category ?? '').trim() || null
    if ((post.category?.name ?? null) !== expectCat) problems.push(`[${rel}] category 不一致: DB="${post.category?.name ?? null}" vs FM="${expectCat}"`)
    const expectTags = Array.isArray(fm.tags) ? fm.tags.map(String).sort() : []
    const dbTags = post.tags.map((t) => t.tag.name).sort()
    if (JSON.stringify(dbTags) !== JSON.stringify(expectTags)) problems.push(`[${rel}] tags 不一致: DB=[${dbTags}] vs FM=[${expectTags}]`)
    if (typeof fm.published === 'string' && fm.published) {
      const d = new Date(fm.published)
      if (!Number.isNaN(d.getTime()) && (!post.publishedAt || post.publishedAt.toISOString().slice(0, 10) !== d.toISOString().slice(0, 10))) {
        problems.push(`[${rel}] publishedAt 不一致: DB="${post.publishedAt?.toISOString()}" vs FM="${fm.published}"`)
      }
    }
  }

  // 3) 分类/标签数量一致（源端从全量文件统计）
  const catSet = new Set<string>()
  const tagSet = new Set<string>()
  for (const f of files) {
    const raw = fs.readFileSync(path.join(SRC, f + '.md'), 'utf-8')
    const fm = parseFrontmatter(raw)
    if (fm.category) catSet.add(String(fm.category).trim())
    for (const t of Array.isArray(fm.tags) ? fm.tags : []) tagSet.add(String(t))
  }
  const dbCatNames = new Set(categories.map((c) => c.name))
  const dbTagNames = new Set(tags.map((t) => t.name))
  for (const c of catSet) if (!dbCatNames.has(c)) problems.push(`分类「${c}」未入库`)
  for (const t of tagSet) if (!dbTagNames.has(t)) problems.push(`标签「${t}」未入库`)

  // 4) 源文件未被后端改写（rawMarkdown 与文件正文一致）
  let bodyMismatch = 0
  for (const p of posts) {
    const abs = path.join(SRC, p.slug.replace(/-([^-]+)$/, '/$1') + '.md') // 兜底（子目录反转）
    if (!fs.existsSync(abs)) continue
    const raw = fs.readFileSync(abs, 'utf-8')
    const end = raw.indexOf('---', 3)
    const body = end >= 0 ? raw.slice(end + 3).replace(/^\s*\n/, '') : raw
    if (body.replace(/[ \t\r\n]/g, '') !== p.rawMarkdown.replace(/[ \t\r\n]/g, '')) bodyMismatch++
  }
  if (bodyMismatch) problems.push(`正文与文件不一致 ${bodyMismatch} 篇（可能被编辑器改写，属正常回写则忽略）`)

  const fileSum = crypto.createHash('md5').update(files.join(',')).digest('hex').slice(0, 8)
  console.log(`校验 ${checked} 篇 | 分类源 ${catSet.size} / DB ${categories.length} | 标签源 ${tagSet.size} / DB ${tags.length} | 文件指纹 ${fileSum}`)
  if (problems.length) {
    console.log('\n-- 不一致项 --')
    for (const p of problems) console.log(' ✗', p)
    process.exitCode = 1
  } else {
    console.log('\n✓ 数量一致、内容一致、关联一致：全部通过')
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})