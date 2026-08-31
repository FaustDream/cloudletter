/**
 * 部署辅助脚本：在 `prisma db push` 之前删除 FTS5 虚拟表（post_search）及其 shadow 表。
 *
 * 为什么需要：post_search 由运行时代码（search-index.ts initSearchIndex）创建，不在
 * schema.prisma 中。`prisma db push` 会把「存在但不在 schema 中的表」当作多余表要求删除，
 * 且 FTS shadow 表非空 → 直接报错导致部署失败（实测：表非空时 push 无 --accept-data-loss 必失败）。
 *
 * 时序约定：db push(结构同步) 前先执行本脚本；随后服务启动时 initSearchIndex 重建空表，
 * 若 posts>0 则自动全量重建索引（index.ts 已有该兜底逻辑），搜索无缝恢复。
 * 幂等：FTS 表不存在时无副作用，可放心每次部署都跑。
 */
import { prisma } from '../src/prisma'
import { FTS_TABLE } from '../src/search-index'

async function main() {
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${FTS_TABLE}`)
  console.log(`[drop-fts] 已删除 ${FTS_TABLE}（含 shadow 表），服务启动时将自动重建索引`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('[drop-fts] 失败:', e instanceof Error ? e.message : e)
  process.exit(1)
})