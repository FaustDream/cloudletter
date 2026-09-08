// 设计令牌纪律检查（DESIGN-SPEC §9 令牌清单 / §10 执行机制的自动化门禁）
//
// 规则（命中即违规，exit 1 阻断 build）：
//   R1 紫色禁止    —— hex / rgb(a) 通用判定 + 紫色系颜色关键字（时间线六色之外禁紫）
//   R2 字号阶梯    —— 整数字号 10–16px 必须取 var(--fs-*)；小数微调值与 ≥17px 展示字允许字面；<10px 整数禁止
//   R3 层叠阶梯    —— z-index ≥ 30 为跨组件浮层，必须取 var(--z-*)；< 30 视为局部层叠放行
//   R4 玻璃模糊    —— blur(Npx) 字面量禁止，必须取 var(--glass-blur-*)
//
// 豁免机制：行内注释含 `design-ok`（建议附原因），如：/* design-ok: 导出为独立 HTML，无应用令牌可用 */
// 接线：apps/workbench package.json → build 前置执行（`node scripts/check-tokens.mjs && tsc -b && vite build`）
// 测试：tests/workbench/scripts/check-tokens.test.ts（纯函数单测，随 vitest 运行）

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

/** 字号阶梯值（与 main.css :root --fs-* 一一对应） */
export const FS_LADDER = new Set([10, 11, 12, 13, 14, 15, 16, 18, 22])
/** 展示字面量下限：≥17px 的整数展示字允许字面（阶梯 18/22 亦可字面） */
export const FS_LITERAL_MIN = 17
/** 局部层叠上限：<30 视为组件内部层叠，字面量放行 */
export const Z_LOCAL_MAX = 29
/** 紫色系颜色关键字（CSS 命名色；rebeccapurple 需整体列出，否则前缀字母会挡住边界判定） */
export const PURPLE_KEYWORDS = /(?:^|[^a-z-])(rebeccapurple|purple|violet|fuchsia|magenta|orchid|lavender|plum|lilac|amethyst)\b/i

/** 紫色通用判定：蓝 > 红 ≥ 绿 且 蓝-绿 差值明显（红蓝双高、绿被压低 = 紫色系） */
export function isPurpleRGB(r, g, b) {
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return false
  return b > r && r >= g && b - g > 40
}

/** 解析一行内的全部 hex 颜色为 [r, g, b]（支持 3/6/8 位） */
export function extractHexColors(line) {
  const out = []
  for (const m of line.matchAll(/#([0-9a-f]{3,8})\b/gi)) {
    let h = m[1].toLowerCase()
    if (h.length === 4 || h.length === 5) h = h.slice(0, 3) // #rgba → 保留 rgb
    if (h.length === 7 || h.length === 8) h = h.slice(0, 6) // #rrggbbaa → 保留 rrggbb
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    if (h.length !== 6) continue
    out.push([parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)])
  }
  return out
}

/** 解析一行内的全部 rgb()/rgba() 前三通道 */
export function extractRgbColors(line) {
  const out = []
  for (const m of line.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi)) {
    out.push([Number(m[1]), Number(m[2]), Number(m[3])])
  }
  return out
}

/** 去掉注释内容，避免注释里的示例色/关键字误报（豁免标记在原文行判断） */
function stripComments(line) {
  return line.replace(/\/\*.*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/, '$1')
}

/** 检查单行（豁免行返回空）。lineNo 从 1 起；file 为相对路径，仅用于报告。 */
export function scanLine(file, lineNo, rawLine) {
  if (rawLine.includes('design-ok')) return []
  const line = stripComments(rawLine)
  const v = []

  // R1 紫色禁止
  if (PURPLE_KEYWORDS.test(line)) {
    v.push({ file, line: lineNo, rule: 'R1-紫色禁止', detail: '使用了紫色系颜色关键字' })
  }
  for (const [r, g, b] of [...extractHexColors(line), ...extractRgbColors(line)]) {
    if (isPurpleRGB(r, g, b)) {
      v.push({ file, line: lineNo, rule: 'R1-紫色禁止', detail: `紫色系颜色 rgb(${r}, ${g}, ${b})` })
    }
  }

  // R2 字号阶梯（CSS font-size 与 TSX fontSize 同规则）
  for (const m of line.matchAll(/font-?[Ss]ize:\s*'?(\d+(?:\.\d+)?)'?/g)) {
    const n = Number(m[1])
    if (Number.isInteger(n) && n >= FS_LITERAL_MIN) continue // ≥17px 展示字允许字面
    if (!Number.isInteger(n)) continue // 小数微调值允许字面
    if (FS_LADDER.has(n)) {
      v.push({ file, line: lineNo, rule: 'R2-字号阶梯', detail: `font-size: ${n}px 是阶梯值，必须写作 var(--fs-*)` })
    } else {
      v.push({ file, line: lineNo, rule: 'R2-字号阶梯', detail: `font-size: ${n}px 低于阶梯下限（10px），禁止更小整数` })
    }
  }

  // R3 层叠阶梯
  for (const m of line.matchAll(/z-?[Ii]ndex:\s*(-?\d+)/g)) {
    const n = Number(m[1])
    if (n > Z_LOCAL_MAX) {
      v.push({ file, line: lineNo, rule: 'R3-层叠阶梯', detail: `z-index: ${n} 为跨组件浮层（≥30），必须写作 var(--z-*)` })
    }
  }

  // R4 玻璃模糊
  for (const m of line.matchAll(/blur\(\s*\d+(?:\.\d+)?px/g)) {
    v.push({ file, line: lineNo, rule: 'R4-玻璃模糊', detail: `${m[0]}) 必须写作 blur(var(--glass-blur-*))` })
  }

  return v
}

/** 扫描一段源码文本 */
export function scanSource(file, content) {
  const v = []
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) v.push(...scanLine(file, i + 1, lines[i]))
  return v
}

/** 扫描目录树（.css/.ts/.tsx），返回全部违规 */
export function scanDir(root) {
  const v = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(css|ts|tsx)$/.test(name)) continue
      v.push(...scanSource(relative(root, p).split(sep).join('/'), readFileSync(p, 'utf8')))
    }
  }
  walk(root)
  return v
}

/** CLI 入口：pnpm check:design / build 前置门禁 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const srcRoot = fileURLToPath(new URL('../src', import.meta.url))
  const violations = scanDir(srcRoot)
  if (violations.length) {
    console.error(`✗ 设计令牌纪律检查未通过（${violations.length} 处违规）：\n`)
    for (const { file, line, rule, detail } of violations) {
      console.error(`  ${file}:${line}  [${rule}]  ${detail}`)
    }
    console.error('\n修复方式：改用 var(--fs-*) / var(--z-*) / var(--glass-blur-*) 令牌；')
    console.error('确属特例的，在行内加 `design-ok: 原因` 显式豁免（DESIGN-SPEC §10）。')
    process.exit(1)
  }
  console.log('✓ 设计令牌纪律检查通过（紫色 / 字号 / 层叠 / 模糊）')
}
