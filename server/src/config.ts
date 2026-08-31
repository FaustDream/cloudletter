/**
 * 数据目录集中配置（开发 / 生产分离）：
 * - 开发环境默认落到 <server>/data/dev；生产（NODE_ENV=production）默认落到 data/prod。
 * - 所有数据（SQLite 数据库、文章 Markdown 真相源、版本快照、上传资源、工作台）统一由
 *   DATA_ROOT 控制；本机测试数据与服务器生产数据完全隔离，避免部署/重建导致丢失。
 * - 可用环境变量覆盖：
 *     DATA_ROOT   数据根目录（绝对或相对 server/）
 *     DATABASE_URL  SQLite 连接串（默认 file:<DATA_ROOT>/cloudletter.db）
 *     POSTS_ROOT  文章真相源目录（默认继承旧版 PROJECT_DIR/src/content/posts）
 */
import fs from 'node:fs'
import path from 'node:path'

const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
const dataRoot = path.resolve(
  process.env.DATA_ROOT || path.join(process.cwd(), 'data', env),
)

export const serverRoot = process.cwd()

/** 保证数据根目录存在 */
function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 数据库目录 */
export const dbDir = ensureDir(path.join(dataRoot, 'db'))
/** 版本快照目录 */
export const revisionsDir = ensureDir(path.join(dataRoot, 'revisions'))
/** 上传资源目录 */
export const uploadsDir = ensureDir(path.join(dataRoot, 'uploads'))

/** SQLite 连接串 */
export function databaseUrl(): string {
  return process.env.DATABASE_URL || `file:${path.join(dbDir, 'cloudletter.db')}`
}

/** 文章正文真相源目录（已从旧博客项目迁入新项目数据目录；博客前台已下线） */
export function postsRootDir(): string {
  if (process.env.POSTS_ROOT) {
    return ensureDir(path.resolve(process.env.POSTS_ROOT))
  }
  return ensureDir(path.join(dataRoot, 'posts'))
}

/** 站点设置目录（默认写入数据目录 settings/site.json） */
export function settingsDir(): string {
  if (process.env.SETTINGS_ROOT) {
    return ensureDir(path.resolve(process.env.SETTINGS_ROOT))
  }
  return ensureDir(path.join(dataRoot, 'settings'))
}

export const config = {
  env,
  dataRoot,
  dbDir,
  revisionsDir,
  uploadsDir,
  databaseUrl: databaseUrl(),
}