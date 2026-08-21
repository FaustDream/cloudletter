/**
 * /api/v2/* 路由（§6 API 契约）
 * 错误包络：{ error: { code, message, details } }
 * 错误码：AUTH_REQUIRED 401 / FORBIDDEN 403 / VALIDATION 422 / CONFLICT 409 / NOT_FOUND 404 / BUILD_FAILED 500
 * 绞杀者模式（§6.3）：旧 admin/server.cjs 端点不动，本路由并行接管。
 */
import { Router, type Request, type Response, type NextFunction } from 'express'
import type { Post } from '@prisma/client'
import { prisma } from '../prisma'
import {
  consumeTempToken,
  createSession,
  issueTempToken,
  requireAuth,
  requireRole,
} from '../middleware/auth'
import { createAuthRateLimiter } from '../middleware/rate-limit'
import { validateBody, v } from '../middleware/validate'
import {
  generateTOTPSecret,
  hashPassword,
  otpauthUrl,
  verifyPassword,
  verifyTOTP,
} from '../crypto'
import { audit } from '../services/audit'
import { createBackup, listBackups, rollback } from '../services/backup'
import { getBuild, triggerBuild } from '../services/build'
import { removePostFile, slugify, writePostFile, writeSettingsFile } from '../services/sync'

export const v2 = Router()

function err(res: Response, status: number, code: string, message: string, details: unknown = null): void {
  res.status(status).json({ error: { code, message, details } })
}

function publicUser(u: { id: string; email: string; role: string; totpEnabled: boolean }) {
  return { id: u.id, email: u.email, role: u.role, totpEnabled: u.totpEnabled }
}

// 🔴B2 认证限流：5 分钟 5 次失败锁定 15 分钟（IP + 账户双维度）
const authLimiter = createAuthRateLimiter({ windowMs: 5 * 60 * 1000, max: 5, lockMs: 15 * 60 * 1000 })
const twoFaLimiter = createAuthRateLimiter({ windowMs: 5 * 60 * 1000, max: 5, lockMs: 15 * 60 * 1000 })

/* ========== 认证（§6.1） ========== */

v2.post('/auth/login', authLimiter, async (req: Request, res: Response) => {
  // 🟡S1 zod 目标 → 轻量校验层：必填 + 类型
  const body = validateBody<{ email: string; password: string }>(
    req,
    res,
    { email: v.str(), password: v.str() },
  )
  if (!body) return
  const { email, password } = body
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await audit(null, 'login.failed', { email })
    return err(res, 401, 'AUTH_REQUIRED', '无效凭证')
  }
  if (user.totpEnabled) {
    // §6.1：开2FA的账户返回 challenge + tempToken，走二次验证
    return res.status(423).json({ challenge: '2fa', tempToken: issueTempToken(user.id) })
  }
  const { token } = await createSession(user.id)
  await audit(user.id, 'login', { email })
  res.json({ token, user: publicUser(user) })
})

v2.post('/auth/verify-2fa', twoFaLimiter, async (req: Request, res: Response) => {
  const { tempToken, code } = req.body ?? {}
  const userId = consumeTempToken(tempToken)
  if (!userId) return err(res, 401, 'AUTH_REQUIRED', '临时凭证无效或已过期')
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !verifyTOTP(code, user.totpSecret ?? '')) {
    await audit(userId, 'login.2fa.failed', {})
    return err(res, 401, 'AUTH_REQUIRED', '2FA 验证码错误')
  }
  const { token } = await createSession(user.id)
  await audit(user.id, 'login', { email: user.email, twoFactor: true })
  res.json({ token, user: publicUser(user) })
})

v2.get('/auth/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user })
})

v2.post('/auth/logout', requireAuth, async (req: Request, res: Response) => {
  const token = (req.headers.authorization ?? '').slice(7).trim()
  await prisma.session.deleteMany({ where: { token } })
  res.json({ ok: true })
})

// 💭N1 修复：setup-2fa 不再把 secret 落库（用户放弃启用会留下游离密钥）。
// secret 仅存内存，enable 验证通过后才持久化；进程重启即失效（需重新 setup，可接受）。
const pending2fa = new Map<string, string>()

