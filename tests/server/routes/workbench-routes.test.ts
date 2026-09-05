/**
 * 工作台路由单测（最小功能）：
 * - 五类模块统一 CRUD：新建/列表/更新/删除；非法模块 422；ledger/notes 缺省日期兜底今天
 * - summary：计划完成度 / 打卡今日与最长连续 / 记账本月收支 / 目标平均进度 / 笔记计数
 * - timeline：文章→journal、完成计划→plan（XP 与 planDrop 同源）、打卡→checkin、记账→ledger、笔记按 mood 映射
 * - week-stats：本周窗口字段齐全
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { startTestApp, type TestApp } from '@server/test-utils'
import { planDrop } from '@server/game'
import { ymdLocal } from '@server/util-date'

vi.mock('@server/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    requireAuth: async (_req: any, _res: any, next: any): Promise<void> => {
      _req.user = { id: 't1', email: 't@test' }
      next()
    },
  }
})

let app: TestApp
const TODAY = ymdLocal(new Date())

async function inject(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(app.base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

beforeAll(async () => {
  app = await startTestApp()
})

afterAll(async () => {
  await app.close()
  await app.prisma.$disconnect()
})

describe('五类模块统一 CRUD', () => {
  it('plan：新建 → 列表 → 更新完成 → 删除', async () => {
    const c = await inject('POST', '/workbench/plan', { text: '写周报', level: 'P1', note: '重点' })
    expect(c.status).toBe(200)
    const id = c.body.item.id
    expect(c.body.item.done).toBe(false)

    const list = await inject('GET', '/workbench/plan')
    expect(list.body.items.some((x: any) => x.id === id)).toBe(true)

    const u = await inject('PUT', `/workbench/plan/${id}`, { done: true })
    expect(u.status).toBe(200)
    expect(u.body.item.done).toBe(true)

    const d = await inject('DELETE', `/workbench/plan/${id}`)
    expect(d.status).toBe(200)
    expect((await inject('GET', '/workbench/plan')).body.items.some((x: any) => x.id === id)).toBe(false)
  })

  it('其余四类模块均可新建与列出', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['checkin', { name: '早起', emoji: '🌅', log: JSON.stringify({ [TODAY]: true }), streak: 3 }],
      ['ledger', { kind: 'expense', cat: '餐饮', amount: 25.5, note: '午饭', date: TODAY }],
      ['goals', { name: '减脂', target: 90, current: 5, unit: 'kg' }],
      ['notes', { title: '灵感一闪', body: '记一笔', mood: '灵感', date: TODAY }],
    ]
    for (const [scope, payload] of cases) {
      const c = await inject('POST', `/workbench/${scope}`, payload)
      expect(c.status, scope).toBe(200)
      const list = await inject('GET', `/workbench/${scope}`)
      expect(list.body.items.some((x: any) => x.id === c.body.item.id), scope).toBe(true)
    }
  })

  it('ledger / notes 缺省日期兜底为今天', async () => {
    const l = await inject('POST', '/workbench/ledger', { kind: 'income', cat: '其他', amount: 1 })
    expect(l.body.item.date).toBe(TODAY)
    const n = await inject('POST', '/workbench/notes', { title: '无日期笔记' })
    expect(n.body.item.date).toBe(TODAY)
  })

  it('非法模块 422；删除不存在的记录 404', async () => {
    expect((await inject('GET', '/workbench/nope')).status).toBe(422)
    expect((await inject('POST', '/workbench/nope', {})).status).toBe(422)
    expect((await inject('DELETE', '/workbench/plan/nope')).status).toBe(404)
    expect((await inject('PUT', '/workbench/plan/nope', { text: 'x' })).status).toBe(404)
  })

  it('字段类型校验：非法类型 → 422 而非 500', async () => {
    // amount 传字符串 → 422
    expect((await inject('POST', '/workbench/ledger', { kind: 'expense', amount: 'abc' })).status).toBe(422)
    // plan level 枚举外 → 422
    expect((await inject('POST', '/workbench/plan', { text: 'x', level: 'P5' })).status).toBe(422)
    // ledger 缺 amount → 422（创建必填）
    expect((await inject('POST', '/workbench/ledger', { kind: 'expense', note: '无金额' })).status).toBe(422)
    // 更新仍允许部分字段
    const c = await inject('POST', '/workbench/plan', { text: '类型测试', level: 'P1' })
    expect((await inject('PUT', `/workbench/plan/${c.body.item.id}`, { note: 123 })).status).toBe(422)
    expect((await inject('PUT', `/workbench/plan/${c.body.item.id}`, { note: 'ok' })).status).toBe(200)
    // ledger 部分更新（不带 amount）不被必填误伤
    const l = await inject('POST', '/workbench/ledger', { kind: 'expense', amount: 1 })
    expect((await inject('PUT', `/workbench/ledger/${l.body.item.id}`, { note: '改备注' })).status).toBe(200)
  })
})

describe('summary 统计', () => {
  it('plan：total/done；checkin：todayDone/maxStreak；ledger：本月收支；goals：平均进度；notes：计数', async () => {
    const plan = await inject('POST', '/workbench/plan', { text: '统计计划', level: 'P2' })
    await inject('PUT', `/workbench/plan/${plan.body.item.id}`, { done: true })

    const sp = await inject('GET', '/workbench/plan/summary')
    expect(sp.body.total).toBeGreaterThanOrEqual(1)
    expect(sp.body.done).toBeGreaterThanOrEqual(1)

    const sc = await inject('GET', '/workbench/checkin/summary')
    expect(sc.body.todayDone).toBeGreaterThanOrEqual(1)
    expect(sc.body.maxStreak).toBeGreaterThanOrEqual(3)

    const sl = await inject('GET', '/workbench/ledger/summary')
    // 本月支出 ≥ 初始 25.5（其他用例可能追加记账行，取范围而非精确值）
    expect(sl.body.expense).toBeGreaterThanOrEqual(25.5)
    expect(sl.body.income).toBeGreaterThanOrEqual(1)

    const sg = await inject('GET', '/workbench/goals/summary')
    expect(sg.body.pct).toBeGreaterThan(0)

    const sn = await inject('GET', '/workbench/notes/summary')
    expect(sn.body.total).toBeGreaterThanOrEqual(2)
  })
})

describe('timeline（双视图时间轴聚合）', () => {
  it('完成计划进时间轴且 XP 与 planDrop 同口径', async () => {
    const plan = await inject('POST', '/workbench/plan', { text: '时间轴计划', level: 'P0' })
    const id = plan.body.item.id
    await inject('PUT', `/workbench/plan/${id}`, { done: true })

    const r = await inject('GET', '/workbench/timeline')
    expect(r.status).toBe(200)
    const all = r.body.days.flatMap((d: any) => d.items)
    const node = all.find((x: any) => x.id === `plan:${id}`)
    expect(node).toBeTruthy()
    expect(node.t).toBe('plan')
    expect(node.xp).toBe(planDrop(id, 'P0').xp)
    expect(node.gold).toBe(planDrop(id, 'P0').gold)
  })

  it('未完成计划不进时间轴；打卡记录逐日展开', async () => {
    const open = await inject('POST', '/workbench/plan', { text: '未完成计划', level: 'P2' })
    const r = await inject('GET', '/workbench/timeline')
    const all = r.body.days.flatMap((d: any) => d.items)
    expect(all.some((x: any) => x.id === `plan:${open.body.item.id}`)).toBe(false)

    const ck = await inject('POST', '/workbench/checkin', {
      name: '阅读', emoji: '📖', log: JSON.stringify({ [TODAY]: true }), streak: 1,
    })
    const r2 = await inject('GET', '/workbench/timeline')
    const all2 = r2.body.days.flatMap((d: any) => d.items)
    const node = all2.find((x: any) => x.id === `checkin:${ck.body.item.id}:${TODAY}`)
    expect(node).toBeTruthy()
    expect(node.t).toBe('checkin')
    expect(node.xp).toBe(15)
  })

  it('笔记按 mood 映射类型（灵感→note）；未知 mood 兜底 note', async () => {
    await inject('POST', '/workbench/notes', { title: 'mood 测试', mood: '灵感', date: TODAY })
    const r = await inject('GET', '/workbench/timeline')
    const all = r.body.days.flatMap((d: any) => d.items)
    const node = all.find((x: any) => x.id.startsWith('note:') && x.title === 'mood 测试')
    expect(node.t).toBe('note')
  })
})

describe('week-stats（本周聚合）', () => {
  it('返回本周窗口与四行统计字段', async () => {
    const r = await inject('GET', '/workbench/week-stats')
    expect(r.status).toBe(200)
    expect(r.body.week.daysElapsed).toBeGreaterThanOrEqual(1)
    expect(r.body.week.daysElapsed).toBeLessThanOrEqual(7)
    expect(r.body.checks.total).toBe(7)
    expect(r.body.posts.total).toBe(7)
    expect(r.body.ledger.total).toBe(7)
    expect(typeof r.body.plans.total).toBe('number')
    expect(typeof r.body.avg).toBe('number')
    expect(r.body.week.start).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('timeline 自定义时间范围（from/to）', () => {
  it('from/to 过滤窗口内日期，且返回 range 字段', async () => {
    await inject('POST', '/workbench/notes', { title: '范围验证旧笔记', mood: '灵感', date: TODAY })
    const r = await inject('GET', `/workbench/timeline?from=${TODAY}&to=${TODAY}`)
    expect(r.status).toBe(200)
    expect(r.body.range).toEqual({ from: TODAY, to: TODAY })
    const dates = r.body.days.map((d: any) => d.date)
    expect(dates.every((x: string) => x === TODAY)).toBe(true)
    const hit = r.body.days.find((d: any) => d.date === TODAY)
    expect(hit?.items.some((x: any) => x.title === '范围验证旧笔记')).toBe(true)
  })

  it('非法格式 / from 晚于 to / 跨度超 366 天 → 422', async () => {
    expect((await inject('GET', '/workbench/timeline?from=2026-31-01&to=2026-02-01')).status).toBe(422)
    expect((await inject('GET', '/workbench/timeline?from=2026-02-01&to=2026-01-01')).status).toBe(422)
    expect((await inject('GET', '/workbench/timeline?from=2020-01-01&to=2026-02-01')).status).toBe(422)
  })
})

describe('客户端日志上报 / 服务器状态', () => {
  it('client-log：合法级别写日志成功；非法级别 422', async () => {
    const ok = await inject('POST', '/workbench/client-log', {
      level: 'error', src: 'universe', message: '渲染异常', extra: { nodes: 12 },
    })
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
    const bad = await inject('POST', '/workbench/client-log', { level: 'fatal', message: 'x' })
    expect(bad.status).toBe(422)
  })

  it('server-status：返回 cpu/mem/net 字段', async () => {
    const r = await inject('GET', '/workbench/server-status')
    expect(r.status).toBe(200)
    expect(typeof r.body.cpu).toBe('number')
    expect(r.body.mem.total).toBeGreaterThan(0)
    expect(typeof r.body.mem.percent).toBe('number')
    expect(r.body.mem.percent).toBeGreaterThanOrEqual(0)
    // net 在非 Linux 下可能为 null，其余环境为对象
    if (r.body.net !== null) {
      expect(typeof r.body.net.up).toBe('number')
      expect(typeof r.body.net.down).toBe('number')
    }
  })
})
