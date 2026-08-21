/**
 * 审计日志（§11）：登录/发布/设置变更/构建等关键操作落库
 */
import { prisma } from '../prisma'

export async function audit(userId: string | null, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await prisma.auditLog.create({ data: { userId, action, detail: JSON.stringify(detail) } })
  } catch (e) {
    // 审计失败不应阻断业务
    console.error('[audit] 写入失败:', e)
  }
}
