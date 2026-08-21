// 开发工具：打印管理员当前 TOTP 码（仅本地调试用）
import 'dotenv/config'
import { prisma } from '../src/prisma'
import { generateTOTP } from '../src/crypto'
async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@cloudletter.local'
  const u = await prisma.user.findUnique({ where: { email } })
  if (!u?.totpSecret) { console.error('no secret'); process.exit(1) }
  console.log(generateTOTP(u.totpSecret))
}
main().then(() => prisma.$disconnect())
