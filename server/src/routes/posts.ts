/**
 * 文章路由（V2）：list / get / create / update（乐观锁 + 版本）/ delete / revisions / restore。
 * 内容真相源 = Markdown 文件；"文件先落、DB 后提交"，DB 失败回滚文件，保持元数据与文件一致。
 */
import { Router } from 'express'
import type { Post } from '@prisma/client'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { validateBody, v } from '../middleware/validate'
import { indexSearchPost, removeSearchPost } from '../search-index'
import {
  readRevisionFile,
  removePostFile,
  removeRevisionDir,
  renamePostAssets,
  slugify,
  writePostFile,
  writeRevisionFile,
} from '../content'
import { logActivity } from '../services/activity'
import { syncTags } from '../services/tags'
import { emitWebhookEvent } from './integrations'

export const posts = Router()
posts.use(requireAuth)

/** 自动保存版本快照的最小间隔：距上次快照不足该时长时，自动保存不再产生新版本（手动保存不受限） */
const AUTO_REVISION_MIN_INTERVAL_MS = 2 * 60 * 1000

function isP2025(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2025'
}

/** 非 ASCII 标题生成的 slug（URL 编码后可读性差）→ 时间戳兜底；可用自定义 slug 覆盖 */
function asciiSafeSlug(base: string): string {
  return /^[\x20-\x7E]+$/.test(base) ? base : `post-${Date.now().toString(36)}`
}

function toFile(post: Post) {
  return {
    slug: post.slug,
    title: post.title,
    rawMarkdown: post.rawMarkdown,
    frontmatter: post.frontmatter,
    status: post.status,
    publishedAt: post.publishedAt,
  }
}

/** 把分类名/标签名合并进 frontmatter JSON（文件真相源必须含 category/tags，博客端以此渲染） */
function withMeta(fm: Record<string, unknown>, categoryName: string | null, tags: string[] | undefined): Record<string, unknown> {
  const out = { ...fm }
  if (categoryName) out.category = categoryName
  else delete out.category
  if (tags && tags.length) out.tags = tags
  else delete out.tags
  return out
}

