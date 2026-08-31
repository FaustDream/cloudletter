# 代码审查报告 · 2026-08-29

> 范围：`server/`（Express + Prisma）、`apps/write`、`apps/console`、`apps/workbench`、`e2e/`、部署工作流。
> 客观信号：server 前端四包 `tsc --noEmit` 全部通过；server vitest 14/14 通过；本次审查中发现并已修复 1 个 UI bug（时间线浮窗层级，见文末附录）。

## 🔴 高（建议立即处理）

### H1. 未认证可读草稿：公开搜索接口泄漏未发布内容
- `server/src/routes/index.ts:19` 挂载 `/search` 未加 `requireAuth`；`server/src/routes/search.ts:88,107` 的 `?includeDraft=1` 会返回草稿的标题、摘录、标签。
- 任何人 `GET /api/v2/search?q=x&includeDraft=1` 即可枚举全部草稿。
- 建议：`includeDraft=1` 时强制 `requireAuth`，或草稿仅在会话有效时纳入。

### H2. SMTP 未配置时验证码/重置链接直接放进 HTTP 响应
- `server/src/routes/auth.ts:144-146,179-182,217-220`：`!smtpEnabled()` 时把登录验证码、解锁码、重置链接明文放在响应 `dev` 字段。
- `smtpEnabled()`（`mailer.ts`）只看 SMTP 环境变量，与 NODE_ENV 无关；生产 systemd 单元（`server/deploy/cloudletter-server.service`）并不注入 SMTP 变量。若服务器 `.env` 缺失/损坏，生产即处于「验证码即响应」状态，配合 H3 可直接接管账户。
- 建议：`dev` 字段仅当 `NODE_ENV !== 'production'` 才下发（双重条件）；生产缺 SMTP 时发码端点直接 503。

### H3. 验证码登录/解锁无频控、无失败次数限制
- `server/src/routes/auth.ts:186-196`（login-by-code）、`:150-159`（unlock）：`rateLimited()` 只用于密码登录（`:79`）；`consumeMailCode` 不计失败次数。
- 6 位数字码 10 分钟有效，无限制并发下数分钟可穷举。
- 建议：两个端点复用 `rateLimited()`，并对同一 mailCode 记录失败次数（≥5 作废）。

### H4. SearchPage：清空搜索词后未转义文本直接进 innerHTML（XSS）
- `apps/workbench/src/pages/SearchPage.tsx:27`：`highlight()` 的 `if (!q) return text` 原样返回**未转义**文本；`:186,189,210` 三处 `dangerouslySetInnerHTML`。
- 确定性触发：搜索命中后清空输入框 → `highlight(title, '')` 走 raw 路径 → 文章标题/摘要/工作台笔记（用户可控，如粘贴的 `<img src=x onerror=...>`）被当作 HTML 执行。
- 另有切片错位：`:35-37` 用原始 q 长度切已转义字符串（q=`&` 时 `<mark>` 范围错乱）。
- 建议：删除 `if (!q) return text` 统一走转义路径；转义补 `"`/`'`；更优做法是改用 React 元素拼 `<mark>` 而非 innerHTML。

### H5. WritingSpace：发布流程静默丢弃本地修改
- `apps/write/src/components/WritingSpace.tsx:229-240`：`publish()` 内 `await doSave()` 命中 CONFLICT 时不抛错（`:188-195` 吞掉置 `conflict`），publish 继续执行不带 `baseVersion` 的 `api.put`（后端 `posts.ts:330` 缺省即跳过冲突检测），随后 `openPost` 用服务器版本覆盖编辑器——本地修改无提示丢失。`saveState === 'conflict'` 时点「发布」同样复现。
- 建议：`publish()` 前检查 conflict 即中止；或 doSave 冲突时向上传递失败。

### H6. 部署不执行 Prisma 迁移，生产库 schema 会静默漂移
- `.github/workflows/deploy.yml:72-75` 远端只跑 `pnpm install + db:generate`；仓库无 `prisma/migrations` 目录；`db:migrate` 脚本是开发专用的 `prisma migrate dev`。
- 一旦 `schema.prisma` 变更（如新增列），部署后服务对新列读写直接 500。
- 建议：`prisma migrate dev` 建立基线并提交 migrations；部署脚本在 restart 前增加 `prisma migrate deploy`。

## 🟡 中

### 后端

