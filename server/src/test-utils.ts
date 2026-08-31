/**
 * 测试工具：启动一个指向临时 SQLite + 临时内容目录的 v2 路由实例。
 * - 在导入 prisma/v2 前设置 DATABASE_URL 与 PROJECT_DIR（模块级常量在导入时读取）
 * - 用 `prisma db push` 在临时库建表，避免污染开发库
 * 调用方负责用 vi.mock 替换 build/auth（见各 .test.ts）。
 */
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export interface TestApp {
  base: string
  prisma: any
  contentRoot: string
  dataRoot: string
  close: () => Promise<void>
}

export async function startTestApp(): Promise<TestApp> {
  const contentRoot = mkdtempSync(join(tmpdir(), 'cl-content-'))
  const dbDir = mkdtempSync(join(tmpdir(), 'cl-db-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'cl-data-'))
  const dbFile = join(dbDir, 'test.db')
  const url = `file:${dbFile}`

  process.env.PROJECT_DIR = contentRoot
  process.env.DATABASE_URL = url
  // DATA_ROOT 指向临时目录，隔离 uploads/revisions/settings 等数据目录，不污染开发数据
  process.env.DATA_ROOT = dataRoot
  // config 自改造后 posts/settings 默认走 dataRoot；测试须显式指回临时目录以保持隔离
  process.env.POSTS_ROOT = join(contentRoot, 'src', 'content', 'posts')
  process.env.SETTINGS_ROOT = join(contentRoot, 'src', 'content', '_settings')

  execSync('node node_modules/prisma/build/index.js db push --skip-generate', {
    cwd: SERVER_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'ignore',
  })

  const { prisma } = await import('./prisma')
  const { api } = await import('./routes/index')
  const { uploadsDir } = await import('./config')

  const express = (await import('express')).default
  const app = express()
  app.use(express.json())
  app.use('/api/v2', api)
  // 与 index.ts 同构：上传静态托管兜底（免登录 GET）
  app.use('/api/v2/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true }))
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在', details: null } }))

  const server = app.listen(0)
  await new Promise<void>((r) => server.once('listening', r))
  const { port } = server.address() as AddressInfo
  const base = `http://127.0.0.1:${port}/api/v2`

  return {
    base,
    prisma,
    contentRoot,
    dataRoot,
    close: () => new Promise<void>((res) => server.close(() => res())),
  }
}