v2.post('/auth/setup-2fa', requireAuth, async (req: Request, res: Response) => {
  const { hex, base32 } = generateTOTPSecret()
  pending2fa.set(req.user!.id, hex)
  res.json({ otpauthUrl: otpauthUrl(base32, req.user!.email), secret: base32 })
})

v2.post('/auth/enable-2fa', requireAuth, async (req: Request, res: Response) => {
  const { code } = req.body ?? {}
  const secret = pending2fa.get(req.user!.id)
  if (!secret) return err(res, 422, 'VALIDATION', '请先调用 setup-2fa 生成密钥')
  if (!verifyTOTP(code, secret)) return err(res, 401, 'AUTH_REQUIRED', '验证码错误')
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { totpEnabled: true, totpSecret: secret },
  })
  pending2fa.delete(req.user!.id)
  await audit(req.user!.id, '2fa.enable', {})
  res.json({ ok: true })
})

v2.post('/auth/disable-2fa', requireAuth, async (req: Request, res: Response) => {
  const { code } = req.body ?? {}
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user?.totpEnabled) return err(res, 422, 'VALIDATION', '未启用 2FA')
  if (!verifyTOTP(code, user.totpSecret ?? '')) return err(res, 401, 'AUTH_REQUIRED', '验证码错误')
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null } })
  await audit(user.id, '2fa.disable', {})
  res.json({ ok: true })
})

/* ========== 内容 · 文章（§6.2） ========== */

