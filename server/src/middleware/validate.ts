/**
 * 轻量入参校验层（🟡S1）：统一替代散落 `if (!x) return err(...)`。
 *
 * 目标：无第三方依赖（zod 安装受环境 store 冲突阻挠），用最小结构定义 + 运行时校验，
 * 复用统一错误包络（VALIDATION 422），实现与 zod 等价的"声明式字段校验"。
 *
 * 用法：
 *   const body = validate(req, res, { email: v.str(), password: v.str() })
 *   if (!body) return
 *   body.email // string
 */
import type { NextFunction, Request, Response } from 'express'

export interface FieldSpec {
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array'
  required?: boolean
  min?: number // string: min length; number: min value; array: min items
  max?: number // string: max length; number: max value; array: max items
  optional?: boolean
  /** 允许的枚举值（string 时） */
  oneOf?: string[]
  /** 保留空字符串（'' 视为「清空」语义；默认空串按缺失丢弃） */
  keepEmpty?: boolean
  /** 对象分组：仅校验到已知键，忽略未知键（用于 settings 等） */
  allowUnknownKeys?: boolean
  children?: Record<string, FieldSpec>
  /** 数组成员规格（array 时，逐项校验；不填则只要求是数组） */
  item?: FieldSpec
}

export const v = {
  str: (): FieldSpec => ({ type: 'string' }),
  num: (): FieldSpec => ({ type: 'number' }),
  bool: (): FieldSpec => ({ type: 'boolean' }),
  arr: (item?: FieldSpec, min?: number, max?: number): FieldSpec => ({
    type: 'array',
    item: item ?? { type: 'string' },
    min,
    max,
  }),
  obj: (children?: Record<string, FieldSpec>, allowUnknownKeys = false): FieldSpec => ({
    type: 'object',
    children,
    allowUnknownKeys,
  }),
}

export interface Validated<T = Record<string, unknown>> {
  value: T
}

function fail(res: Response, message: string): void {
  res.status(422).json({ error: { code: 'VALIDATION', message, details: null } })
}

function checkField(key: string, raw: unknown, spec: FieldSpec): string | null {
  // 可选且缺失
  if (raw === undefined || raw === null || raw === '') {
    if (spec.required) return `缺少必填字段: ${key}`
    return null
  }
  // 类型
  if (spec.type === 'string' && typeof raw !== 'string') return `字段类型错误: ${key} 应为字符串`
  if (spec.type === 'number' && typeof raw !== 'number') return `字段类型错误: ${key} 应为数字`
  if (spec.type === 'boolean' && typeof raw !== 'boolean') return `字段类型错误: ${key} 应为布尔`
  if (spec.type === 'object' && (typeof raw !== 'object' || raw === null || Array.isArray(raw)))
    return `字段类型错误: ${key} 应为对象`
  if (spec.type === 'array' && !Array.isArray(raw)) return `字段类型错误: ${key} 应为数组`
  // 长度/范围
  if (spec.min !== undefined) {
    if (typeof raw === 'string' && raw.length < spec.min) return `字段 ${key} 长度不足 ${spec.min}`
    if (typeof raw === 'number' && raw < spec.min) return `字段 ${key} 不能小于 ${spec.min}`
    if (Array.isArray(raw) && raw.length < spec.min) return `字段 ${key} 至少 ${spec.min} 项`
  }
  if (spec.max !== undefined) {
    if (typeof raw === 'string' && raw.length > spec.max) return `字段 ${key} 超长（上限 ${spec.max}）`
    if (typeof raw === 'number' && raw > spec.max) return `字段 ${key} 不能大于 ${spec.max}`
    if (Array.isArray(raw) && raw.length > spec.max) return `字段 ${key} 最多 ${spec.max} 项`
  }
  // 枚举
  if (spec.oneOf && typeof raw === 'string' && !spec.oneOf.includes(raw))
    return `字段 ${key} 取值非法（允许: ${spec.oneOf.join(' / ')}）`
  // 数组成员逐项校验
  if (spec.type === 'array' && spec.item && Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const msg = checkField(`${key}[${i}]`, (raw as unknown[])[i], spec.item)
      if (msg) return msg
    }
  }
  // 嵌套对象
  if (spec.type === 'object' && spec.children && typeof raw === 'object' && raw !== null) {
    for (const [ck, cspec] of Object.entries(spec.children)) {
      const msg = checkField(`${key}.${ck}`, (raw as Record<string, unknown>)[ck], cspec)
      if (msg) return msg
    }
  }
  return null
}

/**
 * 校验 req.body 并返回规范化对象；失败时已写入 422 响应并返回 null。
 * 通过后 req.body 替换为仅含声明字段的对象（过滤未知键）。
 */
export function validateBody<T = Record<string, unknown>>(
  req: Request,
  res: Response,
  schema: Record<string, FieldSpec>,
  _next?: NextFunction,
): T | null {
  const raw = (req.body ?? {}) as Record<string, unknown>
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(res, '请求体必须为对象')
    return null
  }
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(schema)) {
    const msg = checkField(key, raw[key], spec)
    if (msg) {
      fail(res, msg)
      return null
    }
    const val = raw[key]
    if (val !== undefined && val !== null && (val !== '' || spec.keepEmpty)) out[key] = val
  }
  // 非空对象仅保留声明键
  req.body = out
  return out as T
}

/** 校验并返回错误（供中间件链使用；调用方须判断返回值） */
export function requireValid(schema: Record<string, FieldSpec>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const r = validateBody(req, res, schema)
    if (r === null) return
    next()
  }
}
