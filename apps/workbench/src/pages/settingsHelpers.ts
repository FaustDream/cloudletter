/** 设置页数据导出助手：聚合工作台各模块为云笺集备份 JSON（kind=cloudletter-backup） */
import { api } from '../api'
import { todayYMD } from '../lib/date'

export async function exportDataBundle(toast: { (msg: string, kind?: 'err'): void }): Promise<void> {
  const bundle: Record<string, unknown> = { kind: 'cloudletter-backup', version: 1, exportedAt: new Date().toISOString() }
  const modules: Record<string, unknown> = {}
  for (const s of ['plan', 'checkin', 'ledger', 'goals', 'notes', 'worktask'] as const) {
    try {
      const r = await api.get<{ items: unknown[] }>(`/workbench/${s}`)
      modules[s] = r.items
    } catch (e: any) {
      modules[s] = []
      toast(`模块 ${s} 导出失败：${e?.message ?? '未知错误'}`, 'err')
    }
  }
  bundle.modules = modules
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `cloudletter-backup-${todayYMD()}.json`
  a.click()
  URL.revokeObjectURL(a.href)
  toast('数据已导出（工作台各模块备份）')
}