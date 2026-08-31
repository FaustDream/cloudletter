/**
 * 内容真相源层单测（最小功能）：
 * - slugify：小写化、非法字符剔除、空格转连字符、空标题兜底
 * - writePostFile：frontmatter → YAML（title/date/draft/tags/category），特殊字符加引号，原子写
 * - 版本快照：写/读/删/改名
 * 注意：POSTS_ROOT 须在动态 import 前设置（模块级常量在导入时读取）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'cl-content-test-'))
process.env.DATA_ROOT = root // 隔离版本快照目录，不污染开发数据
process.env.POSTS_ROOT = join(root, 'posts')
process.env.SETTINGS_ROOT = join(root, 'settings')

let content: typeof import('./content')

beforeAll(async () => {
  content = await import('./content')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('slugify', () => {
  it('小写化 + 空格转连字符 + 非法文件字符剔除', () => {
    expect(content.slugify('Hello World')).toBe('hello-world')
    expect(content.slugify('a/b:c*d?"<e>|#f')).toBe('abcdef')
  })

  it('空标题兜底为 post-<时间戳>', () => {
    expect(content.slugify('')).toMatch(/^post-\d+$/)
  })
})

describe('writePostFile（frontmatter → YAML）', () => {
  it('写出 title/published/draft/tags/category，正文完整', () => {
    const file = content.writePostFile({
      slug: 'demo',
      title: 'Demo',
      rawMarkdown: '# 正文\n内容',
      frontmatter: JSON.stringify({ category: '随笔', tags: ['a', 'b'] }),
      status: 'published',
      publishedAt: new Date('2026-08-30T00:00:00Z'),
    })
    const raw = readFileSync(file, 'utf-8')
    expect(raw).toContain('title: Demo')
    expect(raw).toContain('published: 2026-08-30')
    expect(raw).toContain("category: '随笔'") // 非 ASCII 值加引号
    expect(raw).toContain('tags: [a, b]')
    expect(raw).toContain('draft: false')
    expect(raw.endsWith('# 正文\n内容\n')).toBe(true)
  })

  it('含「: 」或结尾冒号的值加单引号包裹（合法 YAML）', () => {
    const file = content.writePostFile({
      slug: 'quoted',
      title: "Node: 入门",
      rawMarkdown: 'x',
      frontmatter: '{}',
      status: 'draft',
      publishedAt: null,
    })
    const raw = readFileSync(file, 'utf-8')
    expect(raw).toContain("title: 'Node: 入门'")
  })

  it('含单引号的值按 YAML 规则翻倍转义', () => {
    const file = content.writePostFile({
      slug: 'apos',
      title: "it's fine",
      rawMarkdown: 'x',
      frontmatter: '{}',
      status: 'draft',
      publishedAt: null,
    })
    expect(readFileSync(file, 'utf-8')).toContain("title: 'it''s fine'")
  })

  it('损坏的 frontmatter JSON 按空对象处理，不抛异常', () => {
    const file = content.writePostFile({
      slug: 'broken-fm',
      title: 'T',
      rawMarkdown: 'x',
      frontmatter: '{not-json',
      status: 'draft',
      publishedAt: null,
    })
    expect(existsSync(file)).toBe(true)
  })
})

describe('版本快照与文件管理', () => {
  it('writeRevisionFile → readRevisionFile 往返一致；缺文件返回 null', () => {
    content.writeRevisionFile('demo', 1, 'v1 内容')
    expect(content.readRevisionFile('demo', 1)).toBe('v1 内容')
    expect(content.readRevisionFile('demo', 99)).toBeNull()
  })

  it('renamePostAssets 同步改名文章文件与版本目录', () => {
    content.writePostFile({ slug: 'old', title: 'T', rawMarkdown: 'x', status: 'draft', publishedAt: null })
    content.writeRevisionFile('old', 1, 'v1')
    content.renamePostAssets('old', 'new')
    expect(existsSync(join(content.postsDir(), 'old.md'))).toBe(false)
    expect(existsSync(join(content.postsDir(), 'new.md'))).toBe(true)
    expect(content.readRevisionFile('new', 1)).toBe('v1')
    expect(content.readRevisionFile('old', 1)).toBeNull()
  })

  it('removePostFile / removeRevisionDir 清理文件', () => {
    content.writePostFile({ slug: 'doomed', title: 'T', rawMarkdown: 'x', status: 'draft', publishedAt: null })
    content.writeRevisionFile('doomed', 1, 'v1')
    content.removePostFile('doomed')
    content.removeRevisionDir('doomed')
    expect(existsSync(join(content.postsDir(), 'doomed.md'))).toBe(false)
    expect(content.readRevisionFile('doomed', 1)).toBeNull()
  })
})
