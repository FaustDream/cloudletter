/**
 * 加密原语：scrypt 口令散列 + TOTP（自旧 admin/db.cjs 移植，逻辑保持一致）
 */
import crypto from 'node:crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/* ========== scrypt 口令 ========== */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  const calc = crypto.scryptSync(password, salt, 64).toString('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'))
  } catch {
    return false
  }
}

/* ========== TOTP（RFC 6238，SHA1/6位/30s，±1 窗口容差） ========== */

export function generateTOTPSecret(): { hex: string; base32: string } {
  const buf = crypto.randomBytes(20)
  let bits = 0
  let val = 0
  let b32 = ''
  for (let i = 0; i < buf.length; i++) {
    val = (val << 8) | buf[i]
    bits += 8
    while (bits >= 5) {
      b32 += B32[(val >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) b32 += B32[(val << (5 - bits)) & 31]
  return { hex: buf.toString('hex'), base32: b32 }
}

export function generateTOTP(secretHex: string, step = 30, digits = 6, counter?: number): string {
  const c = counter ?? Math.floor(Date.now() / 1000 / step)
  const cb = Buffer.alloc(8)
  cb.writeBigInt64BE(BigInt(c))
  const h = crypto.createHmac('sha1', Buffer.from(secretHex, 'hex')).update(cb).digest()
  const off = h[h.length - 1] & 0x0f
  const bin =
    ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff)
  return String(bin % Math.pow(10, digits)).padStart(digits, '0')
}

export function verifyTOTP(token: string, secretHex: string): boolean {
  if (!secretHex || !token) return false
  const t = String(token).trim()
  const c = Math.floor(Date.now() / 1000 / 30)
  // ±1 个时间窗容差
  return [c - 1, c, c + 1].some((k) => generateTOTP(secretHex, 30, 6, k) === t)
}

export function otpauthUrl(secretBase32: string, email: string, issuer = 'Cloudletter'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

/* ========== Token ========== */

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex')
}
