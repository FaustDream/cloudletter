/**
 * 站点级备份 / 回滚（§11 运维硬化）：
 * - createBackup：SQLite 在线备份（VACUUM INTO，正确处理 WAL），滚动保留最近 7 份
 * - listBackups：读取备份目录
 * - rollback：回滚前自动"回滚前"安全快照 + WAL checkpoint + 覆盖主库文件（需重启生效）
 * - scheduleDailyBackup：每日 03:00 定时备份（幂等，进程内 setInterval）
 */
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../prisma'
import { audit } from './audit'

const MAX_BACKUPS = 7

/** 解析 SQLite 主库文件路径（不依赖 DATABASE_URL 相对路径解析） */
async function dbFilePath(): Promise<string> {
  const rows = (await prisma.$queryRawUnsafe('PRAGMA database_list')) as Array<{
    name: string
    file: string
  }>
  const main = rows.find((r) => r.name === 'main')
  return main?.file || 'data/cloudletter.db'
}

function backupDir(dbFile: string): string {
  return path.join(path.dirname(path.resolve(dbFile)), 'backups')
}

export async function createBackup(userId: string | null): Promise<{ name: string; size: number }> {
  const dbFile = await dbFilePath()
  const dir = backupDir(dbFile)
  fs.mkdirSync(dir, { recursive: true })
  const name = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  const target = path.join(dir, name)
  // SQLite 在线备份：VACUUM INTO 正确处理 WAL，不阻塞写入
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  // 滚动清理：仅保留最近 MAX_BACKUPS 份
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db') && f.startsWith('backup-'))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    fs.rmSync(path.join(dir, f), { force: true })
  }
  if (userId) await audit(userId, 'backup.create', { name })
  return { name, size: fs.statSync(target).size }
}

export async function listBackups(): Promise<Array<{ name: string; size: number; createdAt: string }>> {
  const dbFile = await dbFilePath()
  const dir = backupDir(dbFile)
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.db') && f.startsWith('backup-'))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f))
        return { name: f, size: st.size, createdAt: st.mtime.toISOString() }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

export async function rollback(
  name: string,
  userId: string,
): Promise<{ ok: boolean; needRestart: boolean; safety: string }> {
  if (!/^backup-[\dTZ\-]+\.db$/.test(name)) throw new Error('非法的备份名')
  const dbFile = await dbFilePath()
  const dir = backupDir(dbFile)
  const src = path.join(dir, name)
  if (!fs.existsSync(src)) throw new Error('备份不存在')

  // 回滚前先把当前状态做一份"回滚前"备份，可撤销
  const safety = path.join(dir, `pre-rollback-${Date.now()}.db`)
  await prisma.$executeRawUnsafe(`VACUUM INTO '${safety.replace(/'/g, "''")}'`)

  // 合并 WAL 到主库，确保覆盖后不丢数据
  await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
  fs.copyFileSync(src, dbFile)
  await audit(userId, 'backup.rollback', { name, safety: path.basename(safety) })
  return { ok: true, needRestart: true, safety: path.basename(safety) }
}

/**
 * 每日定时备份（§11）：每天 03:00 触发一次。
 * 幂等实现：每 5 分钟检查当前是否处于 03:00-03:05 窗口，命中则备份（记 lastDate 防止重复）。
 */
export function scheduleDailyBackup(): void {
  let lastDate = ''
  const tick = async () => {
    const now = new Date()
    const dateKey = now.toISOString().slice(0, 10)
    if (now.getHours() === 3 && lastDate !== dateKey) {
      lastDate = dateKey
      try {
        await createBackup(null)
        console.log(`[backup] 每日自动备份完成 @ ${new Date().toISOString()}`)
      } catch (e) {
        console.error('[backup] 每日自动备份失败:', (e as Error)?.message)
      }
    }
  }
  tick()
  setInterval(tick, 5 * 60 * 1000)
}
