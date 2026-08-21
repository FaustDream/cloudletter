# 云笺集 · 代码审查结果报告

> 审查对象：云笺集（Cloudletter）全仓库（截至 2026-08-21 代码快照）
> 审查依据：`docs/CODE_REVIEW.md`（审查标准与流程，含严重级别定义、合并门槛、分模块清单、基线审计）
> 审查方式：逐文件走查（后端 API / 前端 write+console / 序列化器 / 磁盘同步·构建·备份 / E2E / 通用），并与 `CODE_REVIEW.md` 第四节清单、第六节基线逐项对照。
> 适用边界：`fuwari-blog/` 为第三方 Astro 模板，按"依赖"处理，本次不纳入门禁与逐文件审查。

---

## ✅ 修复状态（2026-08-21 修复轮）

| 编号 | 严重级别 | 状态 |
|------|----------|------|
| B1 异步错误统一捕获 | 🔴 | ✅ 已修（`wrapAsyncRouter` 遍历 router.stack 统一 catch → next；index.ts 错误中间件加 `headersSent` 守卫） |
| B2 认证限流/锁定 | 🔴 | ✅ 已修（新增 `middleware/rate-limit.ts`：IP+账户双维度、5min×5 次失败锁 15min，login/verify-2fa/password 均接入；实测第 6 次返回 429） |
| K2 seed 默认口令 | 🔴(部署即) | ✅ 已修（seed 必须从 `ADMIN_PASSWORD` 提供≥8位且非弱口令；E2E 密码同步为 `e2e-admin-2026`） |
| S1 入参校验 + settings 白名单 | 🟡 | ✅ 已修（`PUT /settings` 仅允许五个已知分组，未知分组 422） |
| S2 构建 Map 上限 | 🟡 | ✅ 已修（`MAX_JOBS=100`，插入前 LRU 淘汰最旧 job） |
| S3 乐观锁原子化 | 🟡 | ✅ 已修（`updatedAt` 放进 Prisma `updateMany.where`，命中 0 行返回 409，消除 TOCTOU） |
| S4 安全头 | 🟡 | ✅ 已修（index.ts 手写 nosniff/DENY/no-referrer/X-XSS-Protection） |
| W1 双链补全陈旧闭包 | 🟡(功能) | ✅ 已修（`getLinkTargetsRef` 替代 useMemo 冻结回调） |
| W2 可视化 html:false | 🟡 | ✅ 已修 |
| W3 closeTab 副作用移出 updater | 🟡 | ✅ 已修 |
| W4 写操作失败无反馈 | 🟡 | ✅ 已修（`ws-toast` toast，接入 create/move/publish/trash/createFolder 的 catch） |
| N1 2FA setup 先落库 | 💭 | ✅ 已修（setup 存内存 Map，enable 验证通过后才落库） |
| N3 魔法数字 | 💭 | ✅ 已修（`WINDOWS_TRANSIENT_EXIT_CODES` 常量） |
| N4 serializer 显式映射 | 💭 | ✅ 已修 |
| R1 YAML 标量引号 | 💭 | ✅ 已修（`yq()` 统一引号 + `unquote()` 配套反转义 + list item 去引号；往返测试 13/13 通过） |
| G2 richBlocks import 移顶 | 💭 | ✅ 已修 |
| W5 auth 统一错误包络 | 💭 | ✅ 已修（login/verify2fa 抛 `ApiError`） |
| W6 useAuth 兜底 | 💭 | ✅ 已修（Provider 外抛明确错误） |
| E2 事件监听泄漏 | 💭 | ✅ 已修（移到 `test.beforeEach`） |
| E1 playwright webServer | 💭 | ✅ 已存在，无需修 |
| C1 抽公共 auth 包 | 💭 | ⏳ 待后续（重构 write/console 共享认证模块） |
| G1 richBlocks 消除 any | 💭 | ⏳ 待后续 |
| S5 CORS 白名单 | 🟡 | ⏳ 待部署域名明确后接入 |

