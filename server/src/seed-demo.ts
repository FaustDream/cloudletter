/**
 * 演示种子数据（仅开发/测试环境）：为工作台各模块注入多状态、多月份、
 * 多数据量的测试实例，用于验证列表滚动、筛选、时间状态、热图与图表。
 * 幂等：重复执行会追加（不覆盖既有数据）；正式/生产环境请勿执行。
 * 用法：corepack pnpm exec tsx src/seed-demo.ts
 */
import { prisma } from './prisma'
import { slugify } from './content'

const iso = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() - n); return iso(d)
}
const daysAhead = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n); return iso(d)
}

async function main() {
  const user = await prisma.user.findFirst()
  if (!user) throw new Error('未找到用户，请先 pnpm seed')

  /* ===== 今日计划（5+ 条：未开始/今天到期/逾期/已完成/延期） ===== */
  const plans = [
    { text: '✅ 已完成：备份全部数据', level: 'P0', note: '本轮收尾', done: true, doneAt: daysAgo(0), dueDate: daysAgo(0) },
    { text: '完成《通用 UI 设计规范》阅读笔记', level: 'P1', note: '整理到灵感', done: false, doneAt: '', dueDate: daysAhead(0) },
    { text: '安排下周文章选题', level: 'P2', note: '', done: false, doneAt: '', dueDate: daysAhead(0) },
    { text: '逾期示例：联系设计师确认封面', level: 'P1', note: '已延迟 2 天', done: false, doneAt: '', dueDate: daysAgo(2) },
    { text: '采购素材库月卡', level: 'P2', note: '预算 49 元', done: false, doneAt: '', dueDate: daysAhead(1) },
    { text: '逾期示例：整理上季度账目', level: 'P0', note: '拖了 3 天', done: false, doneAt: '', dueDate: daysAgo(3) },
  ]
  for (const p of plans) {
    await prisma.planItem.create({ data: { ...p, doneAt: '', order: 0 } })
  }
  // 补正确 doneAt
  await prisma.planItem.updateMany({ where: { text: { startsWith: '✅ 已完成' } }, data: { doneAt: new Date().toISOString() } })

  /* ===== 习惯（3+ 个：连续/中断/不同 emoji，填充近 35 天 log） ===== */
  const habits = [
    { name: '晨间阅读', emoji: '📖', days: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 28, 29, 30, 31, 33] },
    { name: '运动 30 分钟', emoji: '🏃', days: [0, 1, 2, 3, 6, 7, 8, 9, 12, 13, 14, 15, 18, 19, 20, 25, 26, 27, 28, 32, 33, 34] },
    { name: '喝水 8 杯', emoji: '💧', days: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34] },
    { name: '早睡打卡', emoji: '🌙', days: [0, 1, 4, 5, 8, 9, 22, 30] },
  ]
  for (const h of habits) {
    const log: Record<string, boolean> = {}
    for (const n of h.days) log[daysAgo(n)] = true
    let streak = 0
    const d = new Date()
    while (log[iso(d)]) { streak++; d.setDate(d.getDate() - 1) }
    await prisma.checkinItem.create({ data: { name: h.name, emoji: h.emoji, log: JSON.stringify(log), streak } })
  }

  /* ===== 记账（10+ 条：本月/上个月/不同分类/收入与支出） ===== */
  const ledger = [
    { kind: 'expense', cat: '餐饮', amount: 32.5, note: '午餐', date: daysAgo(1) },
    { kind: 'expense', cat: '交通', amount: 12, note: '地铁', date: daysAgo(1) },
    { kind: 'expense', cat: '购物', amount: 199, note: '键盘键帽', date: daysAgo(2) },
    { kind: 'expense', cat: '学习', amount: 88.8, note: '在线课程', date: daysAgo(3) },
    { kind: 'income', cat: '工作', amount: 8000, note: '月度稿酬', date: daysAgo(5) },
    { kind: 'expense', cat: '居住', amount: 2600, note: '房租', date: daysAgo(6) },
    { kind: 'expense', cat: '娱乐', amount: 45, note: '影院', date: daysAgo(8) },
    { kind: 'expense', cat: '健康', amount: 150, note: '体检', date: daysAgo(12) },
    { kind: 'expense', cat: '餐饮', amount: 56, note: '周五聚餐', date: daysAgo(15) },
    { kind: 'income', cat: '理财', amount: 320, note: '基金收益', date: daysAgo(18) },
    { kind: 'expense', cat: '其他', amount: 66, note: '上月杂项', date: daysAgo(40) },
    { kind: 'expense', cat: '购物', amount: 420, note: '上月数码', date: daysAgo(55) },
    { kind: 'income', cat: '工作', amount: 6000, note: '上月稿酬', date: daysAgo(62) },
  ]
  for (const l of ledger) await prisma.ledgerEntry.create({ data: l })

  /* ===== 长期目标（3+ 个：低/高进度/完成） ===== */
  const goals = [
    { name: '一年读完 50 本书', emoji: '📚', current: 21, target: 50, unit: '本' },
    { name: '坚持跑步 1000 公里', emoji: '🏃', current: 642, target: 1000, unit: '公里' },
    { name: '完成个人网站重构', emoji: '🚀', current: 100, target: 100, unit: '%' },
    { name: '攒下第一笔 10 万', emoji: '💰', current: 2.4, target: 10, unit: '万' },
  ]
  for (const g of goals) await prisma.goalItem.create({ data: g })

  /* ===== 灵感（8+ 条：与文章共用分类/标签体系） ===== */
  const catInspiration = await prisma.category.upsert({
    where: { slug: slugify('灵感') },
    update: {},
    create: { name: '灵感', slug: slugify('灵感') },
  })
  const tagIds: Record<string, string> = {}
  for (const name of ['灵感', '想法', '学习', '备忘', '摘录']) {
    const t = await prisma.tag.upsert({ where: { name }, update: {}, create: { name, slug: slugify(name) } })
    tagIds[name] = t.id
  }
  const notes = [
    { title: '博客三周年复盘提纲', body: '回顾 3 年写作：选题演变、阅读量变化、写作习惯养成。想拆成一篇文章 + 一个视频脚本。', tag: '灵感', date: daysAgo(0) },
    { title: 'AI 写作工具的边界', body: '生成是开始，编辑才是主体。思考人类判断力在内容生产中的不可替代性。', tag: '想法', date: daysAgo(1) },
    { title: '好标题的公式', body: '具体数字 + 冲突 + 承诺价值。例：为什么我删掉了 600 篇草稿。', tag: '学习', date: daysAgo(3) },
    { title: '本周待读文章', body: '1) 设计系统的权衡 2) 异步协作实践 3) SQLite 性能优化实录', tag: '备忘', date: daysAgo(4) },
    { title: '', body: '深色模式下的对比度：注意背景层次，不要纯黑纯白。', tag: '灵感', date: daysAgo(6) },
    { title: '网站改版灵感', body: '把侧栏换成抽屉，文章列表用表格密度。更大的预览图，更少装饰。', tag: '想法', date: daysAgo(9) },
    { title: '一句备忘', body: 'Record 比记忆可靠 —— 这是博客存在的意义。', tag: '摘录', date: daysAgo(14) },
    { title: '长文素材：工作流自动化', body: '从草稿到发布的完整链路：脚本、模板、标签规则、发布检查清单。收集截图与报错案例。这是一段较长文本用于验证灵感卡片的高度变化与摘要截断，让列表呈现出长短内容差异。', tag: '灵感', date: daysAgo(20) },
  ]
  for (const n of notes) {
    await prisma.noteItem.create({
      data: {
        title: n.title, body: n.body, date: n.date, categoryId: catInspiration.id,
        tags: { create: [{ tagId: tagIds[n.tag] }] },
      },
    })
  }

  const summary = {
    plan: await prisma.planItem.count(),
    checkin: await prisma.checkinItem.count(),
    ledger: await prisma.ledgerEntry.count(),
    goals: await prisma.goalItem.count(),
    notes: await prisma.noteItem.count(),
  }
  console.log('演示数据注入完成:', JSON.stringify(summary))
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})