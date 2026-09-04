/**
 * UA 解析（轻量）：从 User-Agent 提取客户端类型 / 操作系统 / 浏览器。
 */
import crypto from 'node:crypto'
export interface UaInfo {
  client: string // browser | app | bot | unknown
  os: string
  browser: string
}

const OS_PATTERNS: [RegExp, string][] = [
  [/Windows NT 10\.\d+/, 'Windows 10/11'],
  [/Windows NT 6\.3/, 'Windows 8.1'],
  [/Windows NT 6\.\d/, 'Windows 7/8'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Linux/, 'Linux'],
  [/CrOS/, 'ChromeOS'],
]

const BROWSER_PATTERNS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/Chrome\//, 'Chrome'],
  [/Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
  [/OPR\//, 'Opera'],
  [/WeChat/, '微信内置浏览器'],
  [/MicroMessenger/, '微信内置浏览器'],
]

export function parseUa(ua: string): UaInfo {
  if (!ua) return { client: 'unknown', os: '未知', browser: '未知' }
  let os = '未知'
  for (const [re, label] of OS_PATTERNS) {
    if (re.test(ua)) { os = label; break }
  }
  let browser = '未知'
  for (const [re, label] of BROWSER_PATTERNS) {
    if (re.test(ua)) { browser = label; break }
  }
  const client = ua.includes('bot') || ua.includes('spider') || ua.includes('crawler')
    ? 'bot'
    : /Mobi|Android|iPhone|iPad/.test(ua)
      ? 'app'
      : 'browser'
  return { client, os, browser }
}

/** 设备标识：读取/签发 cl_dev cookie（客户端在登录前创建，登录时随请求带给服务器记录） */
export function ensureDeviceId(cookie?: string | null): string {
  if (cookie && /^[a-zA-Z0-9._-]{8,64}$/.test(cookie)) return cookie
  return 'dev_' + crypto.randomBytes(12).toString('hex')
}