验证：server `tsc --noEmit` 通过；write `tsc --noEmit` 通过；单元测试 **13/13 通过**；E2E **9/9 通过**（含登录、错误密码拒绝、六组导航、强调色保存触发构建、监控审计、源码/可视化切换、斜杠菜单）。

---

## 一、总体结论（TL;DR）

| 维度 | 评价 |
|------|------|
| 整体质量 | **中等偏上**。架构清晰（绞杀者模式、统一错误包络、RBAC、审计容错、序列化契约），好模式较多；但**质量门禁此前完全缺失**，且存在 2 个必须在合并前修复的 Blocker。 |
| 🔴 Blocker | **2 个**：Express 4 异步错误不进中间件；认证端点无限流/锁定。 |
| 🟡 Suggestion | **9 个**（含基线 4 + 本轮新增 5）。 |
| 💭 Nit | **约 10 个**（含基线 4 + 本轮新增约 6）。 |
| 合并建议 | 本轮发现的 🔴 必须修复；🟡 要么本轮修、要么建 issue 跟踪；📌 **新增的 `seed.ts` 默认口令 `change-me` 一旦部署到生产即升级为 Blocker**，须强制首登改密或下线种子默认口令。 |

> 说明：后端 API 的 🔴/🟡/💭 已记录于 `CODE_REVIEW.md` 第六节"基线审计"，本轮对其中最关键的三处（`index.ts`、`routes/v2.ts`、`services/build.ts`）做了**重新走查核实**，行号一致；前端与 E2E 为**本轮首次逐文件审查**的新发现。

---

## 二、后端 API（`server/src`，Express 4 + Prisma）

### 🔴 B1 异步路由错误不会进入错误中间件
- **位置**：`routes/v2.ts` 全部路由均为 `async (req, res) => {...}`，无一 `try/catch`，也无 `catchAsync` 包裹（典型：`v2.ts:40` login、`v2.ts:57` verify-2fa、`v2.ts:170` PUT /posts、`:429` PUT /settings、`v2.ts:503` /auth/password 等 30+ 处）。
- **原因**：`express@4.21.2` 不会把 rejected promise 转发给 `index.ts:29` 的错误处理中间件。一旦路由内 `await prisma...` 抛错 → 请求挂起直至客户端超时，并可能触发 `unhandledRejection`。
- **后果**：生产可表现为"保存一直转圈/偶发 500 无响应"，且未捕获异常可能拖垮进程。
- **建议**：
  - 引入 `catchAsync` 高阶函数包裹所有异步路由；或
  - 升级 Express 5（自动转发 rejected promise）；或
  - 在 `v2` Router 外层挂一个 `router.use((err,req,res,next)=>...)`，但 Express 4 仍需 `next(err)` 才能触发，故最稳妥是 `catchAsync` 或 Express 5。

### 🔴 B2 认证端点无速率限制 / 失败锁定
- **位置**：`v2.ts:40`（login）、`v2.ts:57`（verify-2fa）、`v2.ts:503`（/auth/password）均无限流、无失败计数锁定。
- **原因**：口令虽用 `timingSafeEqual` 防时序，但无失败锁定，攻击者可在线爆破。
- **后果**：在线口令爆破成本低；TOTP 仅 6 位，verify-2fa 也无尝试上限，理论上可被穷举。
- **建议**：接入 `express-rate-limit`（按 IP + 按账户维度），例如 5 分钟内失败 5 次锁定 15 分钟；verify-2fa 同样需限流。`crypto.ts` 的 scrypt 计算成本可保留作为第二道防线。

### 🟡 S1 缺统一入参校验层 + `/settings` 对象注入
- **位置**：`v2.ts:429` `const merged = { ...(current ? JSON.parse(current.value) : {}), ...req.body }`。
- **原因**：任意顶层键都会浅合并进 `SiteSetting.value`；其余路由也多直接 `req.body ?? {}` 信任字段。
- **后果**：理论上可写入未知设置键（虽前端只发已知分组，但 API 契约未强制）。
- **建议**：引入 **zod**，每个接口定义 schema；`PUT /settings` 仅允许 `appearance/layout/content/reading/interaction` 五个已知分组，且各组用对应 schema 校验。