1. **Session token 明文入库** — `server/prisma/schema.prisma:41`、`server/src/auth.ts:31-33`。MailCode 已只存哈希，Session 应同样库存 `sha256(token)`，查询时对 Bearer token 哈希后查找（「记住我」30 天有效，泄露后果放大）。
2. **`/posts/batch` 完全没有入参校验** — `server/src/routes/posts.ts:158-223`。`payload.tags` 非数组时 `syncTagsWorker` 内 `.filter` 抛 500；且 `action === 'tag'` 缺省空数组会 `deleteMany` 清空所选文章全部标签再重建为空。建议接入 `validateBody`，空 names 提前 422。
3. **workbench PUT 把一切 Prisma 错误映射成 404** — `server/src/routes/workbench.ts:319-332`。字段类型非法时也返回「记录不存在」，误导排障；建议只捕 P2025（全局错误中间件已有 P2025 分支）。POST/PUT 的 `sanitizeObj` 只做白名单不过类型，`amount`/`date`/`log` 等可为任意值。
4. **categories/tags PUT 未接 validateBody** — `server/src/routes/categories.ts:34-50`、`tags.ts:31-41`。`newName` 非字符串 → 500；唯一列冲突 P2002 未映射 409。
5. **一条非法 published 日期让公开搜索整体 500** — `server/src/routes/search.ts:129` 对 Invalid Date 调 `toISOString()` 抛 RangeError；且每次请求同步遍历全部 md 文件阻塞事件循环，`total: top.length` 是截断后数量。
6. **发送验证码类端点无频控（邮件轰炸）** — `send-code`/`send-unlock`/`send-reset` 每次调用都会删旧发新并真实发信，可被外部刷信。
7. **frontmatterToYaml 值不加引号** — `server/src/content.ts:36-52`。标题含换行（title 只限长度不限换行）即产出非法 YAML，破坏「文件真相源」；tags 含 `,` 亦断。建议对字符串值统一引号包裹/转义。
8. **批量删除先删文件后删库，无回滚** — `posts.ts:172-178`。DB `deleteMany` 失败则文件已丢、索引仍在，违背「文件真相源」不变量。
9. **CORS 反射任意 Origin** — `server/src/index.ts:28-38`。Bearer 方案下可利用性低，仍建议白名单化。
10. **`trust proxy` 未设置** — 反代后 `req.ip` 恒为 127.0.0.1，登录限流的 IP 维度失效（`auth.ts:79`）；`recordLogin` 的 XFF 兜底 `?.[0]` 对字符串头取的是首字符（`routes/auth.ts:21`），应 `split(',')[0].trim()`。
11. **登录限流内存 Map 无上限** — `routes/auth.ts:61-69`，伪造邮箱可缓慢撑大；建议定期清扫。
12. **settings 读写健壮性** — `routes/settings.ts:17,29` JSON.parse 无防御；先写 DB 后写文件且 `writeSettingsFile`（`content.ts:109-113`）非原子写，与 `writePostFile` 风格不一致，失败即分叉。

### 前端

13. **Token 存储与 401 处理缺失（三应用同病）** — `apps/*/src/api.ts:12-33`：Bearer token 写 JS 可读 cookie（仅 SameSite=Lax 无 Secure）+ localStorage 双写；`request()` 不识别 401，会话过期后所有列表页 `.catch(() => {})` 静默显示「暂无数据」而非回登录页。建议 api 层统一拦截 401 → 清 token → 跳 `/login`。
14. **`/auth/me` 网络失败也清 token** — `apps/*/src/auth.tsx:26`，抖动/500 即强制重登；应仅对 401 清除。
15. **日期全用 UTC，东八区 0-8 点数据记到昨天** — workbench `QuickActions.tsx:82,93`、`QuickNoteModal.tsx:43`、`NotesPage.tsx:36`、`LedgerPage.tsx:39,56`、`CheckinPage.tsx:8,19,116`、`PlanPage.tsx:13`；速记/记账/打卡/热图/「本月」统计全受影响。服务端 timeline 聚合同样按 UTC（`workbench.ts:92-95`），而前端 `timeline.ts` 的 `dayLabel/daysAgo` 按**本地**「今天」比较——两套约定混用。建议统一本地日期工具 `todayYMD()`。
16. **应用间跳转硬编码 `//localhost:3013/3014`（协议相对）** — workbench `AvatarMenu.tsx:48,49`、`QuickActions.tsx:109`、`PostsPage.tsx:138,200,216,230,247`、`SearchPage.tsx:182`、console `Dashboard.tsx:80`。非 localhost 部署全失效，HTTPS 下被混合内容拦截；console「编辑」不带文章 id。建议集中 `APP_URLS` 配置。
17. **三份 api.ts/auth.tsx/Login.tsx 手抄拷贝已漂移** — write 与 console 逐字相同，workbench 已独自长出 captcha/profile 等能力。任何鉴权修复都要改三处。建议抽 `packages/api`、`packages/auth` 共享包。
18. **登录「图形验证码」把答案明文发前端** — `LoginPage.tsx:83,421-423` 渲染 `details.text`；脚本读 JSON 即绕过，仅有摩擦价值。建议后端返回 SVG，文本不出服务端。
19. **Preview wikilink 后处理把未转义数据拼 HTML 属性** — `apps/write/src/components/Preview.tsx:11-13`，`` title="${target}" `` 直接内插；当前内容仍限于 markdown-it 安全输出、未构成可利用 XSS，但属危险写法。建议 escapeHtml 或改用 renderer rule。
20. **e2e 内容目录隔离已失效** — `e2e/playwright.config.ts:47,77` 设置的 `PROJECT_DIR` 是死变量（`server/src/config.ts` 只读 `POSTS_ROOT/SETTINGS_ROOT`），e2e 后端实际读写 `server/data/dev`，会污染真实数据（`e2e/content/` 里的残留建文可证）。
21. **Toast/错误提示定时器无清理** — workbench `Toast.tsx:20` setTimeout 不清理、`value` 每帧新建；write `WritingSpace.tsx:58-64` errorTimer 同类。
22. **deploy.yml** — `:62,65` `StrictHostKeyChecking=no` 使 `:48-49` 配置的 known_hosts 形同虚设，且 root 直登；无 `concurrency` 组；restart 后无 `/healthz` 探活；nginx 配置完全不在版本库。

