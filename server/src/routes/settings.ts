/**
 * 设置路由（V2）。白名单分组合并落库 + 写入 fuwari 配置入口（Phase 2 可细化）。
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { writeSettingsFile } from '../content'

export const settings = Router()
settings.use(requireAuth)

const ALLOWED_SETTING_GROUPS = ['appearance', 'layout', 'content', 'reading', 'interaction'] as const

settings.get('/', ah(async (_req, res) => {
  const s = await prisma.siteSetting.findUnique({ where: { key: 'global' } })
  res.json(s ? JSON.parse(s.value) : {})
}))

settings.put('/', ah(async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const incomingKeys = Object.keys(body)
  const invalidKeys = incomingKeys.filter((k) => !ALLOWED_SETTING_GROUPS.includes(k as never))
  if (invalidKeys.length) {
    return err(res, 422, 'VALIDATION', `不支持的设置分组: ${invalidKeys.join(', ')}`)
  }

  const current = await prisma.siteSetting.findUnique({ where: { key: 'global' } })
  const merged: Record<string, unknown> = current ? JSON.parse(current.value) : {}
  for (const g of ALLOWED_SETTING_GROUPS) {
    if (body[g] !== undefined && typeof body[g] === 'object' && body[g] !== null) {
      merged[g] = body[g]
    }
  }
  const value = JSON.stringify(merged)
  await prisma.siteSetting.upsert({
    where: { key: 'global' },
    update: { value },
    create: { key: 'global', value },
  })
  writeSettingsFile(value)
  res.json({ ok: true })
}))