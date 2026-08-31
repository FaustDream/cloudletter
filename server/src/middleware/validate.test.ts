/**
 * 轻量校验层单测（最小功能）：必填/类型/长度/枚举/数组成员/未知键过滤/keepEmpty 空串语义。
 */
import { describe, it, expect } from 'vitest'
import { validateBody, v, type FieldSpec } from './validate'
import type { Request, Response } from 'express'

/** 构造最小 req/res：validateBody 失败时写 422 JSON，返回 null */
function makeReqRes(body: unknown): { req: Request; res: Response; json: { status?: number; data?: unknown } } {
  const json: { status?: number; data?: unknown } = {}
  const req = { body } as unknown as Request
  const res = {
    status(code: number) { json.status = code; return this },
    json(data: unknown) { json.data = data; return this },
  } as unknown as Response
  return { req, res, json }
}

function run(schema: Record<string, FieldSpec>, body: unknown) {
  const { req, res, json } = makeReqRes(body)
  const out = validateBody(req, res, schema)
  return { out, json }
}

describe('validateBody（字段校验）', () => {
  it('通过校验返回字段值', () => {
    const { out, json } = run({ name: { ...v.str(), required: true, min: 1, max: 5 } }, { name: '云笺' })
    expect(out).toEqual({ name: '云笺' })
    expect(json.status).toBeUndefined()
  })

  it('缺失必填字段 → 422 VALIDATION', () => {
    const { out, json } = run({ name: { ...v.str(), required: true } }, {})
    expect(out).toBeNull()
    expect(json.status).toBe(422)
    expect((json.data as any).error.code).toBe('VALIDATION')
  })

  it('类型错误：数字字段收到字符串 → 422', () => {
    const { out } = run({ n: v.num() }, { n: '42' })
    expect(out).toBeNull()
  })

  it('长度越界（string min/max）→ 422', () => {
    expect(run({ s: { ...v.str(), min: 2 } }, { s: 'a' }).out).toBeNull()
    expect(run({ s: { ...v.str(), max: 2 } }, { s: 'abc' }).out).toBeNull()
  })

  it('枚举 oneOf：合法通过，非法 422', () => {
    const spec = { s: { ...v.str(), oneOf: ['draft', 'published'] } }
    expect(run(spec, { s: 'draft' }).out).toEqual({ s: 'draft' })
    expect(run(spec, { s: 'archived' }).out).toBeNull()
  })

  it('数组：逐项校验成员类型，非数组 422', () => {
    const spec = { tags: v.arr(v.str(), 1, 2) }
    expect(run(spec, { tags: ['a', 'b'] }).out).toEqual({ tags: ['a', 'b'] })
    expect(run(spec, { tags: ['a', 1] }).out).toBeNull()
    expect(run(spec, { tags: [] }).out).toBeNull() // 少于 min
    expect(run(spec, { tags: 'a' }).out).toBeNull()
  })

  it('未知键被过滤，仅保留声明字段', () => {
    const { out } = run({ a: v.str() }, { a: 'x', evil: 'drop-me' })
    expect(out).toEqual({ a: 'x' })
  })

  it('默认丢弃空字符串；keepEmpty: true 保留（清空语义）', () => {
    const { out } = run({ a: v.str(), b: { ...v.str(), keepEmpty: true } }, { a: '', b: '' })
    expect(out).toEqual({ b: '' })
  })

  it('undefined / null 一律丢弃', () => {
    const { out } = run({ a: v.str(), b: { ...v.str(), keepEmpty: true } }, { a: undefined, b: null })
    expect(out).toEqual({})
  })

  it('非对象请求体 → 422', () => {
    expect(run({ a: v.str() }, ['not', 'an', 'object']).out).toBeNull()
  })
})
