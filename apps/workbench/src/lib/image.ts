/** 编辑器图片压缩：长边 ≤2000px、JPEG q0.85（GIF 保留动图原样，小图不重压） */

export async function compressImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.size < 200 * 1024) return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  if (scale === 1 && (file.type === 'image/jpeg' || file.type === 'image/webp')) return file
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.85))
  return blob ?? file
}