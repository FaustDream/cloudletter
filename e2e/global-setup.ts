import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(__dirname, '../server')
const TEST_DB_URL = 'file:./data/e2e-test.db'

/** 跨平台执行同步子进程（spawnSync 参数组，避免 shell 引号差异） */
function runSync(cmd: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd, env, stdio: 'inherit' })
  if (r.status !== 0) {
    throw new Error(`命令失败（exit=${r.status ?? r.signal ?? '?'}）: ${cmd.join(' ')}`)
  }
}

/** 准备测试数据库：重置 + db push 建表 + seed 管理员 */
export default function globalSetup(): void {
  // 显式指定管理员凭据，覆盖宿主环境可能残留的 ADMIN_* 变量
  const env = {
    ...process.env,
    DATABASE_URL: TEST_DB_URL,
    ADMIN_EMAIL: 'admin@cloudletter.local',
    ADMIN_PASSWORD: 'e2e-admin-2026',
  }

  // 1. 删除旧测试库（含 WAL/SHM）—— SQLite 相对路径基于 schema.prisma 目录（prisma/）
  const dbFile = path.join(serverDir, 'prisma', 'data', 'e2e-test.db')
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(dbFile + suffix, { force: true })
    } catch {
      /* ignore */
    }
  }

  // 2. 隔离内容目录（避免 createPost 写入源 fuwari-blog）
  const contentDir = path.resolve(__dirname, 'content')
  for (const sub of ['posts', 'note', '_settings']) {
    fs.mkdirSync(path.join(contentDir, sub), { recursive: true })
  }
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.rmSync(dbFile + suffix, { force: true })
    } catch {
      /* ignore */
    }
  }

  // 2. prisma db push（建表）—— 用 node 直调 + spawnSync 参数组，绕开 corepack/pnpm 与 shell 引号问题
  const nodeCmd = process.execPath
  const prismaCli = path.join(serverDir, 'node_modules', 'prisma', 'build', 'index.js')
  runSync([nodeCmd, prismaCli, 'db', 'push', '--skip-generate'], serverDir, env)

  // 3. seed 管理员
  const tsxCli = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const seedFile = path.join(serverDir, 'src', 'seed.ts')
  runSync([nodeCmd, tsxCli, seedFile], serverDir, env)
}
