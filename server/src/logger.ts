/**
 * 统一日志系统：结构化 JSON 行，同时输出到
 *   - 服务器日志目录 <LOG_ROOT>/cloudletter-YYYY-MM-DD.log（默认 <DATA_ROOT>/logs，可用 LOG_ROOT 覆盖）
 *   - console（stdout，供 journald / 开发终端查看）
 * 日志写盘失败不阻断业务（try/catch 静默），单进程服务用同步追加保证顺序。
 * 用法：
 *   logInfo('universe', '节点宇宙创建', { nodes: 120 })
 *   logError('universe', new Error('渲染失败'), { hint: '降质模式' })
 */
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config'

const LOG_ROOT = process.env.LOG_ROOT || path.join(config.dataRoot, 'logs')
let logDir = LOG_ROOT
try {
  fs.mkdirSync(logDir, { recursive: true })
} catch {
  // 目录创建失败则退化到 /tmp 兜底，避免日志功能影响启动
  logDir = process.env.TMPDIR || '/tmp'
  try { fs.mkdirSync(logDir, { recursive: true }) } catch { /* 忽略 */ }
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

/** 当前日志文件（按天切分） */
function logFile(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return path.join(logDir, `cloudletter-${y}-${m}-${day}.log`)
}

function safeFields(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string') {
      // 截断超长字段（防单行日志爆炸），保留可读性
      out[k] = v.length > 2000 ? v.slice(0, 2000) + '…' : v
    } else if (typeof v === 'object') {
      try { out[k] = JSON.stringify(v).slice(0, 2000) } catch { out[k] = '[unserializable]' }
    } else {
      out[k] = v
    }
  }
  return out
}

export function log(level: LogLevel, src: string, message: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    src,
    message,
    ...safeFields(fields),
  })
  // console 输出（结构化单行，便于 journald 采集 / 人工 grep）
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  // 落盘（同步追加 + 按天文件；失败静默，绝不影响主流程）
  try {
    fs.appendFileSync(logFile(), line + '\n', 'utf-8')
  } catch {
    /* 忽略写盘失败 */
  }
}

export function logInfo(src: string, message: string, fields?: Record<string, unknown>): void {
  log('info', src, message, fields)
}

export function logWarn(src: string, message: string, fields?: Record<string, unknown>): void {
  log('warn', src, message, fields)
}

/** 错误日志：自动带出 message/stack，便于排查异常与卡死问题 */
export function logError(src: string, err: unknown, fields?: Record<string, unknown>): void {
  const e = err instanceof Error ? err : new Error(String(err))
  log('error', src, e.message, { stack: e.stack?.slice(0, 2000) ?? '', ...safeFields(fields) })
}

/** 前端客户端日志的合法级别白名单 */
export const CLIENT_LOG_LEVELS: ReadonlySet<string> = new Set(['info', 'warn', 'error', 'debug'])