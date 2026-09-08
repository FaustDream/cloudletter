/**
 * RSS：生成标准 RSS 2.0 Feed（公开，无需登录）+ 订阅其他博客的最小解析器
 * （手写正则级解析：rss 2.0 / atom 常用字段，避免引入重型依赖）。
 */
import crypto from 'node:crypto'
import { prisma } from '../prisma'

/** 解码 XML 实体与 CDATA */
function unescapeXml(s: string): string {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

/** 从 <tag> 提取内容（含 CDATA/实体解码；支持 <tag attr=..>） */
function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return m ? unescapeXml(m[1]) : ''
}
/** 取第一个带指定属性的元素内容，用于 atom:link rel=alternate 等 */
function xmlTagByAttr(xml: string, tag: string, attr: string, val: string, extract: 'content' | 'href'): string {
  const re = new RegExp(`<${tag}\\s[^>]*${attr}\\s*=\\s*["']${val}["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = xml.match(re)
  if (m) return extract === 'content' ? unescapeXml(m[1]) : unescapeXml(m[1])
  const self = new RegExp(`<${tag}\\s[^>]*\\b${attr}\\s*=\\s*["']${val}["'][^>]*/?>`, 'i')
  const s = xml.match(self)
  if (s && extract === 'href') {
    const href = s[0].match(/href\s*=\s*["']([^"']+)["']/i)
    return href ? unescapeXml(href[1]) : ''
  }
  return ''
}

export interface FeedItem {
  guid: string
  title: string
  link: string
  author: string
  summary: string
  publishedAt: Date | null
}

export interface ParsedFeed {
  title: string
  siteUrl: string
  description: string
  items: FeedItem[]
}

/** 订阅源拉取 + 解析（rss 2.0 / atom）。网络失败/解析失败抛错由调用方处理 */
export async function fetchAndParseFeed(url: string, timeoutMs = 12_000): Promise<ParsedFeed> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  let xml = ''
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'user-agent': 'cloudletter-rss/2.0', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    xml = (await res.text()).slice(0, 2_000_000)
  } finally {
    clearTimeout(timer)
  }
  const items: FeedItem[] = []
  // RSS 2.0
  const isRss = /<rss[\s>]/.test(xml)
  if (isRss) {
    const channel = xml.match(/<channel>([\s\S]*?)<\/channel>/i)?.[1] ?? xml
    const entries = channel.match(/<item>[\s\S]*?<\/item>/gi) ?? []
    for (const e of entries) {
      const title = xmlTag(e, 'title')
      if (!title) continue
      let link = xmlTag(e, 'link')
      link = link || xmlTagByAttr(e, 'link', 'rel', 'alternate', 'content')
      const guid = xmlTag(e, 'guid') || link || `item-${crypto.randomUUID()}`
      const pub = xmlTag(e, 'pubDate') || xmlTag(e, 'dc:date')
      const author = xmlTag(e, 'author') || xmlTag(e, 'dc:creator')
      const summary = xmlTag(e, 'description') || xmlTag(e, 'summary') || xmlTag(e, 'content:encoded')
      items.push({
        guid, title,
        link: link || '',
        author,
        summary: summary.slice(0, 4000),
        publishedAt: pub ? new Date(pub) : null,
      })
    }
    return {
      title: xmlTag(channel, 'title') || url,
      siteUrl: xmlTag(channel, 'link') || '',
      description: xmlTag(channel, 'description'),
      items,
    }
  }
  // Atom
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? []
  for (const e of entries) {
    const title = xmlTag(e, 'title')
    if (!title) continue
    let link = xmlTagByAttr(e, 'link', 'rel', 'alternate', 'href')
    link = link || xmlTagByAttr(e, 'link', 'rel', '', 'href')
    const id = xmlTag(e, 'id')
    const pub = xmlTag(e, 'published') || xmlTag(e, 'updated')
    const author = xmlTag(e, 'author')
    const summary = xmlTag(e, 'summary') || xmlTag(e, 'content')
    items.push({
      guid: id || link || `item-${crypto.randomUUID()}`,
      title,
      link,
      author,
      summary: summary.slice(0, 4000),
      publishedAt: pub ? new Date(pub) : null,
    })
  }
  let siteUrl = xmlTagByAttr(xml, 'link', 'rel', 'alternate', 'href')
  siteUrl = siteUrl || xmlTagByAttr(xml, 'link', 'rel', '', 'href')
  return {
    title: xmlTag(xml, 'title') || url,
    siteUrl,
    description: xmlTag(xml, 'subtitle') || xmlTag(xml, 'description'),
    items,
  }
}

/** 生成全站 RSS 2.0 Feed（已发布文章；supports 由外部拼 host） */
export async function buildRssFeed(origin: string): Promise<string> {
  const site = await prisma.siteSetting.findUnique({ where: { key: 'global' } })
  let siteCfg: Record<string, unknown> = {}
  try { siteCfg = site ? JSON.parse(site.value) : {} } catch { /* 忽略 */ }
  const siteSection = typeof siteCfg.site === 'object' && siteCfg.site !== null ? siteCfg.site as Record<string, unknown> : {}
  const appearance = typeof siteCfg.appearance === 'object' && siteCfg.appearance !== null ? siteCfg.appearance as Record<string, unknown> : {}
  const name = String(siteSection.name ?? appearance.siteName ?? '云笺集')
  const desc = String(siteSection.description ?? '个人创作工作台：文章、灵感与日常')
  const posts = await prisma.post.findMany({
    where: { status: 'published' },
    orderBy: { publishedAt: 'desc' },
    take: 50,
    include: { tags: { include: { tag: true } } },
  })
  const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toUTCString() : new Date().toUTCString())
  const items = posts
    .map((p) => {
      const link = `${origin}/post/${encodeURIComponent(p.slug)}/`
      return [
        '<item>',
        `<title><![CDATA[${p.title}]]></title>`,
        `<link>${esc(link)}</link>`,
        `<guid isPermaLink="false">${esc(p.id)}</guid>`,
        `<pubDate>${iso(p.publishedAt)}</pubDate>`,
        p.summary ? `<description><![CDATA[${p.summary}]]></description>` : '',
        '<category>' + p.tags.map(({ tag }) => `<![CDATA[${tag.name}]]>`).join('</category><category>') + '</category>',
        '</item>',
      ].join('')
    })
    .join('')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title><![CDATA[${name}]]></title>`,
    `<description><![CDATA[${desc}]]></description>`,
    `<link>${esc(origin)}</link>`,
    `<atom:link href="${esc(origin + '/rss.xml')}" rel="self" type="application/rss+xml"/>`,
    '<language>zh-CN</language>',
    `<lastBuildDate>${iso(new Date())}</lastBuildDate>`,
    items,
    '</channel>',
    '</rss>',
  ].join('')
}