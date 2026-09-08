/**
 * 访客只读端点（一次性授权范围闸门）：全部 requireGuest + requireScope，
 * 只做 findMany 投影 + 条数上限，绝不暴露写接口与设置/账号数据。
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireGuest, requireScope } from '../guestAuth'
import { ah, err } from './helpers'
import { timelineData } from '../services/timeline'

export const guest = Router()

const CAP = 200

// GET /guest/meta —— 授权信息（范围 / 到期），任何访客会话可用
guest.get('/meta', requireGuest, ah(async (req, res) => {
  res.json({
    scopes: req.guest!.scopes,
    expiresAt: req.guest!.expiresAt,
    label: req.guest!.label,
  })
}))

// GET /guest/timeline —— 时间流（复用管理员聚合，仅限 timeline 范围）
guest.get('/timeline', requireGuest, requireScope('timeline'), ah(async (req, res) => {
  const limit = Math.min(90, Math.max(5, Number(req.query.limit) || 30))
  const data = await timelineData({ limit })
  res.json(data)
}))

// GET /guest/posts —— 已发布文章列表（posts 范围）
guest.get('/posts', requireGuest, requireScope('posts'), ah(async (_req, res) => {
  const rows = await prisma.post.findMany({
    where: { status: 'published' },
    orderBy: { publishedAt: 'desc' },
    take: CAP,
    select: {
      id: true, slug: true, title: true, summary: true, charCount: true,
      publishedAt: true, tags: { select: { tag: { select: { name: true } } } },
    },
  })
  res.json({
    items: rows.map((p) => ({ ...p, tags: p.tags.map((t) => t.tag.name) })),
  })
}))

// GET /guest/posts/:id —— 已发布文章全文
guest.get('/posts/:id', requireGuest, requireScope('posts'), ah(async (req, res) => {
  const p = await prisma.post.findUnique({
    where: { id: req.params.id },
    select: { id: true, slug: true, title: true, summary: true, rawMarkdown: true, publishedAt: true, status: true },
  })
  if (!p || p.status !== 'published') return err(res, 404, 'NOT_FOUND', '文章不存在或未发布')
  res.json(p)
}))

// GET /guest/notes —— 灵感笔记（notes 范围；标签与文章共用）
guest.get('/notes', requireGuest, requireScope('notes'), ah(async (_req, res) => {
  const rows = await prisma.noteItem.findMany({
    orderBy: { createdAt: 'desc' },
    take: CAP,
    select: {
      id: true, title: true, body: true, date: true, createdAt: true,
      category: { select: { name: true } },
      tags: { select: { tag: { select: { name: true } } } },
    },
  })
  res.json({ items: rows.map((n) => ({ ...n, tags: n.tags.map((t) => t.tag.name) })) })
}))

// GET /guest/workplan —— 工作计划（workplan 范围）
guest.get('/workplan', requireGuest, requireScope('workplan'), ah(async (_req, res) => {
  const rows = await prisma.workTask.findMany({
    orderBy: { date: 'asc' },
    take: CAP,
    select: { id: true, date: true, text: true, note: true, done: true, doneAt: true },
  })
  res.json({ items: rows })
}))

// GET /guest/plan —— 今日计划（plan 范围）
guest.get('/plan', requireGuest, requireScope('plan'), ah(async (_req, res) => {
  const rows = await prisma.planItem.findMany({
    orderBy: { createdAt: 'asc' },
    take: CAP,
    select: { id: true, text: true, level: true, note: true, done: true, dueDate: true, doneAt: true, createdAt: true },
  })
  res.json({ items: rows })
}))
