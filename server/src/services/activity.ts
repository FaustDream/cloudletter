/**
 * 活动日志服务：重大操作统一留痕（登录/登出/改密/2FA/邮箱/资料/文章增删改/导入导出/站点配置/API/Webhook）。
 * 关键约束：日志只追加，不提供更新/删除接口（普通用户不可篡改）。
 */
import type { Request } from 'express'
import { prisma } from '../prisma'

export type ActivityAction =
  | 'login' | 'logout' | 'password_change' | 'email_change' | 'profile_update'
  | 'tfa_enable' | 'tfa_disable' | 'tfa_reset' | 'tfa_recovery'
  | 'post_create' | 'post_update' | 'post_delete' | 'post_restore' | 'post_publish'
  | 'data_export' | 'data_import' | 'log_export' | 'log_import'
  | 'site_config' | 'avatar_update' | 'avatar_decors'
  | 'api_cred_create' | 'api_cred_revoke' | 'webhook_create' | 'webhook_update' | 'webhook_delete'
  | 'rss_subscribe' | 'rss_refresh' | 'rss_unsubscribe' | 'notification_settings'

/** 从请求提取客户端信息（UA/IP：优先首个可信 XFF） */
export function requestInfo(req: Pick<Request, 'ip' | 'headers'>): { ua: string; ip: string } {
  const ua = String(req.headers?.['user-agent'] ?? '').slice(0, 300)
  const xff = req.headers?.['x-forwarded-for']
  const xffIp = (typeof xff === 'string' ? xff.split(',')[0] : Array.isArray(xff) ? String(xff[0]) : '').trim()
  const ip = xffIp.slice(0, 64) || String(req.ip ?? '').slice(0, 64) || ''
  return { ua, ip }
}

/** 写一条活动日志（fire-and-forget，失败仅记 logger，不阻断业务） */
export function logActivity(
  req: Pick<Request, 'ip' | 'headers'> | null,
  entry: { action: ActivityAction; object?: string; target?: string; result?: 'ok' | 'fail'; detail?: Record<string, unknown> | string },
): void {
  const { ua = '', ip = '' } = req ? requestInfo(req) : {}
  void prisma.activityLog
    .create({
      data: {
        action: entry.action,
        object: String(entry.object ?? '').slice(0, 300),
        target: String(entry.target ?? '').slice(0, 120),
        result: entry.result ?? 'ok',
        detail: typeof entry.detail === 'string' ? entry.detail.slice(0, 4000) : JSON.stringify(entry.detail ?? {}).slice(0, 4000),
        client: ua,
        ip,
      },
    })
    .catch((e) => console.error('[activity] 日志写入失败', e))
}

/** 统一读取活动日志（分页 + 类型过滤） */
export async function listActivity(opts: { action?: string; page?: number; size?: number }): Promise<{ items: unknown[]; total: number; page: number; pages: number }> {
  const page = Math.max(1, Math.min(5000, Number(opts.page) || 1))
  const size = Math.max(5, Math.min(200, Number(opts.size) || 40))
  const where = opts.action ? { action: opts.action } : {}
  const [total, rows] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * size,
      take: size,
    }),
  ])
  return {
    items: rows.map((r) => ({
      id: r.id, action: r.action, object: r.object, target: r.target, result: r.result,
      detail: r.detail, client: r.client, ip: r.ip, at: r.createdAt.toISOString(),
    })),
    total, page, pages: Math.max(1, Math.ceil(total / size)),
  }
}

/** 活动动作中文名（前端展示） */
export const ACTION_LABELS: Record<string, string> = {
  login: '登录', logout: '登出', password_change: '修改密码', email_change: '修改邮箱',
  profile_update: '修改账户信息', tfa_enable: '开启两步验证', tfa_disable: '关闭两步验证',
  tfa_reset: '重置两步验证', tfa_recovery: '两步验证恢复', post_create: '创建文章',
  post_update: '修改文章', post_delete: '删除文章', post_restore: '恢复文章', post_publish: '发布文章',
  data_export: '导出数据', data_import: '导入数据', log_export: '导出活动日志', log_import: '导入活动日志',
  site_config: '修改站点配置', avatar_update: '更换头像', avatar_decors: '修改头像装饰',
  api_cred_create: '创建 API 凭据', api_cred_revoke: '撤销 API 凭据',
  webhook_create: '创建 Webhook', webhook_update: '修改 Webhook', webhook_delete: '删除 Webhook',
  rss_subscribe: '订阅 RSS', rss_refresh: '刷新 RSS', rss_unsubscribe: '取消 RSS 订阅',
  notification_settings: '修改通知设置',
}