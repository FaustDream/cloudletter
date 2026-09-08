/**
 * 标签同步服务：文章（PostTag）与灵感笔记（NoteTag）共用同一套 Tag 表与同一套同步逻辑。
 * 语义：按 name upsert Tag → 重建 owner×Tag 关联（deleteMany + 逐条 create）。
 * SQLite 不支持 createMany 与事务外批量，逐条 upsert/create；重名去重防撞复合主键。
 */
import { prisma } from '../prisma'
import { slugify } from '../content'

interface SyncTagsArgs {
  /** 关联表：postTag（文章）或 noteTag（笔记） */
  link: 'postTag' | 'noteTag'
  ownerId: string
  /** 标签名（自动 trim / 去空 / 去重，最多 20 个；非数组按空处理） */
  names: unknown
}

/**
 * 同步 owner（文章/笔记）的标签关联：
 * 传入空数组 = 清空全部标签；重名/含空格名称自动收敛后再写入。
 */
export async function syncTags({ link, ownerId, names }: SyncTagsArgs): Promise<void> {
  if (!Array.isArray(names)) return
  const clean = [...new Set(
    names.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter((n) => n !== ''),
  )].slice(0, 20)
  const ids: string[] = []
  for (const name of clean) {
    const tag = await prisma.tag.upsert({ where: { name }, update: {}, create: { name, slug: slugify(name) } })
    ids.push(tag.id)
  }
  if (link === 'postTag') {
    await prisma.postTag.deleteMany({ where: { postId: ownerId } })
    for (const tagId of ids) {
      await prisma.postTag.create({ data: { postId: ownerId, tagId } })
    }
  } else {
    await prisma.noteTag.deleteMany({ where: { noteId: ownerId } })
    for (const tagId of ids) {
      await prisma.noteTag.create({ data: { noteId: ownerId, tagId } })
    }
  }
}