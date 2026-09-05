/**
 * 标签路由（V2）。
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { validateBody, v } from '../middleware/validate'
import { slugify } from '../content'

export const tags = Router()
tags.use(requireAuth)

tags.get('/', ah(async (_req, res) => {
  const items = await prisma.tag.findMany({ include: { _count: { select: { posts: true, notes: true } } } })
  res.json({ items })
}))

tags.post('/', ah(async (req, res) => {
  const body = validateBody<{ name: string }>(req, res, { name: { ...v.str(), required: true, min: 1, max: 50 } })
  if (!body) return
  const exists = await prisma.tag.findUnique({ where: { name: body.name } })
  if (exists) return err(res, 409, 'CONFLICT', '同名标签已存在')
  const t = await prisma.tag.create({ data: { name: body.name, slug: slugify(body.name) } })
  res.json(t)
}))

tags.put('/:id', ah(async (req, res) => {
  const t = await prisma.tag.findUnique({ where: { id: req.params.id } })
  if (!t) return err(res, 404, 'NOT_FOUND', '标签不存在')
  const newName = (req.body ?? {}).name
  if (newName !== undefined && typeof newName !== 'string') {
    return err(res, 422, 'VALIDATION', 'name 必须为字符串')
  }
  if (typeof newName === 'string' && newName.trim() && newName.trim() !== t.name) {
    const clash = await prisma.tag.findUnique({ where: { name: newName.trim() } })
    if (clash && clash.id !== t.id) return err(res, 409, 'CONFLICT', '同名标签已存在')
    const updated = await prisma.tag.update({
      where: { id: t.id },
      data: { name: newName.trim(), slug: slugify(newName.trim()) },
    })
    return res.json(updated)
  }
  res.json(t)
}))

tags.delete('/:id', ah(async (req, res) => {
  try {
    await prisma.tag.delete({ where: { id: req.params.id } })
  } catch {
    return err(res, 404, 'NOT_FOUND', '标签不存在')
  }
  res.json({ ok: true })
}))