posts.get('/', ah(async (req, res) => {
  const { status, q } = req.query
  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (q) {
    const sq = String(q).slice(0, 100)
    where.OR = [{ title: { contains: sq } }, { rawMarkdown: { contains: sq } }]
  }
  // 列表分页/体积保护：默认最多 500 条，不回传正文（章节用 charCount）
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 500)
  const items = await prisma.post.findMany({
    where,
    select: {
      id: true, slug: true, title: true, status: true, summary: true,
      charCount: true, updatedAt: true, publishedAt: true, frontmatter: true,
      category: { select: { name: true, slug: true } },
      tags: { include: { tag: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  })
  res.json({
    items: items.map((p) => {
      let cover = ''
      try { cover = (JSON.parse(p.frontmatter || '{}') as { cover?: string }).cover ?? '' } catch { /* 畸形 frontmatter 忽略 */ }
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        status: p.status,
        summary: p.summary,
        updatedAt: p.updatedAt,
        publishedAt: p.publishedAt,
        category: p.category,
        tags: p.tags.map((t) => t.tag.name),
        chars: p.charCount,
        readMin: Math.max(1, Math.round(p.charCount / 480)),
        cover,
      }
    }),
  })
}))

posts.post('/', ah(async (req, res) => {
  const body = validateBody<{
    title: string
    slug?: string
    summary?: string
    rawMarkdown?: string
    categoryId?: string
    tags?: string[]
    status?: string
  }>(req, res, {
    title: { ...v.str(), required: true, min: 1, max: 200 },
    slug: { ...v.str(), max: 120 },
    summary: v.str(),
    // 大文档防护：正文上限 100 万字符（配合 express.json 2MB 体积上限）
    rawMarkdown: { ...v.str(), max: 1_000_000 },
    categoryId: v.str(),
    tags: v.arr(v.str(), 0, 20),
    status: { ...v.str(), oneOf: ['draft', 'published'] },
  })
  if (!body) return
  // 保存非空引用：嵌套异步函数内 TS 会丢失 body 的空值收窄
  const b = body

  // 自定义 slug 优先；否则标题 slugify + 非 ASCII 时间戳兜底
  const baseSlug = asciiSafeSlug(b.slug ? slugify(b.slug) : slugify(b.title))
  let categoryName: string | null = null
  if (b.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: b.categoryId } })
    if (!cat) return err(res, 422, 'VALIDATION', '分类不存在')
    categoryName = cat.name
  }

  const st = b.status === 'published' ? 'published' : 'draft'
  const publishDate = st === 'published' ? new Date() : null
  const fm = withMeta({}, categoryName, b.tags)
  const fmJson = JSON.stringify(fm)
  const markdown = b.rawMarkdown ?? ''

  // 文件先落（真相源，frontmatter 含 category/tags），DB 后建；
  // 并发下唯一性预检可能失效（P2002）→ 自动追加后缀重试一次，避免 500
  const isP2002 = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2002'
  async function createPostAt(s: string): Promise<Post> {
    writePostFile({ slug: s, title: b.title, rawMarkdown: markdown, frontmatter: fmJson, status: st, publishedAt: publishDate })
    try {
      return await prisma.post.create({
        data: {
          slug: s, title: b.title, summary: b.summary ?? '',
          rawMarkdown: markdown, frontmatter: fmJson, status: st, publishedAt: publishDate,
          charCount: markdown.length,
          categoryId: b.categoryId || null,
          revisions: { create: { version: 1, kind: 'manual' } },
        },
      })
    } catch (e) {
      removePostFile(s)
      if (isP2002(e)) {
        const retry = `${s}-${Date.now().toString(36)}`
        writePostFile({ slug: retry, title: b.title, rawMarkdown: markdown, frontmatter: fmJson, status: st, publishedAt: publishDate })
        try {
          return await prisma.post.create({
            data: {
              slug: retry, title: b.title, summary: b.summary ?? '',
              rawMarkdown: markdown, frontmatter: fmJson, status: st, publishedAt: publishDate,
              charCount: markdown.length,
              categoryId: b.categoryId || null,
              revisions: { create: { version: 1, kind: 'manual' } },
            },
          })
        } catch (e2) {
          removePostFile(retry)
          throw e2
        }
      }
      throw e
    }
  }

  let slug = baseSlug
  if (await prisma.post.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`
  const post = await createPostAt(slug)
  if (body.tags?.length) await syncTags({ link: 'postTag', ownerId: post.id, names: body.tags })
  writeRevisionFile(post.slug, 1, markdown)
  await indexSearchPost(post.id) // 同步全文索引（不阻断业务）
  logActivity(req, { action: 'post_create', object: b.title, target: post.id, detail: { slug: post.slug, status: post.status } })
  void emitWebhookEvent('post.created', { post: { id: post.id, title: b.title, slug: post.slug, status: post.status } })
  res.json({ id: post.id, slug: post.slug, status: post.status })
}))

posts.get('/:id', ah(async (req, res) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    include: { tags: { include: { tag: true } }, category: true },
  })
  if (!post) return err(res, 404, 'NOT_FOUND', '文章不存在')
  res.json({ ...post, tags: post.tags.map((t) => t.tag.name) })
}))

/* ===== 批量操作：发布 / 转草稿 / 删除 / 打标签 / 改分类 ===== */

posts.post('/batch', ah(async (req, res) => {
  const action = String(req.body?.action ?? '')
  const ids = (req.body?.ids ?? []) as string[]
  const payload = ((req.body?.payload ?? {}) as Record<string, unknown>)
  if (!['publish', 'draft', 'delete', 'tag', 'category'].includes(action)) {
    return err(res, 422, 'VALIDATION', '不支持的批量操作: ' + action)
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
    return err(res, 422, 'VALIDATION', 'ids 必须为 1-200 项的数组')
  }
  // 打标签：payload.tags 必须为非空字符串数组（空数组会清空已有标签，属危险误操作；非数组会在下游 500）
  if (action === 'tag') {
    const names = (payload as { tags?: unknown }).tags
    if (!Array.isArray(names) || names.length === 0 || names.some((n) => typeof n !== 'string' || !n.trim())) {
      return err(res, 422, 'VALIDATION', 'payload.tags 必须为非空字符串数组')
    }
  }
  if (action === 'category' && payload.categoryId !== undefined && payload.categoryId !== null && typeof payload.categoryId !== 'string') {
    return err(res, 422, 'VALIDATION', 'payload.categoryId 必须为字符串')
  }

  const targets = await prisma.post.findMany({ where: { id: { in: ids } } })
  if (!targets.length) return err(res, 404, 'NOT_FOUND', '未找到目标文章')

  if (action === 'delete') {
    // 先删 DB 再尽力删文件：DB 失败时内容仍在磁盘（反之文件先丢则内容不可恢复）；
    // 文件删除失败仅留下孤儿 md，不阻塞响应
    await prisma.post.deleteMany({ where: { id: { in: targets.map((p) => p.id) } } })
    for (const p of targets) {
      try {
        removePostFile(p.slug)
        removeRevisionDir(p.slug)
      } catch (e) {
        console.error('[posts/batch] remove file failed:', p.slug, e)
      }
      await removeSearchPost(p.slug)
    }
    return res.json({ ok: true, affected: targets.length })
  }

  let categoryName: string | null = null
  if (action === 'category') {
    const catId = String(payload.categoryId ?? '')
    if (catId) {
      const cat = await prisma.category.findUnique({ where: { id: catId } })
      if (!cat) return err(res, 422, 'VALIDATION', '分类不存在')
      categoryName = cat.name
    }
  }

  // 批量一致性：先"预计算"全部目标的新状态，再统一提交；
  // 中途任一步失败 → 逆序补偿已提交项回写入前快照（DB + 文件），避免部分成功/部分失败的数据分叉。
  interface Pending { p: Post; data: Record<string, unknown>; fm: Record<string, unknown>; oldTags?: Array<{ tagId: string }> }
  const pendings: Pending[] = []
  for (const p of targets) {
    const data: Record<string, unknown> = {}
    let fm: Record<string, unknown> = {}
    try { fm = JSON.parse(p.frontmatter || '{}') } catch { /* 畸形 frontmatter 忽略 */ }
    if (action === 'publish') {
      data.status = 'published'
      if (!p.publishedAt) data.publishedAt = new Date()
    } else if (action === 'draft') {
      data.status = 'draft'
    } else if (action === 'tag') {
      const names = (payload.tags as string[]) ?? []
      if (names.length) fm.tags = names
    } else if (action === 'category') {
      data.categoryId = payload.categoryId ? String(payload.categoryId) : null
      if (categoryName) fm.category = categoryName
      else delete fm.category
    }
    const oldTags =
      action === 'tag'
        ? await prisma.postTag.findMany({ where: { postId: p.id }, select: { tagId: true } })
        : undefined
    pendings.push({ p, data, fm, oldTags })
  }

  const committed: Pending[] = []
  try {
    for (const it of pendings) {
      if (action === 'tag') {
        await syncTags({ link: 'postTag', ownerId: it.p.id, names: (payload.tags as string[]) ?? [] })
      }
      await prisma.post.update({
        where: { id: it.p.id },
        data: { ...it.data, frontmatter: JSON.stringify(it.fm) },
      })
      // 文件随状态/元数据同步（保持真相源一致；tag 变更同样回写文件，防文件与 DB 分叉）
      writePostFile({
        slug: it.p.slug,
        title: it.p.title,
        rawMarkdown: it.p.rawMarkdown,
        frontmatter: JSON.stringify(it.fm),
        status: (it.data.status as string) ?? it.p.status,
        publishedAt: (it.data.publishedAt as Date | null) ?? it.p.publishedAt,
      })
      committed.push(it)
    }
  } catch (e) {
    // 补偿：把已提交项恢复到写入前快照
    for (const it of committed.reverse()) {
      try {
        await prisma.post.update({
          where: { id: it.p.id },
          data: {
            status: it.p.status,
            publishedAt: it.p.publishedAt,
            categoryId: it.p.categoryId,
            frontmatter: it.p.frontmatter,
          },
        })
        writePostFile(toFile(it.p))
        if (it.oldTags) {
          await prisma.postTag.deleteMany({ where: { postId: it.p.id } })
          for (const t of it.oldTags) await prisma.postTag.create({ data: { postId: it.p.id, tagId: t.tagId } }).catch(() => {})
        }
      } catch { /* 补偿尽力而为，不掩盖原始失败 */ }
    }
    throw e
  }
  // 状态/分类/标签变更后同步全文索引（草稿属性、分类名、标签参与检索）
  for (const p of targets) await indexSearchPost(p.id)
  logActivity(req, { action: action === 'publish' || action === 'draft' ? 'post_update' : 'post_update', object: `批量 ${action}（${targets.length} 篇）`, detail: { action, ids: targets.map((t) => t.id) } })
  if (action === 'publish') {
    for (const it of committed) void emitWebhookEvent('post.published', { post: { id: it.p.id, title: it.p.title, slug: it.p.slug } })
  }
  res.json({ ok: true, affected: targets.length })
}))

posts.put('/:id', ah(async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } })
  if (!post) return err(res, 404, 'NOT_FOUND', '文章不存在')

  const body = validateBody<{
    title?: string
    slug?: string
    summary?: string
    rawMarkdown?: string
    categoryId?: string
    tags?: string[]
    status?: string
    baseVersion?: number
    cover?: string
    revisionKind?: string
  }>(req, res, {
    title: { ...v.str(), min: 1, max: 200 },
    slug: { ...v.str(), min: 1, max: 120 },
    summary: { ...v.str(), keepEmpty: true },
    // 大文档防护：正文上限 100 万字符（配合 express.json 2MB 体积上限）
    rawMarkdown: { ...v.str(), max: 1_000_000 },
    categoryId: { ...v.str(), keepEmpty: true },
    tags: v.arr(v.str(), 0, 20),
    status: { ...v.str(), oneOf: ['draft', 'published'] },
    baseVersion: v.num(),
    cover: { ...v.str(), keepEmpty: true, max: 2000 },
    revisionKind: { ...v.str(), oneOf: ['manual', 'auto'] },
  })
  if (!body) return

  // slug 变更：唯一性预检（409），改名后同步文章文件与版本快照目录
  let newSlug: string | null = null
  if (body.slug !== undefined) {
    newSlug = slugify(body.slug)
    if (!newSlug) return err(res, 422, 'VALIDATION', 'slug 非法（仅字母数字与连字符）')
    if (newSlug !== post.slug) {
      const taken = await prisma.post.findFirst({ where: { slug: newSlug, NOT: { id: post.id } } })
      if (taken) return err(res, 409, 'CONFLICT', `slug「${newSlug}」已被其他文章使用`)
    } else {
      newSlug = null
    }
  }

  if (body.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: body.categoryId } })
    if (!cat) return err(res, 422, 'VALIDATION', '分类不存在')
  }

  const data: Record<string, unknown> = {}
  if (body.title !== undefined) data.title = body.title
  if (body.summary !== undefined) data.summary = body.summary
  if (body.rawMarkdown !== undefined) {
    data.rawMarkdown = body.rawMarkdown
    data.charCount = String(body.rawMarkdown).length
  }
  if (body.categoryId !== undefined) data.categoryId = body.categoryId || null

  const nowPublished = body.status === 'published' && post.status !== 'published'
  if (body.status !== undefined) {
    data.status = body.status
    if (nowPublished) data.publishedAt = new Date()
  }

  // frontmatter 同步：分类/标签变更时写回文件（博客端以文件 frontmatter 渲染）
  let fm: Record<string, unknown> = {}
  try {
    fm = JSON.parse(post.frontmatter || '{}')
  } catch { /* 回滚尽力而为 */ }
  if (body.categoryId !== undefined) {
    if (body.categoryId) {
      const cat = await prisma.category.findUnique({ where: { id: body.categoryId } })
      if (!cat) return err(res, 422, 'VALIDATION', '分类不存在')
      fm.category = cat.name
    } else {
      delete fm.category
    }
  }
  if (body.tags !== undefined) {
    if (body.tags.length) fm.tags = body.tags
    else delete fm.tags
  }
  // 封面：随保存写入 frontmatter（博客端/列表封面用）；空串清除
  if (body.cover !== undefined) {
    if (body.cover) fm.cover = body.cover
    else delete fm.cover
  }
  // 兜底：仅当本次请求未变更该字段时，收敛到 DB 当前状态（防止文件与索引分叉）
  if (body.categoryId === undefined && !fm.category && post.categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: post.categoryId } })
    if (cat) fm.category = cat.name
  }
  if (body.tags === undefined && !fm.tags && post.id) {
    const postTags = await prisma.postTag.findMany({
      where: { postId: post.id },
      include: { tag: true },
    })
    if (postTags.length) fm.tags = postTags.map((t) => t.tag.name)
  }
  const fmJson = JSON.stringify(fm)

  // 版本频控：手动保存每次都留快照；自动保存（默认）在距上次快照 2 分钟内不重复产生，避免历史爆炸
  const revisionKind = body.revisionKind ?? 'auto'
  const contentChanged = body.rawMarkdown !== undefined && body.rawMarkdown !== post.rawMarkdown
  let nextRev = 0
  if (contentChanged) {
    const last = await prisma.revision.findFirst({ where: { postId: post.id }, orderBy: { version: 'desc' } })
    const lastAt = last ? new Date(last.createdAt).getTime() : 0
    const shouldSnapshot = revisionKind === 'manual' || !last || Date.now() - lastAt > AUTO_REVISION_MIN_INTERVAL_MS
    if (shouldSnapshot) nextRev = (last?.version ?? 0) + 1
  }

  // 文件先落（真相源）：slug 变更时先改名资产，失败则整体不落
  if (newSlug) renamePostAssets(post.slug, newSlug)
  writePostFile({
    slug: newSlug ?? post.slug,
    title: (data.title as string) ?? post.title,
    rawMarkdown: (data.rawMarkdown as string) ?? post.rawMarkdown,
    frontmatter: fmJson,
    status: (data.status as string) ?? post.status,
    publishedAt: (data.publishedAt as Date | null) ?? post.publishedAt,
  })

  let updated: Post
  try {
    updated = await prisma.post.update({
      where:
        body.baseVersion !== undefined
          ? { id: post.id, updatedAt: new Date(body.baseVersion) }
          : { id: post.id },
      data: {
        ...data,
        ...(newSlug ? { slug: newSlug } : {}),
        frontmatter: fmJson,
        ...(nextRev ? { revisions: { create: { version: nextRev, kind: revisionKind } } } : {}),
      },
    })
  } catch (e) {
    // DB 提交失败/冲突：回滚文件到更新前，使元数据与文件一致停留在旧状态
    try {
      if (newSlug) renamePostAssets(newSlug, post.slug)
      writePostFile(toFile(post))
    } catch { /* 回滚尽力而为 */ }
    if (isP2025(e)) {
      if (body.baseVersion !== undefined) {
        const fresh = await prisma.post.findUnique({ where: { id: post.id } })
        if (fresh) {
          return err(res, 409, 'CONFLICT', '文章已被其他会话修改，请刷新后重试', { serverUpdatedAt: fresh.updatedAt })
        }
      }
      return err(res, 404, 'NOT_FOUND', '文章不存在')
    }
    throw e
  }

  if (body.tags !== undefined) await syncTags({ link: 'postTag', ownerId: post.id, names: body.tags })
  if (nextRev) {
    try {
      writeRevisionFile(newSlug ?? post.slug, nextRev, String(data.rawMarkdown))
    } catch (e) {
      // 快照文件写失败：补偿撤销刚提交的 revision 记录，避免"DB 有版本而文件缺失"的不一致
      await prisma.revision
        .delete({ where: { postId_version: { postId: post.id, version: nextRev } } })
        .catch(() => {})
      throw e
    }
  }
  // slug 变更：先清旧索引条目，再按新 slug 重建，防止孤儿索引
  if (newSlug) await removeSearchPost(post.slug)
  await indexSearchPost(post.id) // 正文/元数据变更后同步全文索引
  res.json({ ok: true, status: updated.status, slug: updated.slug, updatedAt: updated.updatedAt })
}))

posts.delete('/:id', ah(async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } })
  if (!post) return err(res, 404, 'NOT_FOUND', '文章不存在')
  // 先删 DB 再尽力删文件：DB 失败时正文仍在磁盘（文件先丢则不可恢复）；文件删除失败仅留孤儿 md
  await prisma.post.delete({ where: { id: post.id } })
  try {
    removePostFile(post.slug)
    removeRevisionDir(post.slug)
  } catch (e) {
    console.error('[posts/delete] remove file failed:', post.slug, e)
  }
  await removeSearchPost(post.slug)
  logActivity(req, { action: 'post_delete', object: post.title, target: post.id, result: 'ok' })
  void emitWebhookEvent('post.deleted', { post: { id: post.id, title: post.title, slug: post.slug } })
  res.json({ ok: true })
}))

/* ===== 版本历史 ===== */

posts.get('/:id/revisions', ah(async (req, res) => {
  const items = await prisma.revision.findMany({
    where: { postId: req.params.id },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, summary: true, kind: true, createdAt: true },
  })
  res.json({ items })
}))

posts.get('/:id/revisions/:vid', ah(async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } })
  const rev = await prisma.revision.findFirst({
    where: { postId: req.params.id, version: Number(req.params.vid) },
  })
  if (!post || !rev) return err(res, 404, 'NOT_FOUND', '版本不存在')
  const content = readRevisionFile(post.slug, rev.version)
  res.json({ ...rev, content })
}))

posts.post('/:id/revisions/:vid/restore', ah(async (req, res) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } })
  const rev = await prisma.revision.findFirst({
    where: { postId: req.params.id, version: Number(req.params.vid) },
  })
  if (!post || !rev) return err(res, 404, 'NOT_FOUND', '文章或版本不存在')
  const content = readRevisionFile(post.slug, rev.version)
  if (content === null) return err(res, 404, 'NOT_FOUND', '版本正文不存在')

  const last = await prisma.revision.findFirst({ where: { postId: post.id }, orderBy: { version: 'desc' } })
  const version = (last?.version ?? 0) + 1

  writePostFile({ slug: post.slug, title: post.title, rawMarkdown: content, frontmatter: post.frontmatter, status: post.status, publishedAt: post.publishedAt })
  try {
    await prisma.post.update({
      where: { id: post.id },
      data: { rawMarkdown: content, charCount: content.length, revisions: { create: { version, kind: 'manual' } } },
    })
  } catch (e) {
    try {
      writePostFile(toFile(post))
    } catch { /* 回滚尽力而为 */ }
    throw e
  }
  writeRevisionFile(post.slug, version, content)
  await indexSearchPost(post.id) // 恢复后同步全文索引
  logActivity(req, { action: 'post_restore', object: post.title, target: post.id, detail: { fromVersion: rev.version, toVersion: version } })
  res.json({ ok: true })
}))