/**
 * 加密原语单测（最小功能）：
 * - 口令散列：hash/verify 往返、错误口令拒绝、畸形存储值拒绝
 * - TOTP：当前窗验证通过、±1 窗容差、错误码拒绝、6 位输出
 * - Token：指定字节数的 hex 输出
 */
import { describe, it, expect } from 'vitest'
import {
  hashPassword,
  verifyPassword,
  generateTOTPSecret,
  generateTOTP,
  verifyTOTP,
  otpauthUrl,
  generateToken,
} from '@server/crypto'

describe('口令散列（scrypt）', () => {
  it('hash → verify 往返成功', () => {
    const stored = hashPassword('s3cret-密码!')
    expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
    expect(verifyPassword('s3cret-密码!', stored)).toBe(true)
  })

  it('同一口令两次散列产生不同盐（盐随机）', () => {
    expect(hashPassword('pw')).not.toBe(hashPassword('pw'))
  })

  it('错误口令拒绝', () => {
    expect(verifyPassword('wrong', hashPassword('right'))).toBe(false)
  })

  it('畸形存储值安全拒绝（不抛异常）', () => {
    expect(verifyPassword('pw', '')).toBe(false)
    expect(verifyPassword('pw', 'no-colon')).toBe(false)
    expect(verifyPassword('pw', 'zz:not-hex')).toBe(false)
    expect(verifyPassword('pw', 'aabb:ccdd')).toBe(false) // 长度不等 → timingSafeEqual 抛错 → false
  })
})

describe('TOTP（RFC 6238）', () => {
  it('generateTOTPSecret 返回 hex 与 base32，base32 字符集合法', () => {
    const { hex, base32 } = generateTOTPSecret()
    expect(hex).toMatch(/^[0-9a-f]{40}$/)
    expect(base32).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('当前时间窗生成的码能通过验证', () => {
    const { hex } = generateTOTPSecret()
    const code = generateTOTP(hex)
    expect(code).toMatch(/^\d{6}$/)
    expect(verifyTOTP(code, hex)).toBe(true)
  })

  it('±1 时间窗容差内通过，±2 窗拒绝', () => {
    const { hex } = generateTOTPSecret()
    const c = Math.floor(Date.now() / 1000 / 30)
    expect(verifyTOTP(generateTOTP(hex, 30, 6, c - 1), hex)).toBe(true)
    expect(verifyTOTP(generateTOTP(hex, 30, 6, c + 1), hex)).toBe(true)
    expect(verifyTOTP(generateTOTP(hex, 30, 6, c - 2), hex)).toBe(false)
  })

  it('错误码与空入参拒绝', () => {
    const { hex } = generateTOTPSecret()
    expect(verifyTOTP('000000', hex)).toBe(false)
    expect(verifyTOTP('', hex)).toBe(false)
    expect(verifyTOTP('123456', '')).toBe(false)
  })

  it('otpauth URL 含密钥/发行方/算法参数', () => {
    const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'a@b.c', 'Cloudletter')
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(url).toContain('issuer=Cloudletter')
    expect(url).toContain('algorithm=SHA1')
  })
})

describe('Token 生成', () => {
  it('默认 32 字节 → 64 位 hex；可指定字节数', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/)
    expect(generateToken(16)).toMatch(/^[0-9a-f]{32}$/)
  })
})