v2.get('/posts', requireAuth, requireRole('viewer'), async (req: Request, res: Response) => {
  const { type, status, folderId, tag, q } = req.query
  const where: Record<string, unknown> = {}
  if (type) where.type = type
  if (status) where.status = status
  if (folderId) where.folderId = folderId
  if (tag) where.tags = { some: { tag: { name: String(tag) } } }
  if (q) where.OR = [{ title: { contains: String(q) } }, { rawMarkdown: { contains: String(q) } }]
  const [items, total] = await Promise.all([
    prisma.post.findMany({
      where,
      select: { id: true, slug: true, title: true, status: true, type: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.post.count({ where }),
  ])
  res.json({ items, total })
})

v2.post('/posts', requireAuth, requireRole('author'), async (req: Request, res: Response) => {
  // 🟡S1 轻量校验层：title/type 必填、type 枚举、status 枚举、类型约束
  const body = validateBody<{
    type: string
    title: string
    folderId?: string
    categoryId?: string
    rawMarkdown?: string
    frontmatter?: Record<string, unknown>
    status?: string
  }>(
    req,
    res,
    {
      type: { ...v.str(), required: true, oneOf: ['blog', 'note'] },
      title: { ...v.str(), required: true, min: 1, max: 200 },
      folderId: v.str(),
      categoryId: v.str(),
      rawMarkdown: v.str(),
      frontmatter: v.obj(),
      status: { ...v.str(), oneOf: ['draft', 'published', 'trashed'] },
    },
  )
  if (!body) return
  const { type, title, folderId, categoryId, rawMarkdown, frontmatter, status } = body

  const fmSlug = frontmatter && typeof frontmatter.slug === 'string' ? frontmatter.slug : ''
  let slug = slugify(fmSlug || title)
  const exists = await prisma.post.findUnique({ where: { slug } })
  if (exists) slug = `${slug}-${Date.now().toString(36)}` // §6.2 slug 唯一，冲突加后缀

  const st = status === 'published' ? 'published' : 'draft'
  const post = await prisma.post.create({
    data: {
      slug,
      type,
      title,
      rawMarkdown: rawMarkdown ?? '',
      frontmatter: JSON.stringify(frontmatter ?? {}),
      status: st,
      folderId: folderId || null,
      categoryId: categoryId || null,
      publishedAt: st === 'published' ? new Date() : null,
    },
  })
  // 版本快照 v1
  await prisma.revision.create({ data: { postId: post.id, version: 1, rawMarkdown: post.rawMarkdown } })
  writePostFile(post)
  await audit(req.user!.id, 'post.create', { id: post.id, slug: post.slug, status: st })

  let buildId: string | null = null
  if (st === 'published') buildId = triggerBuild(req.user!.id, `post.create:${post.slug}`).id
  res.json({ id: post.id, slug: post.slug, status: post.status, buildId })
})

v2.get('/posts/:id', requireAuth, requireRole('viewer'), async (req: Request, res: Response) => {
  const post = await prisma.post.findUnique({
    where: { id: req.params.id },
    include: { tags: { include: { tag: true } }, folder: true, category: true },
  })
  if (!post) return err(res, 404, 'NOT_FOUND', '文章不存在')
  res.json({ ...post, tags: post.tags.map((t) => t.tag.name) })
})

v2.put('/posts/:id', requireAuth, requireRole('author'), async (req: Request, res: Response) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } })
  if (!post) return err(res, 404, 'NOT_FOUND', '文章不存在')

  // 🟡S1 轻量校验层：可更新字段的类型/枚举/长度
  const body = validateBody<{
    title?: string
    rawMarkdown?: string
    folderId?: string | null
    categoryId?: string | null
    frontmatter?: Record<string, unknown>
    status?: string
    baseVersion?: number
  }>(
    req,
    res,
    {
      title: { ...v.str(), min: 1, max: 200 },
      rawMarkdown: v.str(),
      folderId: v.str(),
      categoryId: v.str(),
      frontmatter: v.obj(),
      status: { ...v.str(), oneOf: ['draft', 'published', 'trashed'] },
      baseVersion: v.num(),
    },
  )
  if (!body) return

  // §14 保存冲突：baseVersion( updatedAt epoch ms ) 通过 Prisma where 做原子乐观锁
  // （🔴→🟡S3 修复：不再用"先查后比"的 TOCTOU 窗口，直接把 updatedAt 放进 where）
  const baseVersion = body.baseVersion
  const data: Record<string, unknown> = {}
  if (body.title !== undefined) data.title = body.title
  if (body.rawMarkdown !== undefined) data.rawMarkdown = body.rawMarkdown
  if (body.folderId !== undefined) data.folderId = body.folderId || null
  if (body.categoryId !== undefined) data.categoryId = body.categoryId || null
  if (body.frontmatter !== undefined) data.frontmatter = JSON.stringify(body.frontmatter)

  const nowPublished = body.status === 'published' && post.status !== 'published'
  if (body.status !== undefined) {
    data.status = body.status
    if (nowPublished) data.publishedAt = new Date()
  }

  let updated: Post
  if (baseVersion !== undefined) {
    // 乐观锁：命中 0 行（updatedAt 已被别人改过）即返回 409
    const base = new Date(baseVersion)
    const rows = await prisma.post.updateMany({
      where: { id: post.id, updatedAt: base },
      data,
    })
    if (rows.count === 0) {
      const fresh = await prisma.post.findUnique({ where: { id: post.id } })
      return err(res, 409, 'CONFLICT', '文章已被其他会话修改，请刷新后重试', {
        serverUpdatedAt: fresh?.updatedAt ?? null,
      })
    }
    // updateMany 命中后该行必然存在
    updated = (await prisma.post.findUnique({ where: { id: post.id } }))!
  } else {
    updated = await prisma.post.update({ where: { id: post.id }, data })
  }

  // 版本快照：正文变更时递增
  if (data.rawMarkdown !== undefined && data.rawMarkdown !== post.rawMarkdown) {
    const last = await prisma.revision.findFirst({ where: { postId: post.id }, orderBy: { version: 'desc' } })
    await prisma.revision.create({
      data: { postId: post.id, version: (last?.version ?? 0) + 1, rawMarkdown: String(data.rawMarkdown) },
    })
  }

  if (data.status === 'trashed') removePostFile(updated)
  else writePostFile(updated)
  await audit(req.user!.id, 'post.update', { id: post.id, status: updated.status })

  let buildId: string | null = null
  if (nowPublished || (data.rawMarkdown !== undefined && updated.status === 'published')) {
    buildId = triggerBuild(req.user!.id, `post.update:${updated.slug}`).id
  }
  res.json({ ok: true, status: updated.status, updatedAt: updated.updatedAt, buildId })
})

