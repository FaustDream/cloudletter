/**
 * 一次性迁移：把博客内容目录中的全部文章迁移到本服务 SQLite 元数据索引 + 版本快照。
 * - 文件真相源原样保留（不改写任何 .md，不删文件）；
 * - 幂等：已存在 slug 的文章跳过，可重复执行；
 * - 覆盖字段：title/published(发布日期)/description(摘要)/category(分类)/tags(标签)/draft(状态)/cover/image。
 *
 * 用法：corepack pnpm exec tsx src/migrate-blog-content.ts
 * 可选环境变量 SRC_POSTS 指定来源目录（默认 ../fuwari-blog/src/content/posts）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from './prisma'
import { slugify, writeRevisionFile } from './content'

const SRC = path.resolve(process.env.SRC_POSTS || path.join(process.cwd(), 'data', 'dev', 'posts'))

/** 递归收集 .md 文件，返回 [absPath, relPath(不含 .md)] */
function walk(dir: string, base: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(full, base, out)
    else if (ent.name.endsWith('.md')) {
      out.push([full, path.relative(base, full).replace(/\\/g, '/').replace(/\.md$/, '')])
    }
  }
  return out
}

/** frontmatter 解析：支持数组/布尔/字符串/引用值 */
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

/** 去掉 frontmatter，返回正文 */
function bodyOf(raw: string): string {
  const end = raw.indexOf('---', 3)
  return end >= 0 ? raw.slice(end + 3).replace(/^\s*\n/, '') : raw
}

function asTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

async function main() {
  const files = walk(SRC, SRC)
  console.log(`源目录: ${SRC}\n发现 ${files.length} 篇 .md`)

  let created = 0
  let skipped = 0
  let failed = 0

  for (const [abs] of files) {
    try {
      const raw = fs.readFileSync(abs, 'utf-8')
      const rel = path.relative(SRC, abs).replace(/\\/g, '/').replace(/\.md$/, '')
      const fm = parseFrontmatter(raw)
      const title = String(fm.title || path.basename(rel))
      const summary = String(fm.description ?? '')
      const tags = asTags(fm.tags)
      const categoryName = String(fm.category ?? '').trim() || null
      const isDraft = fm.draft === true
      const slug = rel
        .split('/')
        .map((seg) => slugify(seg))
        .join('-') || slugify(title)

      const isDuplicateSlug = await prisma.post.findUnique({ where: { slug } })
      if (isDuplicateSlug) {
        console.log(`跳过（slug 已存在）: ${slug}`)
        skipped++
        continue
      }

      // 分类：按 slug 复用/新建
      let categoryId: string | null = null
      if (categoryName) {
        const catSlug = slugify(categoryName)
        const cat = await prisma.category.upsert({
          where: { slug: catSlug },
          update: {},
          create: { name: categoryName, slug: catSlug },
        })
        categoryId = cat.id
      }

      // 标签：按名称复用/新建
      const tagIds: string[] = []
      for (const name of tags) {
        const t = await prisma.tag.upsert({
          where: { name },
          update: {},
          create: { name, slug: slugify(name) },
        })
        tagIds.push(t.id)
      }

      // 发布日期：published 字段为日期时保留（草稿也保留日期数据）
      const published = fm.published
      let publishedAt: Date | null = null
      if (typeof published === 'string' && !Number.isNaN(new Date(published).getTime())) {
        publishedAt = new Date(published)
      }

      const body = bodyOf(raw)
      const post = await prisma.post.create({
        data: {
          slug,
          title,
          summary,
          rawMarkdown: body,
          frontmatter: JSON.stringify(fm),
          status: isDraft ? 'draft' : 'published',
          publishedAt,
          categoryId,
          revisions: { create: { version: 1 } },
        },
      })
      // 标签关联
      for (const tagId of tagIds) {
        await prisma.postTag.create({ data: { postId: post.id, tagId } })
      }
      // 版本快照（正文，供版本历史/回滚）
      writeRevisionFile(slug, 1, body)

      console.log(`迁移: ${slug} | ${title} | ${isDraft ? 'draft' : 'published'} | ${categoryName ?? '-'} | tags[${tags.length}]`)
      created++
    } catch (e) {
      failed++
      console.error(`迁移失败: ${abs}`, e)
    }
  }

  console.log(`\n完成: 新建 ${created}，跳过 ${skipped}，失败 ${failed}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})