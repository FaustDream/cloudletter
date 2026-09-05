/**
 * 分类路由（V2）。文件为内容真相源；分类是文章元数据（frontmatter.category → 文件名目录所属）。
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { validateBody, v } from '../middleware/validate'
import { slugify } from '../content'

export const categories = Router()
categories.use(requireAuth)

categories.get('/', ah(async (_req, res) => {
  const items = await prisma.category.findMany({ include: { _count: { select: { posts: true, notes: true } } } })
  res.json({ items })
}))

categories.post('/', ah(async (req, res) => {
  const body = validateBody<{ name: string; description?: string }>(req, res, {
    name: { ...v.str(), required: true, min: 1, max: 50 },
    description: v.str(),
  })
  if (!body) return
  const exists = await prisma.category.findUnique({ where: { slug: slugify(body.name) } })
  if (exists) return err(res, 409, 'CONFLICT', '同名分类已存在')
  const c = await prisma.category.create({ data: { name: body.name, slug: slugify(body.name), description: body.description } })
  res.json(c)
}))

categories.put('/:id', ah(async (req, res) => {
  const c = await prisma.category.findUnique({ where: { id: req.params.id } })
  if (!c) return err(res, 404, 'NOT_FOUND', '分类不存在')
  const body = (req.body ?? {}) as { name?: unknown; description?: unknown }
  if (body.name !== undefined && typeof body.name !== 'string') {
    return err(res, 422, 'VALIDATION', 'name 必须为字符串')
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return err(res, 422, 'VALIDATION', 'description 必须为字符串')
  }
  const newName = body.name as string | undefined
  if (typeof newName === 'string' && newName !== c.name) {
    const newSlug = slugify(newName)
    const clash = await prisma.category.findUnique({ where: { slug: newSlug } })
    if (clash && clash.id !== c.id) return err(res, 409, 'CONFLICT', '改名后与其他分类 slug 冲突')
    return res.json(
      await prisma.category.update({
        where: { id: c.id },
        data: { name: newName, slug: newSlug, description: (body.description as string | undefined) ?? c.description },
      }),
    )
  }
  const updated = await prisma.category.update({
    where: { id: c.id },
    data: { name: newName ?? c.name, description: (body.description as string | undefined) ?? c.description },
  })
  res.json(updated)
}))

categories.delete('/:id', ah(async (req, res) => {
  const c = await prisma.category.findUnique({ where: { id: req.params.id } })
  if (!c) return err(res, 404, 'NOT_FOUND', '分类不存在')
  // 笔记与文章共用分类：两边都要查占用
  const [posts, notes] = await Promise.all([
    prisma.post.count({ where: { categoryId: req.params.id } }),
    prisma.noteItem.count({ where: { categoryId: req.params.id } }),
  ])
  if (posts > 0 || notes > 0) {
    return err(res, 409, 'CONFLICT', `该分类下还有 ${posts} 篇文章、${notes} 条灵感笔记，请先移动或删除后再删除分类`)
  }
  await prisma.category.delete({ where: { id: req.params.id } })
  res.json({ ok: true })
}))