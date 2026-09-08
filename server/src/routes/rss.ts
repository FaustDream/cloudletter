/**
 * RSS 路由：公开生成 Feed + 登录后管理订阅（互相关注、订阅、内容发现）。
 * - GET /rss.xml          公开：标准 RSS 2.0 Feed（已发布文章）
 * - GET /feeds            订阅列表
 * - POST /feeds/subscribe 新增订阅（服务端抓取解析并缓存条目）
 * - POST /feeds/:id/refresh 手动刷新
 * - DELETE /feeds/:id     取消订阅
 * - GET /feeds/:id/items  订阅源文章列表
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { buildRssFeed, fetchAndParseFeed } from '../lib/rss'
import { webOrigin } from '../lib/webOrigin'
import { logActivity } from '../services/activity'

export const rss = Router()

/** 公开 Feed（无需登录）：完整 XML 输出，供其他博客/阅读器订阅 */
rss.get('/rss.xml', ah(async (_req, res) => {
  const origin = webOrigin(_req)
  const xml = await buildRssFeed(origin)
  res.setHeader('content-type', 'application/rss+xml; charset=utf-8')
  res.setHeader('cache-control', 'no-cache')
  res.send(xml)
}))

/* ===== 订阅管理（登录） ===== */
const rssApi = Router()
rssApi.use(requireAuth)

rssApi.get('/', ah(async (_req, res) => {
  const subs = await prisma.rssSubscription.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  })
  res.json({
    items: subs.map((s) => ({
      id: s.id, url: s.url, title: s.title, siteUrl: s.siteUrl, description: s.description,
      itemCount: s._count.items, lastFetchedAt: s.lastFetchedAt, createdAt: s.createdAt,
    })),
  })
}))

rssApi.post('/subscribe', ah(async (_req, res) => {
  const url = String((_req.body ?? {}).url ?? '').trim()
  let u: URL
  try { u = new URL(url) } catch { return err(res, 422, 'VALIDATION', 'URL 格式不正确（需 http/https）') }
  if (!/^https?:$/.test(u.protocol)) return err(res, 422, 'VALIDATION', '仅支持 http/https 订阅源')
  try {
    const parsed = await fetchAndParseFeed(url)
    const sub = await prisma.rssSubscription.upsert({
      where: { url },
      update: { title: parsed.title, siteUrl: parsed.siteUrl, description: parsed.description, lastFetchedAt: new Date() },
      create: {
        url,
        title: parsed.title.slice(0, 200),
        siteUrl: parsed.siteUrl.slice(0, 500),
        description: parsed.description.slice(0, 500),
        lastFetchedAt: new Date(),
      },
    })
    let added = 0
    for (const it of parsed.items.slice(0, 200)) {
      try {
        await prisma.rssItem.create({
          data: {
            subId: sub.id, guid: String(it.guid).slice(0, 500), title: it.title.slice(0, 500),
            link: it.link.slice(0, 1000), author: it.author.slice(0, 200),
            summary: it.summary, publishedAt: it.publishedAt,
          },
        })
        added++
      } catch { /* [subId, guid] 唯一约束：重复条目跳过 */ }
    }
    logActivity(_req, { action: 'rss_subscribe', object: 'RSS 订阅', target: sub.id, detail: { url, added } })
    res.json({ ok: true, id: sub.id, title: parsed.title, added })
  } catch (e: unknown) {
    return err(res, 422, 'VALIDATION', `订阅源解析失败：${String((e as { message?: unknown } | null)?.message ?? '无法解析').slice(0, 120)}`)
  }
}))

rssApi.post('/:id/refresh', ah(async (_req, res) => {
  const sub = await prisma.rssSubscription.findUnique({ where: { id: _req.params.id } })
  if (!sub) return err(res, 404, 'NOT_FOUND', '订阅不存在')
  try {
    const parsed = await fetchAndParseFeed(sub.url)
    let added = 0
    for (const it of parsed.items.slice(0, 200)) {
      const exists = await prisma.rssItem.findUnique({ where: { subId_guid: { subId: sub.id, guid: String(it.guid).slice(0, 500) } } })
      if (exists) continue
      try {
        await prisma.rssItem.create({
          data: {
            subId: sub.id, guid: String(it.guid).slice(0, 500), title: it.title.slice(0, 500),
            link: it.link.slice(0, 1000), author: it.author.slice(0, 200),
            summary: it.summary, publishedAt: it.publishedAt,
          },
        })
        added++
      } catch { /* 重复项跳过 */ }
    }
    await prisma.rssSubscription.update({ where: { id: sub.id }, data: { title: parsed.title, lastFetchedAt: new Date() } })
    res.json({ ok: true, added, total: await prisma.rssItem.count({ where: { subId: sub.id } }) })
  } catch (e: unknown) {
    return err(res, 422, 'VALIDATION', `刷新失败:${String((e as { message?: unknown } | null)?.message ?? '网络错误').slice(0, 120)}`)
  }
}))

rssApi.get('/:id/items', ah(async (_req, res) => {
  const items = await prisma.rssItem.findMany({
    where: { subId: _req.params.id },
    orderBy: { publishedAt: 'desc' },
    take: 100,
    select: { id: true, title: true, link: true, author: true, summary: true, publishedAt: true },
  })
  res.json({ items })
}))

rssApi.delete('/:id', ah(async (_req, res) => {
  try {
    const s = await prisma.rssSubscription.delete({ where: { id: _req.params.id } })
    logActivity(_req, { action: 'webhook_delete', object: 'RSS 订阅', target: s.id })
    res.json({ ok: true })
  } catch { return err(res, 404, 'NOT_FOUND', '订阅不存在') }
}))

export { rssApi }