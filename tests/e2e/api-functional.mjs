/**
 * API 功能测试（真实进程级验证，与单元测试互补）：
 * 启动真实 server 进程（独立端口 + 临时数据目录，与开发库完全隔离），
 * 用 fetch 走 HTTP 全链路，覆盖「云笺集」最小功能面：
 *   探活/404 包络/CORS → 登录/会话 → 文章全生命周期（乐观锁/版本/恢复/slug 改名）
 *   → 分类/标签 → 站点设置 → 全文检索 → 工作台五模块/统计/时间轴 → 讨伐 → 图片上传 → 登出
 * 用法：node api-functional.mjs （退出码 0 = 全部通过）
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SERVER_DIR = path.resolve(__dirname, '../server')
const PORT = 4021
const BASE = `http://127.0.0.1:${PORT}`
const API = `${BASE}/api/v2`
const ADMIN = { email: 'func-admin@cloudletter.local', password: 'func-admin-2026' }

const dataRoot = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'cl-func-data-'))
const postsRoot = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'cl-func-posts-'))
const env = {
  ...process.env,
  PORT: String(PORT),
  DATABASE_URL: `file:${path.join(dataRoot, 'func.db')}`,
  DATA_ROOT: dataRoot,
  POSTS_ROOT: path.join(postsRoot, 'posts'),
  SETTINGS_ROOT: path.join(postsRoot, '_settings'),
  ADMIN_EMAIL: ADMIN.email,
  ADMIN_PASSWORD: ADMIN.password,
  NODE_ENV: 'development',
}

let passed = 0
let failed = 0
const failures = []
let serverProc = null
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; failures.push(name); console.log(`  ✗ ${name} ${extra}`) }
}

let token = ''
async function req(method, p, body, opts = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token && !opts.noAuth ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.origin ? { Origin: opts.origin } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, headers: res.headers, body: data }
}

async function main() {
  /* ===== 启动隔离环境 ===== */
  console.log('▶ 准备临时数据库与种子管理员…')
  const prismaCli = path.join(SERVER_DIR, 'node_modules', 'prisma', 'build', 'index.js')
  const r1 = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], { cwd: SERVER_DIR, env, stdio: 'pipe' })
  if (r1.status !== 0) throw new Error(`prisma db push 失败: ${r1.stderr}`)

  const tsxCli = path.join(SERVER_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const r2 = spawnSync(process.execPath, [tsxCli, 'src/seed.ts'], { cwd: SERVER_DIR, env, stdio: 'pipe' })
  if (r2.status !== 0) throw new Error(`seed 失败: ${r2.stderr}`)

  console.log(`▶ 启动 server（:${PORT}，数据目录 ${dataRoot}）…`)
  serverProc = spawn(process.execPath, [tsxCli, 'src/index.ts'], { cwd: SERVER_DIR, env, stdio: 'ignore', detached: false })
  const ready = await (async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${BASE}/healthz`)
        if (r.ok) return true
      } catch { /* 未就绪 */ }
      await new Promise((s) => setTimeout(s, 500))
    }
    return false
  })()
  if (!ready) throw new Error('server 60s 内未就绪')
  console.log('▶ 服务已就绪，开始功能用例\n')

  /* ===== 1. 基础设施 ===== */
  console.log('■ 基础设施')
  const hz = await (await fetch(`${BASE}/healthz`)).json()
  check('healthz 探活返回 ok/uptime', hz.ok === true && typeof hz.uptime === 'number')
  const nf = await req('GET', '/definitely-not-exist', undefined, { noAuth: true })
  check('未知接口统一 404 错误包络', nf.status === 404 && nf.body.error?.code === 'NOT_FOUND')

  /* ===== 2. 登录与会话 ===== */
  console.log('■ 登录与会话')
  const noAuth = await req('GET', '/posts', undefined, { noAuth: true })
  check('未登录访问受保护接口 401', noAuth.status === 401 && noAuth.body.error?.code === 'AUTH_REQUIRED')
  const badLogin = await req('POST', '/auth/login', { email: ADMIN.email, password: 'wrong-password' }, { noAuth: true })
  check('错误密码 401', badLogin.status === 401)
  const login = await req('POST', '/auth/login', { email: ADMIN.email, password: ADMIN.password }, { noAuth: true })
  check('正确密码登录返回 token', login.status === 200 && /^[0-9a-f]{64}$/.test(login.body.token || ''))
  token = login.body.token
  const me = await req('GET', '/auth/me')
  check('GET /auth/me 返回当前用户', me.status === 200 && me.body.user?.email === ADMIN.email)

  /* ===== 3. 分类与标签 ===== */
  console.log('■ 分类与标签')
  const cat = await req('POST', '/categories', { name: '功能测试分类' })
  check('创建分类', cat.status === 200 && cat.body.id)
  check('重复分类名 409', (await req('POST', '/categories', { name: '功能测试分类' })).status === 409)
  const tag = await req('POST', '/tags', { name: '功能标签' })
  check('创建标签', tag.status === 200 && tag.body.id)

  /* ===== 4. 文章全生命周期 ===== */
  console.log('■ 文章全生命周期')
  const c1 = await req('POST', '/posts', {
    title: '功能测试文章', rawMarkdown: '# 标题\n第一版正文。', categoryId: cat.body.id, tags: ['功能标签'],
  })
  check('创建草稿（中文标题 → 时间戳 slug 兜底）', c1.status === 200 && /^post-[0-9a-z]+$/.test(c1.body.slug || '') && c1.body.status === 'draft')
  const postId = c1.body.id
  const slug1 = c1.body.slug

  const mdFile = path.join(postsRoot, 'posts', `${slug1}.md`)
  check('真相源 Markdown 文件已落盘', fs.existsSync(mdFile))

  const detail1 = await req('GET', `/posts/${postId}`)
  check('详情包含分类与标签', detail1.body.category?.name === '功能测试分类' && detail1.body.tags?.includes('功能标签'))

  // 乐观锁
  const stale = new Date(detail1.body.updatedAt).getTime()
  await req('PUT', `/posts/${postId}`, { rawMarkdown: '第二版正文。' })
  const conflict = await req('PUT', `/posts/${postId}`, { rawMarkdown: '第三版。', baseVersion: stale })
  check('过期 baseVersion → 409 CONFLICT', conflict.status === 409 && conflict.body.error?.code === 'CONFLICT')

  // 版本
  const revs = await req('GET', `/posts/${postId}/revisions`)
  check('正文变更产生 v2 版本', revs.body.items?.length === 2 && revs.body.items[0].version === 2)
  const rev1 = await req('GET', `/posts/${postId}/revisions/1`)
  check('v1 快照正文可读', rev1.body.content?.includes('第一版正文'))
  const restore = await req('POST', `/posts/${postId}/revisions/1/restore`)
  const afterRestore = await req('GET', `/posts/${postId}`)
  check('恢复 v1 → 正文回滚且生成 v3', restore.status === 200 && afterRestore.body.rawMarkdown?.includes('第一版正文'))

  // slug 改名
  const rename = await req('PUT', `/posts/${postId}`, { slug: 'renamed-post' })
  check('slug 改名后文件同步改名', rename.status === 200 && fs.existsSync(path.join(postsRoot, 'posts', 'renamed-post.md')) && !fs.existsSync(mdFile))

  // 清空语义（keepEmpty）
  await req('PUT', `/posts/${postId}`, { summary: '有摘要' })
  const clear = await req('PUT', `/posts/${postId}`, { summary: '' })
  const afterClear = await req('GET', `/posts/${postId}`)
  check("summary:'' 清空摘要", clear.status === 200 && afterClear.body.summary === '')

  // 发布
  const publish = await req('PUT', `/posts/${postId}`, { status: 'published' })
  const afterPub = await req('GET', `/posts/${postId}`)
  check('发布置 publishedAt', publish.status === 200 && afterPub.body.publishedAt && afterPub.body.status === 'published')

  /* ===== 5. 批量操作 ===== */
  console.log('■ 批量操作')
  const c2 = await req('POST', '/posts', { title: '批量文章B' })
  const batch = await req('POST', '/posts/batch', { action: 'publish', ids: [postId, c2.body.id] })
  check('批量发布 affected=2', batch.status === 200 && batch.body.affected === 2)
  const batchTag = await req('POST', '/posts/batch', { action: 'tag', ids: [c2.body.id], payload: { tags: ['批量标签'] } })
  const c2Detail = await req('GET', `/posts/${c2.body.id}`)
  check('批量打标签同步 DB 与文件', batchTag.status === 200 && c2Detail.body.tags?.includes('批量标签') && fs.readFileSync(path.join(postsRoot, 'posts', `${c2.body.slug}.md`), 'utf-8').includes('批量标签'))

  /* ===== 6. 全文检索 ===== */
  console.log('■ 全文检索')
  // 注意：renamed-post 当前正文 = 恢复后的「第一版正文」（v1 restore）
  const search = await req('GET', '/search?q=第一版正文')
  check('正文关键词命中', search.status === 200 && search.body.items?.some((x) => x.slug === 'renamed-post'))
  // 新建一篇独立草稿验证草稿检索语义
  const draftPost = await req('POST', '/posts', { title: '草稿检索专用文' })
  const draftHit = await req('GET', '/search?q=草稿检索专用文')
  check('草稿默认不进检索', draftHit.body.total === 0)
  const draftHit2 = await req('GET', '/search?q=草稿检索专用文&includeDraft=1')
  check('includeDraft=1 纳入草稿', draftHit2.body.items?.some((x) => x.draft === true && x.slug === draftPost.body.slug))
  await req('DELETE', `/posts/${draftPost.body.id}`)

  /* ===== 7. 站点设置 ===== */
  console.log('■ 站点设置')
  const put1 = await req('PUT', '/settings', { appearance: { theme: 'dark' } })
  const put2 = await req('PUT', '/settings', { layout: { sidebar: 'left' } })
  const settings = await req('GET', '/settings')
  check('设置分组增量合并并落盘', put1.status === 200 && put2.status === 200
    && settings.body.appearance?.theme === 'dark' && settings.body.layout?.sidebar === 'left'
    && fs.existsSync(path.join(postsRoot, '_settings', 'site.json')))
  check('非法分组 422', (await req('PUT', '/settings', { hack: {} })).status === 422)

  /* ===== 8. 工作台五模块 + 统计 + 时间轴 ===== */
  console.log('■ 工作台')
  const plan = await req('POST', '/workbench/plan', { text: '功能测试计划', level: 'P0', dueDate: new Date().toISOString().slice(0, 10) })
  check('新建计划', plan.status === 200 && plan.body.item?.id)
  await req('PUT', `/workbench/plan/${plan.body.item.id}`, { done: true })
  const checkin = await req('POST', '/workbench/checkin', { name: '早起', log: JSON.stringify({ [new Date().toISOString().slice(0, 10)]: true }), streak: 2 })
  check('新建习惯打卡', checkin.status === 200)
  const ledger = await req('POST', '/workbench/ledger', { kind: 'expense', cat: '餐饮', amount: 42.5, note: '晚饭' })
  check('新建记账（缺省日期兜底今天）', ledger.status === 200 && /^\d{4}-\d{2}-\d{2}$/.test(ledger.body.item?.date || ''))
  const note = await req('POST', '/workbench/notes', { title: '功能测试灵感', mood: '灵感' })
  check('新建灵感笔记', note.status === 200)

  const sum = await req('GET', '/workbench/plan/summary')
  check('计划 summary 统计', sum.body.total >= 1 && sum.body.done >= 1)
  const lsum = await req('GET', '/workbench/ledger/summary')
  check('记账 summary 本月支出', lsum.body.expense >= 42.5)

  const week = await req('GET', '/workbench/week-stats')
  check('week-stats 周窗口与四行统计', week.status === 200 && week.body.week?.daysElapsed >= 1 && week.body.checks?.total === 7)

  const timeline = await req('GET', '/workbench/timeline')
  const tNodes = timeline.body.days?.flatMap((d) => d.items) || []
  check('时间轴聚合：完成计划/打卡/记账/笔记/文章五类节点', ['plan', 'checkin', 'ledger', 'note', 'journal']
    .every((t) => tNodes.some((n) => n.t === t)))

  /* ===== 9. 讨伐系统 ===== */
  console.log('■ 讨伐系统')
  const p2 = await req('POST', '/workbench/plan', { text: '讨伐功能怪', level: 'P1' })
  const today = await req('GET', '/battle/today')
  check('today 列出未完成任务为怪物', today.status === 200 && today.body.monsters?.some((m) => m.id === p2.body.item.id))
  const atk = await req('POST', '/battle/attack', { planId: p2.body.item.id })
  check('攻击完成计划并掉落 XP/金币', atk.status === 200 && atk.body.drop?.xp >= 25 && atk.body.drop?.gold >= 4)
  check('重复攻击 409', (await req('POST', '/battle/attack', { planId: p2.body.item.id })).status === 409)

  /* ===== 10. 图片上传 ===== */
  console.log('■ 图片上传')
  const png = Buffer.from('89504e470d0a1a0a', 'hex')
  const up = await fetch(`${API}/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${token}` },
    body: new Uint8Array(png),
  })
  const upBody = await up.json()
  check('png 直传返回 url', up.status === 200 && /^\/api\/v2\/uploads\/.+\.png$/.test(upBody.url || ''))
  const served = await fetch(`${BASE}${upBody.url}`)
  check('上传文件静态可读（免登录）', served.status === 200 && Buffer.from(await served.arrayBuffer()).equals(png))
  check('非图片类型 415', (await fetch(`${API}/uploads`, {
    method: 'POST', headers: { 'Content-Type': 'application/zip', Authorization: `Bearer ${token}` }, body: 'PK',
  })).status === 415)

  /* ===== 11. CORS 与登出 ===== */
  console.log('■ CORS 与登出')
  const cors = await fetch(`${API}/posts`, { headers: { Origin: 'http://localhost:3015', Authorization: `Bearer ${token}` } })
  check('CORS 反射 Origin（开发期约定）', cors.headers.get('access-control-allow-origin') === 'http://localhost:3015')

  const del = await req('DELETE', `/posts/${postId}`)
  check('删除文章（DB+文件）', del.status === 200 && !fs.existsSync(path.join(postsRoot, 'posts', 'renamed-post.md')))
  const out = await req('POST', '/auth/logout')
  check('登出后会话失效', out.status === 200 && (await req('GET', '/auth/me')).status === 401)

  /* ===== 汇总 ===== */
  console.log(`\n■ 结果：${passed} 通过 / ${failed} 失败`)
  if (failed) {
    console.log('失败用例：')
    for (const f of failures) console.log(`  - ${f}`)
  }
  return failed === 0
}

main()
  .then((ok) => {
    console.log(ok ? '\n✅ API 功能测试全部通过' : '\n❌ API 功能测试存在失败')
    process.exitCode = ok ? 0 : 1
  })
  .catch((e) => {
    console.error('功能测试异常终止:', e)
    process.exitCode = 2
  })
  .finally(() => {
    try { serverProc?.kill() } catch {}
    // 略等子进程退出、SQLite 句柄释放后清理临时目录
    setTimeout(() => {
      try { fs.rmSync(dataRoot, { recursive: true, force: true }) } catch {}
      try { fs.rmSync(postsRoot, { recursive: true, force: true }) } catch {}
      process.exit(process.exitCode ?? 0)
    }, 800)
  })