### 🟡 S2 构建任务 Map 无上限 + 重启丢失状态
- **位置**：`services/build.ts:20`（`const jobs = new Map(...)`）、`:42` `getBuild`。
- **原因**：`jobs` Map 永不淘汰（内存泄漏隐患）；进程重启后 `getBuild` 返回 null，前端 `watchBuild`（`SettingsConsole.tsx:104`）的轮询拿到 404 被静默吞掉。
- **建议**：设定最大保留条数（如 100）做 LRU/过期淘汰；或持久化构建状态到表，重启可恢复。前端对 404 至少给出"构建状态丢失，请刷新"的提示。

### 🟡 S3 `PUT /posts/:id` 冲突检测为 TOCTOU
- **位置**：`v2.ts:174-183`，仅 JS 比较 `updatedAt` ±1000ms，未把 `updatedAt` 放进 Prisma `where`。
- **原因**：比较窗口与"把 `updatedAt` 写入 `where`"之间，另一请求可能已完成写入，两次保存都会通过校验。
- **后果**：多标签页/多人同时编辑时，后写覆盖先写且无 409。
- **建议**：`prisma.post.update({ where: { id: post.id, updatedAt: baseVersion }, data })`；命中 0 行即返回 409。前端已携带 `baseVersion`（epoch ms），后端只需把字符串化的 `updatedAt` 还原为 `Date` 比对。

### 🟡 S4 无显式安全头 / CORS
- **位置**：`index.ts:13` 仅 `app.disable('x-powered-by')`。
- **原因**：未配 `helmet`，无 `Content-Security-Policy` / `X-Frame-Options` 等；生产若直连（不经 nginx 反代）则缺少纵深防御。
- **建议**：加 `helmet()`；若前端与 API 跨域，显式配置 CORS 白名单（当前同源 `/dev/*` 反向代理下可暂缓，但应预留）。

### 💭 N1 `setup-2fa` 先写 `totpSecret` 再校验
- **位置**：`v2.ts:81-85`：`generateTOTPSecret()` 后立即 `prisma.user.update({ data: { totpSecret: hex } })`，但 `enable-2fa` 才真正置 `totpEnabled`。
- **影响**：用户放弃启用会留下游离密钥（不泄漏，但属冗余状态）。
- **建议**：改为"验证通过后再落库"，或在 `disable-2fa` 时一并清空（已清空，`v2.ts:102` 好）。

### 💭 N2 `req.user!` 非 null 断言遍布
- **位置**：`v2.ts:83,89,99,154,157,...`（多处）。
- **说明**：逻辑上安全（`requireAuth` 先于业务），但属 smell。升级 Express 5 + 收窄 `Request` 类型后可消除。

### 💭 N3 魔法数字
- **位置**：`v2.ts:178` 冲突容差 `1000`；`build.ts:76` Windows 退出码 `3221225794/3221225786`。
- **建议**：提取为命名常量（如 `CONFLICT_TOLERANCE_MS`、`WINDOWS_TRANSIENT_EXIT_CODES`）。

### 💭 N4 序列化器 `(api as any)[key]`
- **位置**：`apps/write/src/lib/serializer.ts:114`（前端序列化器）。
- **说明**：仅对已知的 `method/path/summary` 赋值，风险有限；但破坏类型安全。
- **建议**：用显式字段映射对象替代 `(api as any)[key]`。

---

## 三、前端 · 写作空间（`apps/write`）

### 🟡 W1 双链 `[[` 补全永远使用空/陈旧标题列表 ⚠️本轮新发现（功能 Bug）
- **位置**：`components/Editor.tsx:128-136`
  ```ts
  const extensions = useMemo<Extension[]>(() => [
    markdown({ base: markdownLanguage }),
    completions(getLinkTargets),   // ← getLinkTargets 在此被"冻结"
    pasteDetection(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])
  ```
