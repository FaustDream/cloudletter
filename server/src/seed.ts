/**
 * 种子脚本：创建初始管理员（单人项目默认 admin，§11）
 * 用法：pnpm seed （读 .env 的 ADMIN_EMAIL / ADMIN_PASSWORD）
 * 🔴K2 修复：初始口令必须显式从环境变量提供；缺失或为弱默认值时拒绝创建，
 *          禁止以默认凭据上线（生产部署必须设置强口令）。
 */
import 'dotenv/config'
import { prisma } from './prisma'
import { hashPassword } from './crypto'

/** 已知弱口令黑名单：显式拒绝，防止"默认口令上线" */
const FORBIDDEN_PASSWORDS = new Set(['change-me', 'admin', 'password', '123456', '12345678'])

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL || 'admin@cloudletter.local'
  const password = process.env.ADMIN_PASSWORD

  if (!password || password.length < 8) {
    throw new Error('必须通过环境变量 ADMIN_PASSWORD 提供至少 8 位的初始管理员口令，否则拒绝创建')
  }
  if (FORBIDDEN_PASSWORDS.has(password.toLowerCase())) {
    throw new Error(`初始口令 "${password}" 属于已知弱口令，禁止使用。请设置强口令后重试。`)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log(`管理员已存在: ${email}`)
    return
  }
  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword(password) },
  })
  console.log(`已创建管理员: ${email} (id=${user.id})`)
  // 口令已以加盐散列写入数据库，.env 中的明文 ADMIN_PASSWORD 使命完成，建议移除
  console.log('[security] 初始口令已完成使命（仅以加盐散列存于数据库）。建议现在从 .env 中移除 ADMIN_PASSWORD 明文配置。')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