## 🔵 低（择要）

- Editor 工具栏插入永远追加文末（`write/Editor.tsx:81`），且模式切换卸载重挂丢失撤销历史。
- `openPost` 无竞态保护，慢响应覆盖新文档（`WritingSpace.tsx:106-133`）；切换/关闭标签页不 flush 防抖窗口内的脏内容。
- Shell 快捷键 effect 缺依赖数组（workbench `Shell.tsx:85-96`）；同名 Esc 监听叠加，一次 Esc 关闭所有弹层。
- LoginPage 密码可见按钮 `name="eye-off"` 与 Icon 注册名 `eyeOff` 不匹配，显示兜底图标（`LoginPage.tsx:310,346`）。
- 模块级 `today` 常量跨天失效（`CheckinPage.tsx:8`、`PlanPage.tsx:13`）。
- 「改写今日小结」只存 localStorage 换设备即丢（`TimelineBubbles.tsx:185-191`）。
- SettingsPage：渲染期调用 `nav()`、bio 保存被静默丢弃、clearCache 造成 token 双存储不一致、`createObjectURL` 未 revoke。
- 金额用 `Float` 存储有精度误差，建议以「分」存（`schema.prisma:142`）；`MailCode` 缺 `@@index([email, purpose])`；`GoalItem` JSON 字符串关联无引用完整性。
- systemd 以 root 运行、无沙箱加固，残留 `BUILD_CMD`/`CI=true` 死配置（`server/deploy/cloudletter-server.service`）。
- `seed-demo.ts` 不检查 NODE_ENV，生产误执行会追加演示数据。
- eslint 全局忽略 `**/*.config.*`，playwright/vite 配置不在 lint 范围；CI 里 `pnpm add -D eslint@9` 动态改装依赖。
- e2e 浏览器 job 在 CI 中被注释、`executablePath` 硬编码 Windows 路径，13 条用例实际只能本机手动跑；发布/冲突/版本恢复/密码流程等关键路径无覆盖。
- `server/pnpm-workspace.yaml` 缺 `packages` 字段，`pnpm dev` 在 server 目录直接报错（本次启动时实测）。
- `crypto.ts` 保留 TOTP 实现但 2FA 已移除（`auth.ts` 注释），属死代码。

## 优先修复建议（按投入产出排序）

1. H1/H2/H3：搜索接口鉴权 + demo 验证码加 NODE_ENV 双开关 + 验证码端点频控（各 ~10 行）。
2. H4：SearchPage 删掉 raw 分支（1 行）+ 转义补全。
3. H5：publish 前检查 conflict（几行）。
4. H6 + e2e 隔离（#20）：`prisma migrate deploy` 进部署、`POSTS_ROOT/SETTINGS_ROOT` 进 e2e env。
5. #13：三应用统一 401 拦截（顺手做共享包化）。
6. #15：统一本地日期工具。

## 总体评价

工程结构清晰（分层路由、统一错误包络、ah() 异步包装、文件原子写、「文件先落 DB 后提交」的真相源约定），seed 的弱口令拒绝与 MailCode 只存哈希体现了安全意识；类型检查与单测全绿。主要短板集中在三处：**认证链路的降级逻辑**（demo 验证码、无频控、公开搜索读草稿）使生产安全性取决于仓库外手工维护的 `.env`；**三份手抄的前端基础设施**已经漂移且共同缺失 401 处理；**UTC/本地日期混用**这类约定性 bug 渗透在数据写入与展示两侧。建议先做上面 6 项小改动，再规划共享包化与迁移基线两个结构性工程。