- **原因**：`useMemo(..., [])` 捕获了**首次渲染**时的 `getLinkTargets`，而该闭包引用的是首次渲染时的 `linkTargets` 状态（此时为 `[]`，`loadLinkTargets` 在 effect 之后才填充）。此后新增/改名的文章标题**永远不会**出现在 `[[` 补全里。
- **后果**：双链补全功能实际失效，与"类 IDE 体验"目标相悖；且 `eslint-disable` 注释把这条真实 bug 藏了起来。
- **建议**：用 ref 持有最新 `linkTargets`：
  ```ts
  const linkTargetsRef = useRef(linkTargets); linkTargetsRef.current = linkTargets
  const extensions = useMemo(() => [markdown(...), completions(() => linkTargetsRef.current), pasteDetection()], [])
  ```
  或对 `getLinkTargets` 用 `useCallback` 并加入依赖（但会每次渲染重建扩展，ref 方案更优）。

### 🟡 W2 可视化编辑器 `Markdown.configure({ html: true })` ⚠️本轮新发现（纵深防御）
- **位置**：`components/VisualEditor.tsx:127-132`。
- **原因**：`html: true` 允许解析原始 HTML。即时渲染侧（`Preview.tsx`）用 `html: false`，故**当前直接渲染路径安全**；但经 Tiptap 序列化回 Markdown 的内容若未来在任意 `html:true` 路径被渲染，存在存储型 XSS 风险面；且原始 HTML 可能在本应用的 Markdown 契约中丢失。
- **建议**：改为 `html: false`（本应用只用受控的 ```` ```api/params/callout/wiki ```` 语法，无需原生 HTML）；如确需，必须配合 `DOMPurify` 等清洗。

### 🟡 W3 `closeTab` 在 `setState` 更新函数内发起副作用 ⚠️本轮新发现
- **位置**：`components/WritingSpace.tsx:125-141`
  ```ts
  setOpenIds((ids) => {
    const next = ids.filter((i) => i !== id)
    if (id === activeId) {
      const fallback = next[next.length - 1] ?? null
      setActiveId(fallback)
      if (fallback) openPost(fallback).catch(console.error)  // ← 在 updater 里做异步副作用
    }
    return next
  })
  ```
- **原因**：React 要求状态更新函数**纯函数**。在 updater 内调用 `openPost`（异步 + 多次 `setState`）违反该约束；**React 18 StrictMode 下 updater 会双调用**，导致 `openPost` 被触发两次、重复拉取与状态抖动。
- **建议**：先在 updater 外算出 `next` 与 `fallback`，再调用 `setOpenIds(next)` 与（必要时）`openPost(fallback)`。

### 🟡 W4 用户操作失败静默（无前端反馈）⚠️本轮新发现（违背"三态"清单）
- **位置**：`components/WritingSpace.tsx` 多处 —— `createPost`（`:208`）、`moveFolder`（`:238`）、`movePost`（`:247`）。
- **原因**：这些 `catch` 仅 `console.error`，不向用户展示任何错误；例如拖拽移动文件夹被后端 409 拒绝时，UI 仅视觉回弹、无任何原因提示。
- **建议**：引入轻量错误提示（toast 或行内 `error` 文本），让"加载/错误/空态"三态对写类操作也成立。

### 💭 W5 认证上下文使用原始 `fetch` 而非 `api` 包装 ⚠️本轮新发现
- **位置**：`apps/write/src/auth.tsx:32`（login）、`:49`（verify-2fa）直接用 `fetch('/api/v2...')`；而 `logout`（`:62`）走 `api.post`。`apps/console/src/auth.tsx` 同构。
- **说明**：login/verify 手动解析响应体、手写 423/2fa 分支，绕过了 `api.ts` 的统一错误包络解析（`ApiError` 的 `code/message/details`）。功能可用，但重复且不一致。
- **建议**：将 login/verify-2fa 也收口到 `api` 包装，保持错误解析一致。

### 💭 W6 `AuthContext` 默认值为 `null as unknown as AuthState`
- **位置**：`auth.tsx:13`。
- **说明**：若任何组件在 Provider 外调用 `useAuth()` 会拿到 `null` 并崩溃。当前两应用均包裹 Provider，风险低。
- **建议**：Provider 外使用应抛明确错误，或提供一个 no-op 兜底。

### ✅ 已确认安全：Preview 双链渲染
- **位置**：`components/Preview.tsx:12-16`、`renderWikilinks`。
- **核查结论**：`renderWikilinks` 作用在 `md.render(b.md)`（markdown-it `html:false`）的输出上；markdown-it 已对 `& < > " '` 转义，故 `[[a"b]]` 的 `"` 会变成 `&quot;`，再插入 `title="…"` 不会逃逸出属性。**不存在 XSS**，无需修改。特在此注明，避免误报。

