/**
 * 云笺集 · 存储序列化器（设计稿 §5 / §20.2）
 *
 * Markdown 文本 ↔ Block[] 双向转换，覆盖 §5.2 五类富块：
 *   1. 接口块   ```api ... ```
 *   2. 参数表   ```params ... ```
 *   3. 提示框   :::note|tip|warning|danger ... :::
 *   4. 双链     [[目标|显示]]（行内，保留在 text 块中，渲染层解析）
 *   5. 代码块   ```lang title="..." {行高亮} ```
 *
 * 契约（§5.3）：
 *   R1 每类块可 toMarkdown / parse 往返
 *   R2 未知围栏降级为普通代码块，绝不丢弃内容
 *   R3 parse ∘ serialize ∘ parse ≡ parse（语义等价，字段顺序规范化）
 *   R4 frontmatter 原样保留
 */

export interface ApiParam {
  name: string
  in?: string
  type: string
  required: boolean
  default?: string
  desc: string
}

export interface ApiResponse {
  status: number
  desc: string
  body?: string
}

export type CalloutKind = 'note' | 'tip' | 'warning' | 'danger'

export type Block =
  | { t: 'frontmatter'; raw: string }
  | { t: 'api'; method: string; path: string; summary?: string; params: ApiParam[]; responses: ApiResponse[] }
  | { t: 'params'; params: ApiParam[] }
  | { t: 'callout'; kind: CalloutKind; text: string }
  | { t: 'code'; lang: string; title?: string; marks?: number[]; lines: string[] }
  | { t: 'text'; md: string }

/* ========== 工具 ========== */

const FENCE_RE = /^```([A-Za-z0-9_+\-]*)(.*)$/
const CALLOUT_RE = /^:::(note|tip|warning|danger)\s*$/
const TOP_KEY_RE = /^([A-Za-z_][\w-]*):\s*(.*)$/
const LIST_ITEM_RE = /^(\s*)-\s+([\w-]+):\s*(.*)$/
const INDENT_KEY_RE = /^(\s+)([\w-]+):\s*(.*)$/

function indentOf(line: string): number {
  let n = 0
  while (line[n] === ' ') n++
  return n
}

/** 去掉 YAML 风格标量的包裹引号（💭R1 配套：同时反转义双引号字符串） */
function unquote(v: string): string {
  const s = v.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1)
  }
  return s
}

/** 解析 "title=\"x.ts\" {2,5}" 形式的代码块元信息 */
function parseCodeMeta(meta: string): { title?: string; marks?: number[] } {
  const out: { title?: string; marks?: number[] } = {}
  const t = meta.match(/title="([^"]*)"/)
  if (t) out.title = t[1]
  const m = meta.match(/\{([\d,\s]+)\}/)
  if (m) out.marks = m[1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
  return out
}

/* ========== api / params 块的 YAML 风格解析 ========== */

export function parseScalarListBody(body: string, root: 'api' | 'params'): Block {
  if (root === 'params') {
    return { t: 'params', params: parseParamItems(body, 0) }
  }
  const lines = body.split('\n')
  const api: Extract<Block, { t: 'api' }> = {
    t: 'api',
    method: 'GET',
    path: '',
    summary: '',
    params: [],
    responses: [],
  }
  let currentList: 'params' | 'responses' | null = null
  let currentIndent = 0
  const paramsRaw: Record<string, unknown>[] = []
  const responsesRaw: Record<string, unknown>[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    const top = line.match(TOP_KEY_RE)
    if (top && indentOf(line) === 0) {
      const [, key, val] = top
      if (key === 'params' || key === 'responses') {
        currentList = key
        currentIndent = 0
      } else {
        currentList = null
        // 💭N4 显式字段映射（替代 (api as any)[key]）
        if (key === 'method') api.method = unquote(val)
        else if (key === 'path') api.path = unquote(val)
        else if (key === 'summary') api.summary = unquote(val)
      }
      i++
      continue
    }

    // 列表项或缩进键（仅在当前处于 params/responses 列表时）
    const item = line.match(LIST_ITEM_RE)
    if (currentList && item) {
      const list = currentList === 'params' ? paramsRaw : responsesRaw
      list.push({ [item[2]]: unquote(item[3]) })
      currentIndent = item[1].length
      i++
      continue
    }

    const ind = line.match(INDENT_KEY_RE)
    if (currentList && ind) {
      const list = currentList === 'params' ? paramsRaw : responsesRaw
      const cur = list[list.length - 1]
      const [, rawIndent, key, val] = ind
      if (cur && rawIndent.length > currentIndent) {
        if (val.trim() === '|') {
          // 多行 body：收集比当前键更深缩进的行（含空行）
          const blockIndent = rawIndent.length + 2
          const buf: string[] = []
          i++
          while (i < lines.length) {
            const l = lines[i]
            if (l.trim() !== '' && indentOf(l) < blockIndent) break
            buf.push(l.slice(Math.min(blockIndent, l.length)))
            i++
          }
          cur[key] = buf.join('\n').replace(/\s+$/, '')
          continue
        }
        cur[key] = unquote(val)
      }
      i++
      continue
    }

    i++
  }

  // 规范化类型
  api.params = paramsRaw.map(normalizeParam)
  api.responses = responsesRaw.map((r) => ({
    status: Number(r.status ?? 0),
    desc: String(r.desc ?? ''),
    body: r.body ? String(r.body) : undefined,
  }))
  return api
}

/** 解析 ```params 块的参数列表（无顶层 key，直接 - name: ... 开始） */
function parseParamItems(body: string, _baseIndent: number): ApiParam[] {
  const lines = body.split('\n')
  const items: Record<string, string>[] = []
  let currentIndent = 0
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }
    const item = line.match(LIST_ITEM_RE)
    if (item) {
      // 💭R1 配套：list item 的标量值同样需要 unquote，保证带引号序列化后可往返
      items.push({ [item[2]]: unquote(item[3]) })
      currentIndent = item[1].length
      i++
      continue
    }
    const ind = line.match(INDENT_KEY_RE)
    if (ind && items.length && ind[1].length > currentIndent) {
      const cur = items[items.length - 1]
      if (ind[3].trim() === '|') {
        const blockIndent = ind[1].length + 2
        const buf: string[] = []
        i++
        while (i < lines.length) {
          const l = lines[i]
          if (l.trim() !== '' && indentOf(l) < blockIndent) break
          buf.push(l.slice(Math.min(blockIndent, l.length)))
          i++
        }
        cur[ind[2]] = buf.join('\n')
        continue
      }
      cur[ind[2]] = unquote(ind[3])
      i++
      continue
    }
    i++
  }
  return items.map(normalizeParam)
}

