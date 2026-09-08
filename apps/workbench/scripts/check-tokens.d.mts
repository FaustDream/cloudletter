/** check-tokens.mjs 的类型声明（脚本本体为纯 ESM JS，供 build CLI 与 vitest 单测共用） */

export interface Violation {
  file: string
  line: number
  rule: string
  detail: string
}

export const FS_LADDER: Set<number>
export const FS_LITERAL_MIN: number
export const Z_LOCAL_MAX: number
export const PURPLE_KEYWORDS: RegExp

export function isPurpleRGB(r: unknown, g: unknown, b: unknown): boolean
export function extractHexColors(line: string): Array<[number, number, number]>
export function extractRgbColors(line: string): Array<[number, number, number]>
export function scanLine(file: string, lineNo: number, rawLine: string): Violation[]
export function scanSource(file: string, content: string): Violation[]
export function scanDir(root: string): Violation[]