---

## 四、前端 · 设置控制台（`apps/console`）

### 💭 C1 与 write 应用高度同构，重复实现认证
- **位置**：`apps/console/src/auth.tsx`、`api.ts`、`components/Login.tsx` 与 write 几乎逐行相同。
- **建议**：把 `api.ts` / `auth.tsx` / `Login.tsx` 抽成共享包（如 `packages/ui-auth`），两个应用复用，减少漂移与后续双份修复成本。

### 💭 C2 `SettingsConsole` 设置加载合并逻辑可读但偏长
- **位置**：`components/SettingsConsole.tsx:88-93`。
- **说明**：一行内完成 `DEFAULTS` 与服务器设置的深合并，虽未产生共享可变状态（每次都新建对象），但可拆成 `mergeSettings(defaults, server)` 工具函数提升可测性。

### ✅ 构建轮询、备份回滚交互、系统监控/审计展示
- `watchBuild`（`:104`）轮询 `/build/:id` 并清理定时器；`BackupPanel`（`:502`）回滚前 `window.confirm` 二次确认；`SystemPanel`（`:435`）展示监控与审计。交互完整、状态清理到位，符合清单要求。

---

## 五、序列化器与存储契约

### 💭 R1 序列化未对 YAML 标量值加引号 ⚠️本轮新发现
- **位置**：`apps/write/src/lib/serializer.ts:227-235`（`paramToYaml` 仅对 `default` 加引号，`desc/name/type` 等裸写）。
- **风险**：若 `desc` 含 `:`、前导/尾随空格或特殊字符，可能破坏 YAML 解析、破坏 R3（往返语义等价）。现有 `migration-roundtrip` 测试已覆盖常见情形，但边界值（含冒号的描述）未覆盖。
- **建议**：对所有标量值统一加双引号（或改用成熟 YAML 库做序列化，与 `CODE_REVIEW.md` §4.4 建议一致）。

### ✅ R2 往返等价与降级处理良好
- `parse` 正确处理 CRLF（`serializer.ts:294`）、空 lang 围栏、frontmatter 原样保留（R4）、未知围栏降级为普通代码块（R2）。`paste-detect.ts` 的接口/参数表/GFM 三类启发式识别有配套单测（`paste-detect.test.ts`）覆盖。

---

## 六、磁盘同步 / 构建 / 备份（`server/src/services`）

> 以下结论沿用 `CODE_REVIEW.md` 基线，本轮未重新逐行走查 `sync.ts`/`backup.ts`/`audit.ts`/`crypto.ts`（非本轮重点，且基线已记录），行号以基线为准。

### 🟡 沿用基线发现
- `sync.ts:29` `slugify` 剥离 `\ / : * ? " < > | # ^ [ ]` 防路径穿越 —— **保留的好模式**。
- `backup.ts:70` 回滚名正则校验防路径注入 —— **保留的好模式**。
- `build.ts` 串行队列、失败保留上一版产物（`build.ts` 注释与 `runOnce` 实现）—— **保留的好模式**；但 Map 无上限/重启丢状态见 **S2**。

### 💭 K1 `prisma.ts` 全局单例缺少连接治理 ⚠️本轮新发现
- **位置**：`server/src/prisma.ts`（`export const prisma = new PrismaClient()`）。
- **说明**：未配置连接池上限、未监听 `beforeExit` 优雅断开；小应用可接受，但进程退出时可能丢未 flush 的写。
- **建议**：在 `index.ts` 增加 `process.on('SIGINT'/'SIGTERM', () => prisma.$disconnect())`；如并发升高，配置 `connection_limit`。