function normalizeParam(raw: Record<string, unknown>): ApiParam {
  return {
    name: String(raw.name ?? ''),
    in: raw.in !== undefined && raw.in !== '' ? String(raw.in) : undefined,
    type: String(raw.type ?? 'string'),
    required: String(raw.required ?? 'false') === 'true',
    default: raw.default !== undefined && raw.default !== '' ? String(raw.default) : undefined,
    desc: String(raw.desc ?? ''),
  }
}

/* ========== 序列化（Block[] -> Markdown） ========== */

/**
 * YAML 标量安全序列化（💭R1）：统一加双引号。
 * 防止 desc/name/path 等含 `:`、前导/尾随空格、特殊字符时破坏 YAML 解析
 * （parse 侧 unquote() 已能正确去引号，往返语义保持不变）。
 */
function yq(v: string): string {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function paramToYaml(p: ApiParam, indent: string): string {
  const lines = [`${indent}- name: ${yq(p.name)}`]
  if (p.in) lines.push(`${indent}  in: ${yq(p.in)}`)
  lines.push(`${indent}  type: ${yq(p.type)}`)
  lines.push(`${indent}  required: ${p.required ? 'true' : 'false'}`)
  if (p.default !== undefined && p.default !== '') lines.push(`${indent}  default: ${yq(p.default)}`)
  lines.push(`${indent}  desc: ${yq(p.desc)}`)
  return lines.join('\n')
}

function apiToYaml(b: Extract<Block, { t: 'api' }>): string {
  const lines: string[] = [`method: ${yq(b.method)}`, `path: ${yq(b.path)}`]
  if (b.summary) lines.push(`summary: ${yq(b.summary)}`)
  if (b.params.length) {
    lines.push('params:')
    for (const p of b.params) lines.push(paramToYaml(p, '  '))
  }
  if (b.responses.length) {
    lines.push('responses:')
    for (const r of b.responses) {
      lines.push(`  - status: ${r.status}`)
      lines.push(`    desc: ${yq(r.desc)}`)
      if (r.body !== undefined && r.body !== '') {
        lines.push('    body: |')
        for (const l of r.body.split('\n')) lines.push(`      ${l}`)
      }
    }
  }
  return lines.join('\n')
}

export function serialize(blocks: Block[]): string {
  const parts = blocks.map((b) => {
    switch (b.t) {
      case 'frontmatter':
        return `---\n${b.raw.replace(/\s+$/, '')}\n---`
      case 'api':
        return '```api\n' + apiToYaml(b) + '\n```'
      case 'params':
        return (
          '```params\n' +
          b.params.map((p) => paramToYaml(p, '')).join('\n') +
          '\n```'
        )
      case 'callout':
        return `:::${b.kind}\n${b.text}\n:::`
      case 'code': {
        const meta = [
          b.title ? `title="${b.title}"` : '',
          b.marks?.length ? `{${b.marks.join(',')}}` : '',
        ]
          .filter(Boolean)
          .join(' ')
        return '```' + b.lang + (meta ? ' ' + meta : '') + '\n' + b.lines.join('\n') + '\n```'
      }
      case 'text':
        return b.md
    }
  })
  return parts.filter((p) => p !== '').join('\n\n') + '\n'
}

/* ========== 解析（Markdown -> Block[]） ========== */

export function parse(md: string): Block[] {
  const blocks: Block[] = []
  // 统一行尾（Windows CRLF / 老 Mac CR → LF），否则 `$` 锚点无法匹配 fence/callout
  const lines = md.replace(/\r\n?/g, '\n').split('\n')

  // R4: frontmatter 原样保留
  let i = 0
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    const fm: string[] = []
    i = 1
    while (i < lines.length && lines[i].trim() !== '---') {
      fm.push(lines[i])
      i++
    }
    if (i < lines.length) i++ // 跳过收尾 ---
    blocks.push({ t: 'frontmatter', raw: fm.join('\n') })
  }

  while (i < lines.length) {
    const line = lines[i]

    // 围栏块 ```lang [meta]（含空 lang 围栏，如 ``` 用于 ASCII 图）
    const fence = line.match(FENCE_RE)
    if (fence) {
      const lang = fence[1]
      const meta = fence[2] ?? ''
      const body: string[] = []
      i++
      while (i < lines.length && !/^(```|~~~)/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // 跳过结束围栏
      if (lang === 'api' || lang === 'params') {
        blocks.push(parseScalarListBody(body.join('\n'), lang))
      } else {
        const { title, marks } = parseCodeMeta(meta)
        blocks.push({ t: 'code', lang, title, marks, lines: body })
      }
      continue
    }

    // 容器 :::kind ... :::
    const cont = line.match(CALLOUT_RE)
    if (cont) {
      const text: string[] = []
      i++
      while (i < lines.length && !/^:::/.test(lines[i])) {
        text.push(lines[i])
        i++
      }
      i++ // 跳过收尾 :::
      blocks.push({ t: 'callout', kind: cont[1] as CalloutKind, text: text.join('\n').trim() })
      continue
    }

    // 普通段落（合并连续非特殊行；双链 [[...]] 保留在文本中由渲染层处理，§5.2.4）
    // 注：正文中的 `---` 水平线保留在 text 块中（不作为段落终止符），避免内容丢失
    const para: string[] = []
    while (
      i < lines.length &&
      !FENCE_RE.test(lines[i]) &&
      !CALLOUT_RE.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    if (para.length) {
      const md2 = para.join('\n').replace(/^\s+/, '').replace(/\s+$/, '')
      if (md2.trim() !== '') blocks.push({ t: 'text', md: md2 })
    } else {
      i++ // 防御：跳过无法归类的行（如孤立的 ---）
    }
  }
  return blocks
}

/* ========== 文档级 API（含 frontmatter） ========== */

export function parseDocument(md: string): { frontmatter: string; blocks: Block[] } {
  const blocks = parse(md)
  const fm = blocks.find((b) => b.t === 'frontmatter')
  return {
    frontmatter: fm && fm.t === 'frontmatter' ? fm.raw : '',
    blocks: blocks.filter((b) => b.t !== 'frontmatter'),
  }
}

export function serializeDocument(frontmatter: string, blocks: Block[]): string {
  const all: Block[] = frontmatter.trim() ? [{ t: 'frontmatter', raw: frontmatter }, ...blocks] : blocks
  return serialize(all)
}

/* ========== 双链提取（构建期反链扫描用，§5.2.4） ========== */

export interface Wikilink {
  target: string
  label?: string
}

export function extractWikilinks(md: string): Wikilink[] {
  const out: Wikilink[] = []
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    out.push({ target: m[1].trim(), label: m[2]?.trim() })
  }
  return out
}

/* ========== 语义等价比较（R3 测试用） ========== */

export function normalizeBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    if (b.t === 'text') return { t: 'text', md: b.md.replace(/\s+$/, '') }
    if (b.t === 'frontmatter') return { t: 'frontmatter', raw: b.raw.replace(/\s+$/, '') }
    if (b.t === 'code') return { t: 'code', lang: b.lang, title: b.title, marks: b.marks ?? [], lines: b.lines }
    if (b.t === 'api') {
      return {
        t: 'api',
        method: b.method,
        path: b.path,
        summary: b.summary || '',
        params: b.params.map((p) => ({
          name: p.name,
          in: p.in,
          type: p.type,
          required: p.required,
          default: p.default,
          desc: p.desc,
        })),
        responses: b.responses.map((r) => ({
          status: r.status,
          desc: r.desc,
          body: r.body,
        })),
      }
    }
    if (b.t === 'params') {
      return {
        t: 'params',
        params: b.params.map((p) => ({
          name: p.name,
          in: p.in,
          type: p.type,
          required: p.required,
          default: p.default,
          desc: p.desc,
        })),
      }
    }
    return b
  })
}
