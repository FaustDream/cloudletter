/**
 * 数据备份脚本：把 SQLite 数据库 + 文章真相源 + 版本快照 + 站点设置 + 上传资源
 * 拷贝到 <DATA_ROOT>/backups/<时间戳>/。用法：pnpm backup（可加 cron 定时执行）。
 * - SQLite 采用 VACUUM INTO 生成一致快照（自动合并 WAL，规避在线拷贝的不一致风险）；
 *   若数据库不支持（非 SQLite / 引擎受限）则回退为文件拷贝（含 -wal/-shm）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { config, databaseUrl, postsRootDir, settingsDir } from '../src/config.ts'

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = path.join(config.dataRoot, 'backups', stamp)
fs.mkdirSync(dest, { recursive: true })

/** 拷贝单个文件（忽略缺失） */
function copyFile(src: string, destDir: string): void {
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, path.basename(src)))
}

/** 递归拷贝目录（忽略缺失） */
function copyDir(src: string, destDir: string): void {
  if (!fs.existsSync(src)) return
  fs.cpSync(src, destDir, { recursive: true })
}

/** 当前工作目录（服务运行时即 server/） */
const srcCwd = process.cwd()

/** SQLite 库文件路径（相对路径基于 prisma/ 目录，与 prisma client 行为一致） */
const dbUrl = databaseUrl()
const dbPath = dbUrl.startsWith('file:')
  ? path.resolve(srcCwd, 'prisma', dbUrl.slice(5).split('?')[0])
  : null

async function snapshotDb(destDir: string): Promise<boolean> {
  if (!dbPath) return false
  const target = path.join(destDir, path.basename(dbPath))
  try {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl() } } })
    // VACUUM INTO 要求目标文件不存在；路径须为字面量（SQLite 不支持参数绑定），单引号按 SQL 规则转义
    const quoted = target.replace(/'/g, "''")
    await prisma.$executeRawUnsafe(`VACUUM INTO '${quoted}'`)
    await prisma.$disconnect()
    console.log(`[backup] db     -> ${target}（VACUUM INTO 一致快照）`)
    return true
  } catch (e) {
    console.warn(`[backup] VACUUM INTO 失败，回退为文件拷贝:`, e instanceof Error ? e.message : e)
    return false
  }
}

async function main(): Promise<void> {
  if (dbPath) {
    const dbDir = path.join(dest, 'db')
    fs.mkdirSync(dbDir, { recursive: true })
    const snapshotted = await snapshotDb(dbDir)
    if (!snapshotted) {
      for (const suffix of ['', '-journal', '-wal', '-shm']) copyFile(dbPath + suffix, dbDir)
      console.log(`[backup] db     -> ${path.join(dbDir, path.basename(dbPath))}（文件拷贝）`)
    }
  } else {
    console.log(`[backup] 跳过非 file: 数据库（${dbUrl}）`)
  }

  // 内容与资源
  copyDir(postsRootDir(), path.join(dest, 'posts'))
  copyDir(settingsDir(), path.join(dest, 'settings'))
  copyDir(config.uploadsDir, path.join(dest, 'uploads'))
  copyDir(config.revisionsDir, path.join(dest, 'revisions'))
  console.log(`[backup] posts/settings/uploads/revisions -> ${dest}`)
  console.log(`[backup] 完成：${dest}`)
}

main().catch((e) => {
  console.error('[backup] 失败:', e)
  process.exit(1)
})