v2.delete('/posts/:id', requireAuth, requireRole('author'), async (req: Request, res: Response) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } })
  if (!post) return err(res, 404, 'NOT_FOUND', '文章不存在')
  const updated = await prisma.post.update({ where: { id: post.id }, data: { status: 'trashed' } })
  removePostFile(updated)
  await audit(req.user!.id, 'post.trash', { id: post.id, slug: post.slug })
  res.json({ ok: true })
})

v2.post('/posts/:id/restore', requireAuth, requireRole('author'), async (req: Request, res: Response) => {
  const post = await prisma.post.findUnique({ where: { id: req.params.id } })
  if (!post) return err(res, 404, 'NOT_FOUND', '文章不存在')
  const updated = await prisma.post.update({
    where: { id: post.id },
    data: { status: 'draft', publishedAt: null },
  })
  writePostFile(updated)
  await audit(req.user!.id, 'post.restore', { id: post.id })
  res.json({ ok: true })
})

/* ========== 版本快照（§6.3） ========== */

v2.get('/posts/:id/revisions', requireAuth, requireRole('viewer'), async (req: Request, res: Response) => {
  const revisions = await prisma.revision.findMany({
    where: { postId: req.params.id },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, createdAt: true },
  })
  res.json({ items: revisions })
})

v2.get('/posts/:id/revisions/:vid', requireAuth, requireRole('viewer'), async (req: Request, res: Response) => {
  const rev = await prisma.revision.findFirst({
    where: { postId: req.params.id, version: Number(req.params.vid) },
  })
  if (!rev) return err(res, 404, 'NOT_FOUND', '版本不存在')
  res.json(rev)
})

v2.post('/posts/:id/revisions/:vid/restore', requireAuth, requireRole('author'), async (req: Request, res: Response) => {
  const rev = await prisma.revision.findFirst({
    where: { postId: req.params.id, version: Number(req.params.vid) },
  })
  const post = await prisma.post.findUnique({ where: { id: req.params.id } })
  if (!rev || !post) return err(res, 404, 'NOT_FOUND', '文章或版本不存在')
  const last = await prisma.revision.findFirst({ where: { postId: post.id }, orderBy: { version: 'desc' } })
  await prisma.revision.create({ data: { postId: post.id, version: (last?.version ?? 0) + 1, rawMarkdown: rev.rawMarkdown } })
  const updated = await prisma.post.update({ where: { id: post.id }, data: { rawMarkdown: rev.rawMarkdown } })
  writePostFile(updated)
  await audit(req.user!.id, 'post.revision.restore', { id: post.id, version: Number(req.params.vid) })
  res.json({ ok: true })
})

/* ========== 知识库文件夹树（§6.2，物化路径） ========== */

function buildTree(folders: { id: string; name: string; parentId: string | null; path: string }[]): unknown[] {
  const byParent = new Map<string | null, typeof folders>()
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? []
    list.push(f)
    byParent.set(f.parentId, list)
  }
  const attach = (parentId: string | null): unknown[] =>
    (byParent.get(parentId) ?? []).map((f) => ({ ...f, children: attach(f.id) }))
  return attach(null)
}

v2.get('/folders', requireAuth, requireRole('viewer'), async (_req: Request, res: Response) => {
  const folders = await prisma.folder.findMany({ orderBy: { path: 'asc' } })
  res.json({ tree: buildTree(folders) })
})

v2.post('/folders', requireAuth, requireRole('editor'), async (req: Request, res: Response) => {
  // 🟡S1 轻量校验层
  const body = validateBody<{ name: string; parentId?: string }>(req, res, {
    name: { ...v.str(), required: true, min: 1, max: 100 },
    parentId: v.str(),
  })
  if (!body) return
  const { name, parentId } = body
  let parentPath = ''
  if (parentId) {
    const parent = await prisma.folder.findUnique({ where: { id: parentId } })
    if (!parent) return err(res, 404, 'NOT_FOUND', '父文件夹不存在')
    parentPath = parent.path
  }
  const folder = await prisma.folder.create({
    data: { name, parentId: parentId || null, path: `${parentPath}/${slugify(name)}` },
  })
  await audit(req.user!.id, 'folder.create', { id: folder.id, path: folder.path })
  res.json({ id: folder.id, path: folder.path })
})

