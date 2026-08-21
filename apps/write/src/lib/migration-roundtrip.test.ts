// @ts-nocheck  // 本测试用 node:fs 读外部文章目录，前端 tsconfig 无 node 类型
/**
 * M4 内容迁移往返校验（§5.3 R3：parse ∘ serialize ∘ parse ≡ parse）
 * 对现有 posts 跑往返，验证 serializer 能无损处理现有内容（含 CRLF/水平线/空 lang 围栏）。
 * 仅在能访问 fuwari-blog 文章目录时运行（CI 单独构建 write 时跳过）。
 */
import { describe, it, expect } from 'vitest'
import { parse, serialize, normalizeBlocks } from './serializer'
import fs from 'node:fs'
import path from 'node:path'

function walk(dir: string): string[] {
  const out: string[] = []
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) out.push(...walk(p))
    else if (f.endsWith('.md')) out.push(p)
  }
  return out
}

const postsDir = path.resolve(process.cwd(), '../../fuwari-blog/src/content/posts')
let files: string[] = []
try {
  files = walk(postsDir)
} catch {
  files = []
}

describe('M4 内容迁移往返校验（R3）', () => {
  it.skipIf(files.length === 0)(`现有 ${files.length} 篇文章 parse→serialize→parse 语义等价`, () => {
    const fails: Array<{ file: string; reason: string }> = []
    for (const file of files) {
      const md = fs.readFileSync(file, 'utf-8')
      const once = JSON.stringify(normalizeBlocks(parse(md)))
      const twice = JSON.stringify(normalizeBlocks(parse(serialize(parse(md)))))
      if (once !== twice) {
        const b1 = normalizeBlocks(parse(md))
        const b2 = normalizeBlocks(parse(serialize(parse(md))))
        const diffIdx = b1.findIndex((b, i) => JSON.stringify(b) !== JSON.stringify(b2[i]))
        fails.push({
          file: path.relative(postsDir, file),
          reason: `块[${diffIdx}] 类型 ${b1[diffIdx]?.t} 不一致（总数 ${b1.length} vs ${b2.length}）`,
        })
      }
    }
    if (fails.length) {
      // eslint-disable-next-line no-console
      console.error('[M4 roundtrip] 失败：\n' + fails.map((f) => `  - ${f.file}: ${f.reason}`).join('\n'))
    }
    expect(fails).toEqual([])
  })
})
