/**
 * 上传路由：POST /uploads 图片直传（配合编辑器粘贴即传），GET 静态托管已上传文件。
 * - 客户端已做缩略图压缩（长边 ≤2000px / JPEG q0.85，GIF 保留动图原样），这里兜底类型与大小校验
 * - 文件名 = 时间戳36进制 + 8位随机 hex，不可枚举；静态读取无需登录（博客前台将来引用图片需公开可读）
 */
import { Router } from 'express'
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { uploadsDir } from '../config'
import { requireAuth } from '../auth'
import { ah, err } from './helpers'

export const uploads = Router()

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/ogg': 'ogv',
}

/**
 * 魔数嗅探：Content-Type 由客户端声明不可信，按文件头字节二次校验实际类型。
 * png: 89 50 4E 47；jpeg: FF D8 FF；gif: 47 49 46 38；webp: RIFF....WEBP；
 * mp4: 前 12 字节内出现 'ftyp'；webm: EBML 头 1A 45 DF A3；ogg: 'OggS'
 */
function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp'
  return null
}

/** 视频魔数嗅探：mp4（含 ftyp box）/ webm（EBML 头）/ ogg（OggS 头） */
function sniffVideo(buf: Buffer): string | null {
  const head = buf.subarray(0, 64)
  if (head.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4'
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm'
  if (buf.length >= 4 && head.toString('latin1').startsWith('OggS')) return 'ogv'
  return null
}

/** 按 Content-Type 识别上传类别：image/* 或 video/* */
function kindOfUpload(mime: string): 'image' | 'video' | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  return null
}

// 上传配额（每 IP 滑动窗口）：图片默认每小时 60MB、视频默认每小时 2GB，防无限上传拖垮磁盘
const IMAGE_QUOTA_BYTES_PER_HOUR = parseInt(process.env.UPLOAD_QUOTA_MB || '60', 10) * 1024 * 1024
const VIDEO_QUOTA_BYTES_PER_HOUR = parseInt(process.env.VIDEO_QUOTA_MB || '2048', 10) * 1024 * 1024
const quota = new Map<string, { used: number; hour: number }>()
function quotaCheck(ip: string, bytes: number, bucket: number): boolean {
  const hr = Math.floor(Date.now() / 3_600_000)
  const cur = quota.get(ip)
  // 同小时内视频与图片共用滑动窗口，按各自额度前缀累计
  if (!cur || cur.hour !== hr) quota.set(ip, { used: bytes, hour: hr })
  else if (cur.used + bytes > bucket) return false
  else cur.used += bytes
  return true
}
// 周期性清场：过期小时窗口的配额键整体删除
setInterval(() => {
  const hr = Math.floor(Date.now() / 3_600_000)
  for (const [ip, v] of quota) if (v.hour !== hr) quota.delete(ip)
}, 5 * 60 * 1000).unref?.()

const ipOf = (req: express.Request): string => String(req.ip ?? req.socket.remoteAddress ?? 'unknown')

uploads.post(
  '/',
  requireAuth,
  express.raw({ type: Object.keys(MIME_EXT), limit: '200mb' }),
  ah(async (req, res) => {
    const mime = req.headers['content-type']?.split(';')[0].trim() ?? ''
    const kind = kindOfUpload(mime)
    const ext = kind ? MIME_EXT[mime] : undefined
    if (!kind || !ext || !req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return err(res, 415, 'UNSUPPORTED', '仅支持 png / jpg / webp / gif 图片与 mp4 / webm / ogg 视频直传')
    }
    // MIME 与文件头一致才收；声明 image/png 却传了可执行/脚本字节的一律拒绝
    const real = kind === 'image' ? sniffImage(req.body) : sniffVideo(req.body)
    if (!real) {
      return err(res, 415, kind === 'image' ? 'BAD_IMAGE' : 'BAD_FILE', '文件内容与声明类型不匹配')
    }
    if (!quotaCheck(ipOf(req), req.body.length, kind === 'image' ? IMAGE_QUOTA_BYTES_PER_HOUR : VIDEO_QUOTA_BYTES_PER_HOUR)) {
      return err(res, 429, 'QUOTA_EXCEEDED', '本小时上传额度已用完，请稍后再试')
    }
    // 按真实魔数归类（与声明不一致时以魔数为准，防扩展名误导）
    fs.mkdirSync(uploadsDir, { recursive: true })
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${real}`
    fs.writeFileSync(path.join(uploadsDir, name), req.body)
    res.json({ ok: true, url: `/api/v2/uploads/${name}`, bytes: req.body.length })
  }),
)
