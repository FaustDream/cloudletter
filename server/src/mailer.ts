/**
 * mailer：邮件发送抽象（生产安全收口）。
 * - 配置 SMTP（SMTP_HOST/PORT/USER/PASS/FROM）时通过 nodemailer 真实发送；
 * - 未配置 SMTP（仅限非生产）时，将邮件落盘到 <dataRoot>/mail/<ts>.txt 供本地联调；
 * - 生产环境安全约束（任意一条不满足即拒绝发送，返回 sent:false + reason，绝不发信）：
 *   1. 必须配置 SMTP_HOST/SMTP_USER（否则验证码/解锁/重置邮件不可用，路由层 503）；
 *   2. 必须全程 TLS：465(SMTPS) 或 587 且显式 SMTP_REQUIRE_TLS=true；禁止明文传输；
 *   3. 收件人必须命中白名单（默认 = ADMIN_EMAIL，可用 SMTP_ALLOW_TO 逗号分隔扩展），防开放中继/成本滥用；
 *   4. 任何错误路径不回显 SMTP 凭据（授权码在错误信息中被脱敏为 [REDACTED]）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'

export const IS_PRODUCTION = process.env.NODE_ENV === 'production'

const mailDir = path.join(config.dataRoot, 'mail')
fs.mkdirSync(mailDir, { recursive: true })

export interface MailMsg {
  to: string
  subject: string
  text: string
}

/** 生产安全默认：发信超时上限，防止邮件服务故障拖垮接口（非池化连接，每次发送独立建连） */
const SAFETY = {
  connectionTimeoutMs: 10_000,
  greetingTimeoutMs: 10_000,
  socketTimeoutMs: 30_000,
}

export const mailConfig = {
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 465),
  secure: (process.env.SMTP_SECURE ?? 'true') === 'true',
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || 'cloudletter@localhost',
  /** SMTP 域名（仅当 SMTP_HOST 填的是 IP 时需设置，用于 SNI/证书校验；通常等于 SMTP_HOST） */
  servername: process.env.SMTP_SERVERNAME || '',
  /** 587/25 端口强制 STARTTLS 升级（生产要求显式开启） */
  requireTls: (process.env.SMTP_REQUIRE_TLS ?? '') === 'true',
}

/** 生产环境收件人白名单：默认本人邮箱（ADMIN_EMAIL），可 SMTP_ALLOW_TO 扩展 */
const RECIPIENT_ALLOWLIST = (process.env.SMTP_ALLOW_TO || process.env.ADMIN_EMAIL || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

export interface SmtpStatus {
  ok: boolean
  /** 不可用原因（生产环境明确报给调用方） */
  reason?: string
  /** 是否可降级为演示落盘（仅非生产且未配置 SMTP 时为 true） */
  demo: boolean
}

/** SMTP 就绪状态（生产安全的单点校验闸门） */
export function smtpStatus(): SmtpStatus {
  if (!mailConfig.host || !mailConfig.user) {
    return { ok: false, demo: !IS_PRODUCTION, reason: 'SMTP 未配置（缺少 SMTP_HOST/SMTP_USER）' }
  }
  if (IS_PRODUCTION && !mailConfig.secure && !mailConfig.requireTls) {
    return { ok: false, demo: false, reason: '生产环境禁止明文 SMTP：请使用 465(SMTPS) 或 587 并设置 SMTP_REQUIRE_TLS=true' }
  }
  if (IS_PRODUCTION && mailConfig.port === 25) {
    console.warn('[security] 生产环境使用 25 端口发信：多为明文机会性加密且易被云厂商拦截，建议改用 465/587')
  }
  return { ok: true, demo: false }
}

/** 收件人是否允许（生产强制白名单；非生产放行以支持任意收件调试） */
export function recipientAllowed(to: string): boolean {
  if (!IS_PRODUCTION || RECIPIENT_ALLOWLIST.length === 0) return true
  return RECIPIENT_ALLOWLIST.includes(String(to).trim().toLowerCase())
}

/** 错误信息中的凭据脱敏（授权码从不回显） */
function redactCredentials(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  const safe = mailConfig.pass ? raw.split(mailConfig.pass).join('[REDACTED]') : raw
  const e = new Error(safe)
  e.name = err instanceof Error ? err.name : 'Error'
  e.stack = err instanceof Error ? err.stack : undefined
  return e
}

/** 发送邮件；生产安全约束失败返回 { sent:false, reason }，绝不抛出网络层细节里的凭据。
 *  allowAnyRecipient：仅限管理员主动发起的一次性授权邀请等场景绕过收件人白名单（仍受路由层频控）。 */
export async function sendMail(msg: MailMsg, opts?: { allowAnyRecipient?: boolean }): Promise<{ sent: boolean; demoPath?: string; reason?: string }> {
  const status = smtpStatus()
  if (!status.ok) {
    // 非生产且未配置 SMTP：降级为落盘（本地联调）
    if (status.demo) {
      const file = path.join(mailDir, `${Date.now()}-${msg.to.replace(/[^a-zA-Z0-9@.]/g, '_')}.txt`)
      fs.writeFileSync(
        file,
        `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n\n[DEV/DEMO] SMTP 未配置，邮件已落盘于此文件。\n`,
        'utf-8',
      )
      return { sent: true, demoPath: file }
    }
    return { sent: false, reason: status.reason }
  }
  if (!opts?.allowAnyRecipient && !recipientAllowed(msg.to)) {
    return { sent: false, reason: '收件人不在允许列表（生产环境防滥用），可用 SMTP_ALLOW_TO 扩展白名单' }
  }
  try {
    const nodemailer = (await import('nodemailer')).default
    const transporter = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.secure,
      requireTLS: mailConfig.port !== 465 && mailConfig.requireTls,
      auth: { user: mailConfig.user, pass: mailConfig.pass },
      // host 是 IP 时固定 servername，保证 SNI 与证书校验正确
      ...(mailConfig.servername ? { servername: mailConfig.servername, tls: { servername: mailConfig.servername } } : {}),
      connectionTimeout: SAFETY.connectionTimeoutMs,
      greetingTimeout: SAFETY.greetingTimeoutMs,
      socketTimeout: SAFETY.socketTimeoutMs,
    })
    await transporter.sendMail({ from: mailConfig.from, to: msg.to, subject: msg.subject, text: msg.text })
    return { sent: true }
  } catch (err) {
    // 网络/TLS/认证错误路径：脱敏后抛出（auth 路由经 ah() 包络为 500）
    throw redactCredentials(err)
  }
}