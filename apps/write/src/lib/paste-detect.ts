/**
 * 粘贴自动识别（ADR-006 / §5.3 R5）：
 * 从外部粘贴的片段启发式检测并转成结构化块语法。
 *   - 含 method:/path:/responses: → ```api 接口块
 *   - Markdown 表格且列为参数名/类型/必填… → ```params 参数表
 *   - GFM 警告（> [!NOTE] 等）→ :::callout
 * 未命中任何规则的文本原样返回（返回 null 表示不改写）。
 */

type CalloutKind = 'note' | 'tip' | 'warning' | 'danger'

export function detectPasted(text: string): string | null {
  const t = text.trim()
  if (!t) return null

  // 1) 接口片段：method/path/responses 关键字段
  if (/^\s*(method|path|summary)\s*:/m.test(t) && /(method|path|responses)\s*:/m.test(t)) {
    return '```api\n' + normalizeApiYaml(t) + '\n```'
  }

  // 2) 参数表：Markdown 表格，表头含参数语义列
  if (t.includes('|')) {
    const params = markdownTableToParams(t)
    if (params) return params
  }

  // 3) GFM 警告块 → callout
  const gfm = t.match(/^>\s*\[!(NOTE|TIP|WARNING|CAUTION|DANGER|IMPORTANT)\]\s*\n((?:^>.*\n?)+)/mi)
  if (gfm) {
    const kind = mapGfmKind(gfm[1].toLowerCase())
    const body = gfm[2]
      .split('\n')
      .map((l) => l.replace(/^>\s?/, ''))
      .join('\n')
      .trim()
    return `:::${kind}\n${body}\n:::`
  }

  return null
}

/** 粘贴的接口片段可能不是规范 YAML：做最小归一（去掉多余空行，保持原顺序） */
function normalizeApiYaml(t: string): string {
  return t
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n')
}

const HEADER_ALIASES: Record<string, string> = {
  参数: 'name',
  名称: 'name',
  参数名: 'name',
  字段: 'name',
  name: 'name',
  位置: 'in',
  in: 'in',
  类型: 'type',
  type: 'type',
  必填: 'required',
  必须: 'required',
  required: 'required',
  默认: 'default',
  默认值: 'default',
  default: 'default',
  说明: 'desc',
  描述: 'desc',
  备注: 'desc',
  desc: 'desc',
  description: 'desc',
}

function markdownTableToParams(t: string): string | null {
  const lines = t.split('\n').filter((l) => l.trim() !== '')
  if (lines.length < 2) return null
  // 解析表头
  const parseRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())

  const header = parseRow(lines[0]).map((h) => HEADER_ALIASES[h.toLowerCase()] ?? null)
  const isDivider = /^\|?[\s:-]+\|[\s:|-]*$/.test(lines[1] ?? '')
  // 必须含 name 列 + 至少 type/desc/required 之一，才认定是参数表
  if (!header.includes('name')) return null
  if (!header.some((h) => h && ['type', 'desc', 'required'].includes(h))) return null
  if (!isDivider && lines.length < 2) return null

  const dataLines = isDivider ? lines.slice(2) : lines.slice(1)
  const items = dataLines
    .map((line) => parseRow(line))
    .filter((cells) => cells.some((c) => c !== ''))
    .map((cells) => {
      const item: Record<string, string> = {}
      header.forEach((h, i) => {
        if (h) item[h] = cells[i] ?? ''
      })
      return item
    })
  if (items.length === 0) return null

  const body = items
    .map((p) => {
      const lines2 = [`- name: ${p.name ?? ''}`]
      if (p.in) lines2.push(`  in: ${p.in}`)
      lines2.push(`  type: ${p.type || 'string'}`)
      const req = /^(是|必填|true|yes|y)$/i.test(p.required ?? '') ? 'true' : 'false'
      lines2.push(`  required: ${req}`)
      if (p.default) lines2.push(`  default: "${p.default}"`)
      lines2.push(`  desc: ${p.desc ?? ''}`)
      return lines2.join('\n')
    })
    .join('\n')
  return '```params\n' + body + '\n```'
}

function mapGfmKind(gfm: string): CalloutKind {
  switch (gfm) {
    case 'tip':
      return 'tip'
    case 'caution':
    case 'warning':
      return 'warning'
    case 'danger':
      return 'danger'
    default:
      return 'note' // note / important
  }
}