### 🔴(条件) K2 `seed.ts` 默认管理员口令 `change-me` ⚠️本轮新发现（部署到生产即升级 Blocker）
- **位置**：`server/src/seed.ts`（创建初始 admin，口令 `change-me`）。
- **原因**：口令为公开已知弱默认值；E2E 也与之一致（`e2e/tests/*` 的 `ADMIN.password = 'change-me'`）。
- **后果（开发环境）**：可接受。**生产环境**：若直接用该种子，任何人都可用 `admin@cloudletter.local / change-me` 登录，结合 🔴B2 无限流，危害极大。
- **建议**：
  1. seed 改为**从环境变量读取初始口令**，缺失则拒绝创建或强制首次登录改密；
  2. 或在首次登录流程强制改密（携带 `mustChangePassword` 标记）；
  3. 部署文档明确"禁止以默认口令上线"。

---

## 七、E2E（`e2e/`，Playwright）

### 💭 E1 测试依赖外部已启动的 dev 服务、无 `webServer` 自动拉起 ⚠️本轮新发现
- **位置**：`e2e/tests/*.spec.ts`（`page.goto('http://localhost:3013/...')` 等）。
- **说明**：`playwright.config.ts` 未配置 `webServer`，用例假定 `:3011/:3013/:3014` 已在运行。本地与 CI 跑 E2E 前需手动/脚本启动服务，否则整组失败。
- **建议**：在 `playwright.config.ts` 增加 `webServer` 配置（或 CI 步骤先 `pnpm dev` 再 `playwright test`），使 E2E 可一键运行；`CODE_REVIEW.md` 已将其列为按需/定时，建议至少提供一键脚本。

### 💭 E2 `write.spec.ts` 的 `page` 事件监听未清理 ⚠️本轮新发现
- **位置**：`e2e/tests/write.spec.ts:7-10`（`page.on('console')`/`page.on('pageerror')`）。
- **说明**：`login` 助手每调用一次就叠加监听，跨用例累积；虽仅写 stderr，但属泄漏。
- **建议**：监听挂在 `test.beforeEach`/`afterEach` 或在 fixture 中统一处理。

### 💭 E3 断言稳定选择器使用良好 ✅
- 用例普遍使用 `getByRole`/`getByText`/`locator('.sidebar')` 等稳定选择器，符合 `CODE_REVIEW.md` §4.5 要求；登录流程、模式切换、斜杠菜单、控制台六组、构建触发均有覆盖。

---

## 八、通用 / 跨切面

### 💭 G1 散落的 `any`
- `apps/write/src/api.ts:37`（`(data as any)?.error`）、`apps/write/src/lib/serializer.ts:114`（`(api as any)[key]`）、`apps/write/src/editor/richBlocks.ts` 多处（`state: any, node: any`、`md.use(container as any, ...)`）。
- **建议**：`api` 的响应先按统一 `ErrorEnvelope` 类型收窄；序列化器去 `any`（见 N4）；richBlocks 的 tiptap-markdown 闭包可加局部类型或 `// typed as tiptap-markdown SerializerState`。

### 💭 G2 `richBlocks.ts` 中段 import
- **位置**：`apps/write/src/editor/richBlocks.ts:86` `import { Extension } from '@tiptap/core'` 出现在文件中部（ESM 会提升，可运行，但 `import/order` 会报警）。
- **建议**：移到文件顶部。

### 💭 G3 `console.log` 调试残留
- `apps/write/src/components/WritingSpace.tsx`（`:119`、`:176`、`:210`、`:243`、`:252`）以及 `index.ts:35` 等为 `console.error`/`console.log` 调试输出。按本仓库 ESLint 配置（`no-console` 仅放行 warn/error）属合规，但生产环境建议收敛到统一日志/前端错误提示（呼应 W4）。

---

## 九、保留的好模式（评审时确认未被破坏）✅

