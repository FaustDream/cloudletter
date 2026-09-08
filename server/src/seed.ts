/**
 * 种子脚本：创建/同步初始管理员（单人项目默认 admin，§11）
 * 用法：pnpm seed （读 .env 的 ADMIN_EMAIL / ADMIN_PASSWORD）
 * 口令约定：
 *  - 本地（非生产）：未设置 ADMIN_PASSWORD 时默认使用 123456，可作为本地调试的默认口令；
 *    已有管理员时若口令与当前不一致会自动同步为新口令（等价于重置管理员口令）。
 *  - 生产（NODE_ENV=production）：🔴K2 保留强口令约束——必须显式提供至少 8 位、
 *    且不属于弱口令黑名单的初始化口令，缺失或过弱时拒绝创建，禁止默认凭据上线。
 */
import 'dotenv/config'
import { prisma } from './prisma'
import { hashPassword, verifyPassword } from './crypto'

/** 本地默认口令，便于个人本地调试（生产环境不生效） */
const LOCAL_DEFAULT_PASSWORD = '123456'

/** 已知弱口令黑名单：生产环境显式拒绝，防止"默认口令上线" */
const FORBIDDEN_PASSWORDS = new Set(['change-me', 'admin', 'password', '123456', '12345678'])

async function main(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production'
  const email = process.env.ADMIN_EMAIL || 'admin@cloudletter.local'
  const password = process.env.ADMIN_PASSWORD || (isProd ? undefined : LOCAL_DEFAULT_PASSWORD)

  if (isProd) {
    if (!password || password.length < 8) {
      throw new Error('生产环境必须通过环境变量 ADMIN_PASSWORD 提供至少 8 位的初始化口令，否则拒绝创建')
    }
    if (FORBIDDEN_PASSWORDS.has(password.toLowerCase())) {
      throw new Error(`初始口令 "${password}" 属于已知弱口令，禁止使用。请设置强口令后重试。`)
    }
  } else if (!password || password.length < 6) {
    throw new Error(`本地初始口令至少 6 位；未设置 ADMIN_PASSWORD 时默认使用 "${LOCAL_DEFAULT_PASSWORD}"`)
  }

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    if (verifyPassword(password, existing.passwordHash)) {
      console.log(`管理员已存在且口令一致: ${email}`)
    } else {
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash: hashPassword(password) },
      })
      console.log(`管理员口令已重置为 ${isProd ? '新口令' : `默认口令 ${LOCAL_DEFAULT_PASSWORD}`}: ${email}`)
    }
    return
  }
  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword(password) },
  })
  console.log(`已创建管理员: ${email} (id=${user.id})${isProd ? '' : `，默认口令 ${LOCAL_DEFAULT_PASSWORD}`}`)
  // 口令已以加盐散列写入数据库，.env 中的明文 ADMIN_PASSWORD 使命完成，建议移除
  console.log('[security] 初始口令已完成使命（仅以加盐散列存于数据库）。建议现在从 .env 中移除 ADMIN_PASSWORD 明文配置。')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