v2.put('/folders/:id', requireAuth, requireRole('editor'), async (req: Request, res: Response) => {
  const folder = await prisma.folder.findUnique({ where: { id: req.params.id } })
  if (!folder) return err(res, 404, 'NOT_FOUND', '文件夹不存在')
  const { name, parentId } = req.body ?? {}

  // 禁止移动到自身子树下
  if (parentId) {
    let p: { id: string; parentId: string | null } | null = await prisma.folder.findUnique({ where: { id: parentId } })
    while (p) {
      if (p.id === folder.id) return err(res, 422, 'VALIDATION', '不能移动到自身或其子文件夹下')
      p = p.parentId ? await prisma.folder.findUnique({ where: { id: p.parentId } }) : null
    }
  }

  let newPath = folder.path
  if (name !== undefined && name !== folder.name) {
    newPath = `${folder.path.slice(0, folder.path.lastIndexOf('/') + 1)}${slugify(name)}`
  }
  if (parentId !== undefined && (parentId || null) !== folder.parentId) {
    const parent = parentId ? await prisma.folder.findUnique({ where: { id: parentId } }) : null
    const newName = name !== undefined ? slugify(name) : folder.path.slice(folder.path.lastIndexOf('/') + 1)
    newPath = `${parent ? parent.path : ''}/${newName}`
  }

  const updated = await prisma.folder.update({
    where: { id: folder.id },
    data: { name: name ?? folder.name, parentId: parentId !== undefined ? parentId || null : folder.parentId, path: newPath },
  })

  // 级联更新子节点物化路径
  const descendants = await prisma.folder.findMany({ where: { path: { startsWith: folder.path + '/' } } })
  for (const d of descendants) {
    await prisma.folder.update({
      where: { id: d.id },
      data: { path: newPath + d.path.slice(folder.path.length) },
    })
  }
  await audit(req.user!.id, 'folder.update', { id: folder.id, path: newPath })
  res.json({ ok: true, path: newPath })
})

v2.delete('/folders/:id', requireAuth, requireRole('editor'), async (req: Request, res: Response) => {
  const folder = await prisma.folder.findUnique({ where: { id: req.params.id } })
  if (!folder) return err(res, 404, 'NOT_FOUND', '文件夹不存在')
  // §6.2：子文件夹与其中笔记全部移入回收站
  const descendants = await prisma.folder.findMany({ where: { path: { startsWith: folder.path + '/' } } })
  const ids = [folder.id, ...descendants.map((d) => d.id)]
  await prisma.post.updateMany({ where: { folderId: { in: ids } }, data: { status: 'trashed' } })
  const trashed = await prisma.post.findMany({ where: { folderId: { in: ids } } })
  for (const p of trashed) removePostFile(p)
  await prisma.folder.deleteMany({ where: { id: { in: ids } } })
  await audit(req.user!.id, 'folder.delete', { id: folder.id, path: folder.path, movedPosts: trashed.length })
  res.json({ ok: true })
})

/* ========== 分类 / 标签（§6.2） ========== */

v2.get('/categories', requireAuth, requireRole('viewer'), async (_req: Request, res: Response) => {
  const categories = await prisma.category.findMany({ include: { _count: { select: { posts: true } } } })
  res.json({ items: categories })
})

v2.post('/categories', requireAuth, requireRole('editor'), async (req: Request, res: Response) => {
  // 🟡S1 轻量校验层
  const body = validateBody<{ name: string; description?: string }>(req, res, {
    name: { ...v.str(), required: true, min: 1, max: 50 },
    description: v.str(),
  })
  if (!body) return
  const { name, description } = body
  const exists = await prisma.category.findUnique({ where: { slug: slugify(name) } })
  if (exists) return err(res, 409, 'CONFLICT', '同名分类已存在')
  const c = await prisma.category.create({ data: { name, slug: slugify(name), description } })
  await audit(req.user!.id, 'category.create', { id: c.id })
  res.json(c)
})

