/**
 * 数据修正：把 DB 中的分类/标签同步回写文件 frontmatter（修复历史文章缺 category/tags 的问题，
 * 博客端以文件 frontmatter 渲染）。其余字段（title/date/image/description 等）原样保留。
 * 幂等：已一致的文章不会改动。
 * 用法：corepack pnpm exec tsx src/normalize-post-frontmatter.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from './prisma'
import { postsDir, writePostFile } from './content'

async function main() {
  const posts = await prisma.post.findMany({ include: { category: true, tags: { include: { tag: true } } } })
  const dir = postsDir()
  let fixed = 0
  let unchanged = 0
  let missing = 0

  for (const p of posts) {
    // slug 可能对应子目录文件（如 guide-index → guide/index.md）
    let file = path.join(dir, `${p.slug}.md`)
    if (!fs.existsSync(file)) {
      const parts = p.slug.split('-')
      if (parts.length > 1) file = path.join(dir, ...parts.slice(0, -1), `${parts[parts.length - 1]}.md`)
    }
    if (!fs.existsSync(file)) {
      missing++
      console.log(`缺文件: ${p.slug}`)
      continue
    }
    const raw = fs.readFileSync(file, 'utf-8')
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!m) {
      console.log(`无 frontmatter: ${p.slug}`)
      continue
    }
    // 轻量解析现值（仅 category/tags 行）
    let fmCategory: string | null = null
    let fmHasTags = false
    for (const line of m[1].split(/\r?\n/)) {
      if (/^category\s*:/i.test(line)) { const v = line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, ''); fmCategory = v || null }
      else if (/^tags\s*:/i.test(line)) { fmHasTags = true }
    }
    const wantCategory = p.category?.name ?? null
    const wantTags = p.tags.map((t) => t.tag.name)
    if (fmCategory === wantCategory && fmHasTags === (wantTags.length > 0)) {
      unchanged++
      continue
    }
    const fm = JSON.parse(p.frontmatter || '{}') as Record<string, unknown>
    if (wantCategory) fm.category = wantCategory
    else delete fm.category
    if (wantTags.length) fm.tags = wantTags
    else delete fm.tags
    writePostFile({ slug: p.slug, title: p.title, rawMarkdown: p.rawMarkdown, frontmatter: JSON.stringify(fm), status: p.status, publishedAt: p.publishedAt })
    console.log(`回写: ${p.slug} -> category=${wantCategory ?? '无'} tags=[${wantTags}]`)
    fixed++
  }

  console.log(`\n完成: 回写 ${fixed}，已一致 ${unchanged}，缺文件 ${missing}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})