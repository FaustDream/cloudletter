/**
 * 设置路由（V2）。白名单分组合并落库 + 写入站点配置文件。
 * 分组：appearance / layout / content / reading / interaction / schedule / site（站点自定义中心）。
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { writeSettingsFile } from '../content'
import { logActivity } from '../services/activity'

export const settings = Router()
settings.use(requireAuth)

const ALLOWED_SETTING_GROUPS = [
  'appearance', 'layout', 'content', 'reading', 'interaction', 'schedule',
  'site', // 站点自定义中心：名称/Logo/favicon/字体/主色/背景/布局/动画/卡片/按钮/间距/圆角/阴影/自定义 CSS
] as const
const MAX_JSON = 100_000

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
  const changed: string[] = []
  for (const g of ALLOWED_SETTING_GROUPS) {
    if (body[g] !== undefined && typeof body[g] === 'object' && body[g] !== null) {
      // 体积护栏：单分组过大直接拒绝（防异常注入拖垮站点配置）
      const size = JSON.stringify(body[g]).length
      if (size > MAX_JSON) return err(res, 422, 'VALIDATION', `分组 ${g} 配置体积超出上限`)
      merged[g] = body[g]
      changed.push(g)
    }
  }
  const value = JSON.stringify(merged)
  await prisma.siteSetting.upsert({
    where: { key: 'global' },
    update: { value },
    create: { key: 'global', value },
  })
  writeSettingsFile(value)
  if (changed.length) {
    logActivity(req, { action: 'site_config', object: '站点设置', detail: { groups: changed } })
  }
  res.json({ ok: true })
}))