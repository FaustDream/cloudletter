/**
 * 一次性迁移：灵感笔记接入文章的分类/标签体系（2026-09 需求）。
 * 1) 确保「灵感」分类与标签存在；
 * 2) 旧 mood 自由标签 → 正式 Tag + NoteTag 关联（无 mood 的默认打「灵感」标签）；
 * 3) type=plan 的计划型速记 → 今日计划 PlanItem（level P1，标题取 title 或正文首行）；
 * 4) 无分类的灵感笔记默认归入「灵感」分类。
 * 跑完一次后本脚本即完成使命（schema 旧列 type/mood/done/doneAt 随第二次 db push 移除）。
 */
import { prisma } from '../src/prisma'
import { slugify } from '../src/content'

const DEFAULT_NAME = '灵感'

async function ensureCategory(name: string) {
  const found = await prisma.category.findFirst({ where: { name } })
  if (found) return found
  return prisma.category.create({ data: { name, slug: slugify(name) } })
}

async function ensureTag(name: string) {
  const found = await prisma.tag.findUnique({ where: { name } })
  if (found) return found
  return prisma.tag.create({ data: { name, slug: slugify(name) } })
}

async function main() {
  const cat = await ensureCategory(DEFAULT_NAME)
  const notes = await prisma.noteItem.findMany()
  let inspirations = 0
  let plansMoved = 0
  let tagLinks = 0

  for (const n of notes) {
    // 计划型速记 → 今日计划（统一计划入口，完成自动进时间轴）
    if (n.type === 'plan') {
      const text = (n.title || n.body.split('\n')[0] || '（速记计划）').slice(0, 2000)
      await prisma.planItem.create({
        data: { text, note: n.body, level: 'P1', dueDate: '', done: n.done, doneAt: n.doneAt },
      })
      await prisma.noteItem.delete({ where: { id: n.id } })
      plansMoved++
      continue
    }
    // 灵感笔记：默认分类 + mood 转正式标签
    if (!n.categoryId) {
      await prisma.noteItem.update({ where: { id: n.id }, data: { categoryId: cat.id } })
    }
    const mood = (n.mood || '').trim()
    for (const name of [mood || DEFAULT_NAME]) {
      const tag = await ensureTag(name)
      const linked = await prisma.noteTag.findFirst({ where: { noteId: n.id, tagId: tag.id } })
      if (!linked) {
        await prisma.noteTag.create({ data: { noteId: n.id, tagId: tag.id } })
        tagLinks++
      }
    }
    inspirations++
  }

  console.log(`[migrate-notes-taxonomy] 灵感笔记 ${inspirations} 条已接入分类标签；计划型速记 ${plansMoved} 条 → 今日计划；新建标签关联 ${tagLinks} 条`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