v2.put('/categories/:id', requireAuth, requireRole('editor'), async (req: Request, res: Response) => {
  const c = await prisma.category.findUnique({ where: { id: req.params.id } })
  if (!c) return err(res, 404, 'NOT_FOUND', '分类不存在')
  const updated = await prisma.category.update({
    where: { id: c.id },
    data: { name: req.body?.name ?? c.name, description: req.body?.description ?? c.description },
  })
  res.json(updated)
})

v2.delete('/categories/:id', requireAuth, requireRole('editor'), async (req: Request, res: Response) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } })
  } catch {
    return err(res, 404, 'NOT_FOUND', '分类不存在')
  }
  res.json({ ok: true })
})

v2.get('/tags', requireAuth, requireRole('viewer'), async (_req: Request, res: Response) => {
  const tags = await prisma.tag.findMany({ include: { _count: { select: { posts: true } } } })
  res.json({ items: tags })
})

v2.post('/tags', requireAuth, requireRole('editor'), async (req: Request, res: Response) => {
  // 🟡S1 轻量校验层
  const body = validateBody<{ name: string }>(req, res, { name: { ...v.str(), required: true, min: 1, max: 50 } })
  if (!body) return
  const { name } = body
  const exists = await prisma.tag.findUnique({ where: { name } })
  if (exists) return err(res, 409, 'CONFLICT', '同名标签已存在')
  const t = await prisma.tag.create({ data: { name, slug: slugify(name) } })
  res.json(t)
})

v2.delete('/tags/:id', requireAuth, requireRole('editor'), async (req: Request, res: Response) => {
  try {
    await prisma.tag.delete({ where: { id: req.params.id } })
  } catch {
    return err(res, 404, 'NOT_FOUND', '标签不存在')
  }
  res.json({ ok: true })
})

/* ========== 设置（§6.3 / §9） ========== */

v2.get('/settings', requireAuth, requireRole('viewer'), async (_req: Request, res: Response) => {
  const s = await prisma.siteSetting.findUnique({ where: { id: 'global' } })
  res.json(s ? JSON.parse(s.value) : {})
})

// 🟡S1 修复：/settings 仅接受五个已知分组，未知分组/键直接拒绝，避免任意键注入
const ALLOWED_SETTING_GROUPS = ['appearance', 'layout', 'content', 'reading', 'interaction'] as const

v2.put('/settings', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const incomingKeys = Object.keys(body)
  const invalidKeys = incomingKeys.filter((k) => !ALLOWED_SETTING_GROUPS.includes(k as never))
  if (invalidKeys.length) {
    return err(res, 422, 'VALIDATION', `不支持的设置分组: ${invalidKeys.join(', ')}`)
  }

  const current = await prisma.siteSetting.findUnique({ where: { id: 'global' } })
  const merged: Record<string, unknown> = current ? JSON.parse(current.value) : {}
  for (const g of ALLOWED_SETTING_GROUPS) {
    if (body[g] !== undefined && typeof body[g] === 'object' && body[g] !== null) {
      // 仅允许对象分组；标量/数组直接忽略（防御未知形状）
      merged[g] = body[g]
    }
  }
  const value = JSON.stringify(merged)
  await prisma.siteSetting.upsert({
    where: { id: 'global' },
    update: { value },
    create: { id: 'global', value },
  })
  writeSettingsFile(value)
  await audit(req.user!.id, 'settings.update', { keys: incomingKeys })
  const build = triggerBuild(req.user!.id, 'settings.update')
  res.json({ ok: true, buildId: build.id })
})

/* ========== 构建（§6.3） ========== */

v2.post('/build', requireAuth, requireRole('editor'), (req: Request, res: Response) => {
  const job = triggerBuild(req.user!.id, 'manual')
  res.json({ buildId: job.id, status: job.status })
})

v2.get('/build/:id', requireAuth, requireRole('viewer'), (req: Request, res: Response) => {
  const job = getBuild(req.params.id)
  if (!job) return err(res, 404, 'NOT_FOUND', '构建任务不存在')
  res.json(job)
})

