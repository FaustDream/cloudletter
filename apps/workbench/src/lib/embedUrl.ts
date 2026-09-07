/**
 * 视频/网页嵌入解析（纯函数）：把可嵌入的在线视频链接解析为 iframe src，
 * 本地（自建图床）视频 URL 判定为可播放文件；其余返回 null 渲染链接卡片。
 * 站点支持：YouTube / B站 / 优酷 / 腾讯视频 / 本地文件（/api/v2/uploads/*.mp4|webm）
 */
export type EmbedHost = 'youtube' | 'bilibili' | 'youku' | 'qqvideo' | 'local'

export interface EmbedResult {
  src: string
  host: EmbedHost
}

/** 本地视频文件（自建图床 /uploads + 常见视频扩展名）→ <video> 直接播放 */
export function isLocalVideoUrl(url: string): boolean {
  const u = url.trim().toLowerCase()
  if (u.startsWith('/api/v2/uploads/')) return /\.(mp4|webm|ogg|mov)$/.test(u)
  return false
}

/** 解析在线视频链接 → 内嵌播放器地址；无法解析返回 null（渲染链接卡） */
export function resolveVideoEmbed(url: string): EmbedResult | null {
  const raw = url.trim()
  if (isLocalVideoUrl(raw)) return { src: raw, host: 'local' }

  const yt = raw.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/)
  if (yt) return { src: `https://www.youtube.com/embed/${yt[1]}`, host: 'youtube' }

  const bili = raw.match(/(?:bilibili\.com\/video\/|b23\.tv\/)(BV[\w]+)/i)
  if (bili) return { src: `https://player.bilibili.com/player.html?bvid=${bili[1]}&autoplay=0`, host: 'bilibili' }

  const youku = raw.match(/(?:v\.youku\.com\/v_show\/id_|player\.youku\.com\/embed\/)([\w=]+)/)
  if (youku) return { src: `https://player.youku.com/embed/${youku[1]}`, host: 'youku' }

  const qq = raw.match(/v\.qq\.com\/x\/(?:page\/|cover\/\w+\/)([\w]+)/)
  if (qq) return { src: `https://v.qq.com/txp/iframe/player.html?vid=${qq[1]}`, host: 'qqvideo' }

  return null
}