---

## 附录：本次审查中修复的问题

**时间线详情浮窗被后续行遮挡**（`apps/workbench/src/styles/main.css`）：
- 现象：悬浮/点击气泡后弹出的 `.tb-detail` 详情卡被下方时间线气泡（如「完成计划 P0」「📖 晨间阅读」）盖住，内容不可读。浏览器实测复现（:3015 总览页，左右两侧气泡均复现）。
- 根因：`.tb-bubble` 的 `backdrop-filter: blur(8px)` 使每枚气泡各自成为层叠上下文，`.tb-detail` 的 `z-index: 14` 只在气泡内部生效；后续 DOM 顺序的同级气泡按文档顺序绘制，直接覆盖前序浮窗。
- 修复：悬浮/常驻时抬升整个气泡层级 —— `.tb-bubble:hover, .tb-bubble.pinned { z-index: 20; }`。已在浏览器验证 hover、点击常驻（pin）、Esc 收起、左右两侧共四种场景。

## 附录二：第二轮修复记录（2026-08-29 当晚）

**安全类（全部已实施，server 单测 14/14 通过）：**
- H1：`/api/v2/search` 整体挂 `requireAuth`（博客前台已下线，工作台检索页是唯一消费方）；另修复非法 frontmatter 日期导致检索 500（`safeDate`）。
- H2：演示模式验证码/重置链接下发加双重条件（`!smtpEnabled()` 且 `NODE_ENV !== 'production'`），生产缺 SMTP 时发码端点直接 503。
- H3：邮箱验证码改 8 位字母数字混合（去易混字符）；「输错一次即作废」；`send-code/send-unlock/send-reset` 加 3 次/分钟发码频控，`login-by-code/unlock` 加校验频控。
- 中5：Session token 库内只存 sha256 哈希（`hashToken`）——**注意：已存在的旧会话全部失效，需重新登录**。
- 中8：批量删除改为先删库再尽力删文件（DB 失败不再丢内容）。
- 中2：`/posts/batch` 打标签校验 `payload.tags` 为非空字符串数组（修复空数组清空标签 + 非数组 500）。
- 低10：`recordLogin` 的 XFF 兜底改 `split(',')[0]`。
- 真相源：`frontmatterToYaml` 对含特殊字符的标量加 YAML 单引号转义（标题带换行不再破坏文件）。
- 低17：`apps/workbench`、`server` 的 `pnpm-workspace.yaml` 补上 `packages` 字段（修复 `pnpm install/dev` 直接报错）。

**前端类（工作台）：**
- H4：SearchPage `highlight()` 重写——删除未转义 raw 分支，转义补全 `"`/`'`，匹配在原文定位后再转义拼接（修复 XSS 与切片错位）。
- 中13/14：`api.ts` 统一 401 拦截（清 token → 回登录页，登录接口本身除外）；`/auth/me` 仅对 401 清 token（网络抖动不再强制重登）。
- H5 + 编辑器并入：新增 `pages/EditorPage.tsx`（路由 `posts/new`、`posts/:id/edit`），发布前检查冲突态即中止，`beforeunload` 脏内容提醒；编辑器组件（CodeEditor/Preview/Outline/RevisionPanel）并入 `components/editor/`，并修复工具栏光标处插入（原为追加文末）与 wikilink 属性转义。

**架构整合（应用收敛为单体）：**
- `apps/write`、`apps/console` 独立应用及其登录页已删除；写作空间成为工作台「文章」模块的编辑页，控制台的站点设置并入工作台「设置 · 站点设置」分组，分类/标签管理本就在「组织」页。
- 全部 `//localhost:3013/3014` 硬编码跳转改为工作台内部路由（PostsPage/QuickActions/AvatarMenu/SearchPage）。
- `deploy.yml`：改为打包 server + workbench 单体，增加 `prisma db push` 同步库结构、healthz 探活、`concurrency` 组，去掉 `StrictHostKeyChecking=no`；`ci.yml` 前端门禁改为 workbench。
- e2e：删除 write/console/auth 旧用例，新增 `editor.spec.ts`（新建→编辑→自动保存→列表）与站点设置用例；webServer 收敛为 4011+4015，并修复内容目录隔离（`PROJECT_DIR` 死变量 → `POSTS_ROOT`/`SETTINGS_ROOT`）。
- 浏览器实测：登录 → 新建草稿 → 编辑分屏 → 自动保存 → 返回列表 → 站点设置保存，全链路通过；时间线（113 枚气泡）不受影响。