/* ========== 系统（§6.3） ========== */

v2.get('/monitor', requireAuth, requireRole('viewer'), async (_req: Request, res: Response) => {
  const [posts, published, drafts, trashed, users, sessions] = await Promise.all([
    prisma.post.count(),
    prisma.post.count({ where: { status: 'published' } }),
    prisma.post.count({ where: { status: 'draft' } }),
    prisma.post.count({ where: { status: 'trashed' } }),
    prisma.user.count(),
    prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
  ])
  res.json({
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    posts: { total: posts, published, drafts, trashed },
    users,
    activeSessions: sessions,
    time: new Date().toISOString(),
  })
})

v2.get('/audit', requireAuth, requireRole('viewer'), async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(100, Number(req.query.size) || 20)
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * size,
      take: size,
      include: { user: { select: { email: true } } },
    }),
    prisma.auditLog.count(),
  ])
  res.json({ items, total, page, size })
})

v2.get('/stats', requireAuth, requireRole('viewer'), async (_req: Request, res: Response) => {
  const byType = await prisma.post.groupBy({ by: ['type'], _count: true, where: { status: 'published' } })
  const byCategory = await prisma.post.groupBy({
    by: ['categoryId'],
    _count: true,
    where: { status: 'published' },
  })
  res.json({ byType, byCategory })
})

v2.post('/auth/password', requireAuth, authLimiter, async (req: Request, res: Response) => {
  const { oldPassword, newPassword } = req.body ?? {}
  if (!oldPassword || !newPassword) return err(res, 422, 'VALIDATION', 'oldPassword/newPassword 必填')
  if (String(newPassword).length < 8) return err(res, 422, 'VALIDATION', '新密码至少 8 位')
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
  if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
    return err(res, 401, 'AUTH_REQUIRED', '旧密码错误')
  }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(newPassword) } })
  // 修改密码后撤销其他会话
  await prisma.session.deleteMany({ where: { userId: user.id } })
  await audit(user.id, 'password.change', {})
  res.json({ ok: true })
})

/* ========== 备份 / 回滚（§11 运维硬化：每日备份 + 一键回滚） ========== */

v2.get('/backup', requireAuth, requireRole('admin'), async (_req: Request, res: Response) => {
  res.json({ items: await listBackups() })
})

v2.post('/backup', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  const r = await createBackup(req.user!.id)
  res.json({ ok: true, ...r })
})

v2.post('/backup/:name/rollback', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const r = await rollback(req.params.name, req.user!.id)
    res.json(r)
  } catch (e) {
    return err(res, 404, 'NOT_FOUND', (e as Error).message)
  }
})

/* ========== 🔴B1 异步错误统一捕获 ========== */

/**
 * Express 4 不会把 async handler 的 rejected promise 转发给错误中间件。
 * 遍历本 router 已注册的所有 route layer，把每个 handler 包一层
 * `Promise.resolve(fn(...)).catch(next)`，使任何 await 抛错都进入 index.ts 的错误中间件。
 * 兼容 4 参数错误中间件（跳过）与 middleware 数组（递归展开）。
 */
function wrapAsyncRouter(router: ReturnType<typeof Router>): void {
  const stack: Array<{ route?: { stack: Array<{ handle: unknown; route?: unknown }> }; handle?: unknown }> = (
    router as unknown as { stack: Array<{ route?: { stack: Array<{ handle: unknown }> }; handle?: unknown }> }
  ).stack

  for (const layer of stack) {
    if (layer.route && Array.isArray(layer.route.stack)) {
      for (const sub of layer.route.stack) {
        const orig = sub.handle as unknown
        if (typeof orig !== 'function') continue
        // 4 参数是错误中间件，跳过
        if (orig.length >= 4) continue
        sub.handle = ((...args: unknown[]) => {
          const next = args[args.length - 1] as NextFunction
          try {
            const r = (orig as (...a: unknown[]) => unknown)(...args)
            if (r instanceof Promise) r.catch((e) => next(e))
          } catch (e) {
            next(e as Error)
          }
        }) as never
      }
    }
  }
}

wrapAsyncRouter(v2)