- **统一错误包络** `{ error: { code, message, details } }` 与错误码体系（`AUTH_REQUIRED/FORBIDDEN/VALIDATION/CONFLICT/...`），前后端一致。
- **RBAC 四级**（`admin/editor/author/viewer`）+ `requireRole` 中间件，写接口均按最小角色保护。
- **审计日志 `audit()` 已容错**（失败不阻断业务）。
- **2FA 双步 + TOTP（RFC6238）**，±1 窗口；改密后撤销其他会话（`v2.ts:513`）。
- **备份回滚名正则校验** + **slugify 防路径穿越**；构建串行队列、失败保留上一版产物。
- **序列化契约 R1–R4** 清晰，且有 `migration-roundtrip` / `paste-detect` 单测守护。
- **前端错误边界意识**：`openPost`/`createPost` 等用 `try/catch` 避免整页崩溃（§15 注释）。
- **Prisma 查询用好 `select`/`include`**，避免 N+1（如 `v2.ts:164`）。

---

## 十、优先修复路线图

**必须修（合并前 / 上线前）**
1. 🔴 **B1** 异步路由错误捕获（catchAsync 或 Express 5）。
2. 🔴 **B2** 认证端点限流 + 失败锁定（login/verify-2fa/password）。
3. 🔴(条件) **K2** 移除/隔离 `seed.ts` 默认口令 `change-me`，禁止以默认凭据上线。

**应当修（本轮或建 issue）**
4. 🟡 **S3** `PUT /posts/:id` 用 `updatedAt` 乐观锁（409）。
5. 🟡 **S1** 引入 zod；`/settings` 仅允许已知分组。
6. 🟡 **S2** 构建状态 Map 上限 + 重启可恢复。
7. 🟡 **S4** 加 `helmet` / CORS 白名单。
8. 🟡 **W1** 修复 `[[` 双链补全的 `useMemo([])` 陈旧闭包（实际功能 Bug）。
9. 🟡 **W2** 可视化编辑器 `html:false`。
10. 🟡 **W3** `closeTab` 移出 setState updater 的副作用。
11. 🟡 **W4** 用户写操作失败的前端反馈（toast/行内错误）。

**可选（不阻塞）**
12. 💭 N1–N4、W5、W6、C1、R1、K1、E1–E3、G1–G3 等（详见各节）。
13. 💭 抽离 `apps/write` 与 `apps/console` 的 `api/auth/Login` 共享包（C1）。

---

## 十一、审查覆盖清单

| 区域 | 是否逐文件审查 | 说明 |
|------|---------------|------|
| `server/src/index.ts` | ✅ 本轮复核 | 入口、错误中间件、helmet 缺口 |
| `server/src/routes/v2.ts` | ✅ 本轮复核 | 全部 30+ 路由，确认 B1/B2/S1/S3/N1/N2/N3 |
| `server/src/services/build.ts` | ✅ 本轮复核 | jobs Map、瞬时重试、魔法数字 |
| `server/src/prisma.ts`、`seed.ts` | ✅ 本轮 | 单例治理、默认口令 |
| `server/src/middleware/auth.ts`、`crypto.ts`、`sync.ts`、`backup.ts`、`audit.ts` | ⚠️ 沿用基线 | 本轮未重读，结论见 `CODE_REVIEW.md` 第六节；好模式已确认 |
| `apps/write/src/**` | ✅ 本轮 | 发现 W1–W6、R1、G1 |
| `apps/console/src/**` | ✅ 本轮 | 发现 C1–C2 |
| `apps/write/src/lib/serializer.ts`、`paste-detect.ts`、`editor/richBlocks.ts` | ✅ 本轮 | R1、G1、XSS 核查（Preview 安全） |
| `e2e/tests/*.spec.ts` | ✅ 本轮 | E1–E3 |
| `fuwari-blog/` | ❌ 不适用 | 第三方模板，按依赖处理 |

---

_本报告与 `docs/CODE_REVIEW.md` 配套使用：本文件是"逐文件审查结果"，`CODE_REVIEW.md` 是"标准与流程"。新增反模式请同步回填到 `CODE_REVIEW.md` 第六节对应级别，并优先修 🔴。_
