/**
 * 活动日志路由（隐私与安全）：
 * - GET /activity  分页查询（类型过滤）
 * - POST /activity/export  导出活动日志 JSON（登录日志/操作日志/安全日志/重大事件）
 * - POST /activity/import  导入活动日志（仅合并追加，不与业务数据冲突——与「数据与存储」的业务导入职责分离）
 * 日志只读/追加，不提供更新与删除接口。
 */
import { Router } from 'express'
import { prisma } from '../prisma'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'
import { listActivity, logActivity, ACTION_LABELS } from '../services/activity'

export const activity = Router()
activity.use(requireAuth)

activity.get('/', ah(async (_req, res) => {
  const q = _req.query as Record<string, string | undefined>
  const action = String(q.action ?? '').slice(0, 40)
  const page = Number(q.page) || 1
  const size = Number(q.size) || 40
  const data = await listActivity({ action: action || undefined, page, size })
  res.json({ ...data, labels: ACTION_LABELS })
}))

/** 活动日志导出（JSON 文件）：登录日志/操作日志/安全日志/重大事件日志 */
activity.post('/export', ah(async (_req, res) => {
  const rows = await prisma.activityLog.findMany({ orderBy: { createdAt: 'asc' } })
  const bundle = {
    kind: 'cloudletter.activity-log',
    exportedAt: new Date().toISOString(),
    total: rows.length,
    logs: rows.map((r) => ({
      at: r.createdAt.toISOString(), action: r.action, object: r.object, target: r.target,
      result: r.result, detail: r.detail, client: r.client, ip: r.ip,
    })),
  }
  logActivity(_req, { action: 'log_export', object: '活动日志', detail: { total: rows.length } })
  res.json(bundle)
}))

/** 活动日志导入：只合并追加（幂等：同 id 跳过），不覆盖、可回滚（导入内容可整体删除由用户自行决定） */
activity.post('/import', ah(async (_req, res) => {
  const b = (_req.body ?? {}) as { bundle?: unknown }
  const bundle = b.bundle as { kind?: string; logs?: Array<{ id?: string; at?: string; action?: string; object?: string; target?: string; result?: string; detail?: string; client?: string; ip?: string }> } | null
  if (!bundle || bundle.kind !== 'cloudletter.activity-log' || !Array.isArray(bundle.logs)) {
    return err(res, 422, 'VALIDATION', '文件格式不正确（缺少 kind=cloudletter.activity-log 或 logs 数组）')
  }
  if (bundle.logs.length > 20_000) return err(res, 422, 'VALIDATION', '单次导入日志数量超出上限（20000）')
  const existing = new Set((await prisma.activityLog.findMany({ select: { id: true } })).map((x) => x.id))
  let added = 0
  for (const l of bundle.logs) {
    if (!l?.action) continue
    if (l.id && existing.has(l.id)) continue
    try {
      await prisma.activityLog.create({
        data: {
          action: String(l.action).slice(0, 40),
          object: String(l.object ?? '').slice(0, 300),
          target: String(l.target ?? '').slice(0, 120),
          result: l.result === 'fail' ? 'fail' : 'ok',
          detail: String(l.detail ?? '').slice(0, 4000),
          client: String(l.client ?? '').slice(0, 300),
          ip: String(l.ip ?? '').slice(0, 64),
          createdAt: l.at ? new Date(l.at) : new Date(),
        },
      })
      if (l.id) existing.add(l.id)
      added++
    } catch { /* 单条失败跳过（数据容错） */ }
  }
  logActivity(_req, { action: 'log_import', object: '活动日志', detail: { added } })
  res.json({ ok: true, added })
}))