# 云笺集 · 代码审查标准与流程

> 适用范围：`server/`（Express + Prisma + SQLite）、`apps/write` 与 `apps/console`（React + Tiptap + Vite）、`e2e/`（Playwright）。
> 不适用：`fuwari-blog/` 为第三方 Astro 模板，按"依赖"对待，仅评审对其的定向改动，不纳入本仓库的 Lint / 单测门禁。
> 配套文件：`.github/workflows/ci.yml`（自动门禁）、`PULL_REQUEST_TEMPLATE.md`、`CODEOWNERS`、`eslint.config.js`、`.prettierrc`、`.editorconfig`。

---

## 一、为什么需要这套机制

本仓库已是多包 monorepo，代码量不小，但当前**只有部署流水线、没有质量门禁**：

- 全仓库**没有任何 ESLint / Prettier 配置**；
- `deploy.yml` 只做 `pnpm install → build → scp → systemctl restart`，**不跑类型检查、不跑单测、不跑 lint**；
- 因此任何代码（含会 500 的提交）都能直接合入并部署到生产。

代码本身有不少好模式（统一错误包络、RBAC、审计容错、备份名正则防注入、slugify 防路径穿越），但仍有若干真实风险（见第六节"基线审计"）。本机制的目标：**在合并前用"自动门禁 + 人工审查清单"挡住明显错误，保留好模式，逐步偿还技术债。**

---

## 二、严重级别定义

评审意见一律用以下三级标注，便于作者与审批人共识：

| 级别 | 含义 | 处理要求 |
|------|------|----------|
| 🔴 **Blocker（必须改）** | 安全漏洞、数据损坏/丢失、生产可宕机、破坏契约、缺关键错误处理 | 合并前**必须修复** |
| 🟡 **Suggestion（应当改）** | 输入校验缺失、并发隐患、明显性能问题、可维护性问题、缺测试 | 本次修复，或建 issue 跟踪并说明 |
| 💭 **Nit（可选）** | 命名、规范一致性、微小优化 | 可选，不阻塞 |

> 评审人要"一次给全反馈"，不要分多轮 drip-feed；每条意见写清 **位置 + 原因 + 建议改法**。

---

## 三、合并门槛（Definition of Done）

一个 PR 可以合并，当且仅当：

1. **CI 全绿**：`typecheck` ✅、`test`（单测）✅、`lint`（ESLint）✅、`build`（生产构建）✅；
2. **PR 模板已填**，自审清单全部勾选；
3. **无未解决的 🔴**；🟡 要么本次修，要么挂 issue 并说明；
4. **关键路径有测试**：涉及 API 契约、序列化、鉴权/权限、存储落盘的改动必须带测试；
5. 至少一个审批（solo 项目时至少完成自审清单 + 必要时代码走查）。

---

## 四、分模块评审清单

### 4.1 后端 API（`server/src`，Express + Prisma）

**🔴 正确性 / 可靠性**
- [ ] Express 4 下 `async` 路由若抛错会**变成未处理 rejection、响应永不返回**（见基线 #1）。新增 / 修改路由必须用 `catchAsync` 包裹，或确认错误能被全局中间件捕获。
- [ ] 每个 DB 写操作都有失败处理或上层有兜底；不要在请求主链里"裸 await"可能抛错的调用却不处理。
- [ ] 并发写同一资源（文章、文件夹）要有乐观锁 / 版本校验，避免 TOCTOU 覆盖（见基线 #5）。
- [ ] 外部进程调用（`exec` 构建）有超时、有错误回调、有瞬时失败重试（参考 `build.ts` 现有做法）。

**🔴 安全**
- [ ] 认证端点（login / verify-2fa / change-password）**必须有限流或失败锁定**（见基线 #2），避免在线爆破。
- [ ] 所有写接口在 `requireAuth` + 最小 `requireRole` 之后才执行业务（四级 RBAC：admin/editor/author/viewer）。
- [ ] 任何来自 `req.body` / `req.query` / `req.params` 的值都**不能未校验就进 DB 或拼进 shell / 文件路径**（见基线 #3、#4）。
- [ ] 错误响应**不泄漏内部细节**（堆栈、SQL）；统一走 `{ error: { code, message, details } }` 包络。
- [ ] 密码相关：仍用 scrypt + `timingSafeEqual`；新密码长度/复杂度有校验；改密后撤销其他会话。

**🟡 可维护性 / 性能**
- [ ] 用统一校验层（推荐 **zod**）替代散落的 `if (!x) return err(...)`；`PUT /settings` 的浅合并必须限定已知字段，禁止任意键注入。
- [ ] 不在请求主链路里留 `console.log` 调试；用 `audit()` 记录关键操作（已容错，失败不阻断业务）。
- [ ] 魔法数字命名（如冲突容差 `1000`、Windows 退出码）提取为常量。
- [ ] 避免在热路径做 N+1 查询（Prisma `include` / `select` 已用得好，保持）。

### 4.2 前端（`apps/write`、`apps/console`，React + TS）

- [ ] 组件职责单一；重逻辑抽到 hooks / utils，不要塞进组件体。
- [ ] 所有 `fetch` / 异步调用有 loading / error / 空态三态；错误信息对用户友好（中文）。
- [ ] 不把密钥 / 内部地址写死在前端；配置走环境变量或后端下发。
- [ ] `useEffect` 依赖完整，避免无限渲染；清理订阅 / 定时器。
- [ ] 列表 / 树等大数据用合适的 key 与虚拟化；避免每次渲染重建大对象。
- [ ] 类型优先于 `any`；props 有类型；避免 `as any`（见基线 #10）。

### 4.3 序列化器与存储契约（`server/src/serializer`）

- [ ] 任何 Markdown ↔ Block 的解析/序列化改动，必须补"往返语义等价"测试（参考现有 `migration-roundtrip` 思路：CRLF、空 lang 围栏、frontmatter、未知围栏降级）。
- [ ] 新块类型先定义 `Block` 联合类型与契约（R1~R4），再加测试。

### 4.4 磁盘同步 / 构建 / 备份（`services/sync`、`services/build`、`services/backup`）

- [ ] 写文件只用 `slugify` 后的 slug 拼路径，禁止用原始用户输入拼路径（防路径穿越）。
- [ ] frontmatter 用 YAML 序列化库而非字符串拼接（避免特殊字符破坏"唯一真相源"）。
- [ ] 构建队列串行、失败保留上一版产物；构建状态 Map 需有上限/可恢复（见基线 #4）。
- [ ] 备份 / 回滚：回滚名必须正则校验（已有，保持）；回滚前自动安全快照。

### 4.5 E2E（`e2e/`，Playwright）

- [ ] 涉及用户可见流程的改动（登录、保存、构建、双链、版本恢复、树拖拽）补/改对应 spec。
- [ ] 测试独立、可重复；不依赖固定时间；共享测试库（`e2e-test.db`）避免并发冲突。
- [ ] 只用 `getByRole` / `getByText` 等稳定选择器，少依赖 CSS 类。

### 4.6 通用

- [ ] 命名自解释；布尔用 `is/has/can` 前缀；函数名动词开头。
- [ ] 提交信息清晰（做什么 + 为什么），关联 issue / 规格章节（如 §6.2）。
- [ ] 删除死代码、注释掉的代码、调试 `console.log`。
- [ ] 新增公共函数 / 复杂逻辑写一句话注释说明"为什么"，而非"是什么"。

---

## 五、审查操作流程（操作手册）

1. **分支**：从 `master` 切 `feature/xxx` 或 `fix/xxx`；一个 PR 一个关注点，规模建议 < ~400 行。
2. **提交前本地自检**（CI 会再跑一遍，先本地过关更快）：
   ```bash
   # 在每个包内分别执行
   pnpm typecheck && pnpm test && pnpm lint
   ```
3. **开 PR**：用 `PULL_REQUEST_TEMPLATE.md` 模板填写（改了什么 / 为什么 / 测试 / 自审清单）。
4. **评审**：评审人按本文件第四节逐项核对，用 🔴/🟡/💭 标注；作者一次性修完或建 issue 说明。
5. **CI 必过**：`ci.yml` 的 typecheck / test / lint / build 全部绿（仓库已设 required checks）。
6. **合并**：🔴 清零、🟡 有交代后可合并；合并后删分支，PR 描述 `closes #xxx`。

**SLA**：PR 提出后 24h 内给出首轮评审；争议由 Owner（@Lynn）仲裁。

---

## 六、当前代码库基线审计（快照，待跟踪）

> 以下为制定标准时的一次性走查结论，按严重级别列出，作为技术债看板。行号基于 2026-08-21 快照。

### 🔴 Blocker
1. **Express 4 异步错误不会进错误处理中间件** — `server/src/routes/v2.ts` 全部路由为 `async (req,res)=>{...}`，既无 `try/catch` 也无 `catchAsync` 包装；`express@4.21.2` **不会把 rejected promise 转发给错误中间件**（index.ts:29 的包络因此抓不到）。后果：DB 报错 → 请求挂起直至客户端超时，且可能触发 `unhandledRejection`。**建议**：加 `catchAsync` 高阶函数包裹所有路由，或升级 Express 5（自动转发）。
2. **认证端点无速率限制 / 锁定** — `v2.ts:40` login、`v2.ts:57` verify-2fa、`v2.ts:503` change-password 均无限流、无失败计数锁定。口令虽用 `timingSafeEqual`，但在线爆破成本极低。**建议**：接入 `express-rate-limit`（按 IP + 按账户），登录失败累加锁定。

### 🟡 Suggestion
3. **缺统一入参校验层** — 各路由直接 `req.body ?? {}` 信任字段；`PUT /settings`（v2.ts:429）用 `{...current, ...req.body}` 浅合并，**任意键都会写进 SiteSetting**（对象注入）。**建议**：引入 zod，每个接口定义 schema；`/settings` 仅允许已知分组字段。
4. **构建任务 Map 无上限 + 重启丢失状态** — `services/build.ts:20,42` `jobs` Map 永不淘汰（内存泄漏），进程重启后 `getBuild` 返回 null。**建议**：设最大保留条数；或用持久表记录构建状态。
5. **`PUT /posts/:id` 冲突检测为 TOCTOU** — `v2.ts:174-183` 仅用 JS 比较 `updatedAt` ±1000ms，未把 `updatedAt` 放进 Prisma `where`；两次近同时保存都会通过校验、后者覆盖前者。**建议**：用 `updatedAt` 作为乐观锁条件（`where: { id, updatedAt }`），冲突即 409。
6. **无显式 CORS / 安全头（helmet）** — 仅 `index.ts:13` 关了 `x-powered-by`。当前经 nginx 反代，但纵深防御建议显式配置（尤其生产若直连）。**建议**：加 `helmet`，按需开 CORS 白名单。

### 💭 Nit
7. **`setup-2fa` 先写 `totpSecret` 再校验**（v2.ts:81-85）：用户放弃启用会留下游离密钥。可改为"验证通过后再落库"。
8. **`req.user!` 非 null 断言遍布**（如 v2.ts:154 等）：逻辑上安全（requireAuth 先于业务），但属 smell；建议用显式守卫或 Express 5 的 `Request` 类型收窄。
9. **魔法数字**：冲突容差 `1000`（v2.ts:178）、Windows 退出码 `3221225794/3221225786`（build.ts:76）应提取为命名常量。
10. **`serialize` 用 `(api as any)[key]`**（serializer.ts:114）破坏类型安全，建议用显式字段映射。

### ✅ 值得保持的好模式（评审时确认未被破坏）
- 统一错误包络 `{ error: { code, message, details } }` 与错误码体系。
- RBAC 四级 + `requireRole` 中间件；审计日志 `audit()` 已做容错（失败不阻断业务，audit.ts:7）。
- 2FA 双步 + TOTP（RFC6238）；`verifyTOTP` ±1 窗口。
- 备份回滚名正则校验防路径注入（backup.ts:70）。
- `slugify` 剥离 `\ / : * ? " < > | # ^ [ ]` 防路径穿越（sync.ts:29）。
- 构建串行队列、失败保留上一版产物；`x-powered-by` 关闭。

---

## 七、自动化门禁（工具链）

### 一次性初始化（本仓库尚未装 Lint 工具）
每个 TS 包执行（以 `server` 为例，apps 额外加 react 插件）：
```bash
# server / e2e
pnpm add -D eslint@9 @eslint/js@9 typescript-eslint@8 globals prettier
# apps/write、apps/console 额外
pnpm add -D eslint-plugin-react eslint-plugin-react-hooks
```
> 说明：CI（`ci.yml`）会在各自 job 内自行 `pnpm add -D` 装好 Lint 工具再跑，因此**即使你本地还没装，PR 也能被门禁拦截**。本地安装只是为了"提交前自检更快"。

### 日常命令（每个包内）
```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # vitest run（server / apps/write）
pnpm lint          # eslint .
pnpm format        # prettier --write .   （首次可全员跑一次做基线格式化）
```

### 可选：提交前钩子（husky + lint-staged）
```bash
pnpm add -D husky lint-staged
npx husky init
# .husky/pre-commit:
# npx lint-staged
# package.json 增加：
# "lint-staged": { "*.{ts,tsx}": ["eslint --fix", "prettier --write"] }
```

### CI（`.github/workflows/ci.yml`）
- 触发：对 `master` 的 PR。
- 对每个包并行跑：`install`（frozen）→ `db:generate`（server）→ `typecheck` → `test` → 装 Lint 工具 → `lint` → `build`（前端）。
- E2E（Playwright）较重，放在**按需 / 定时**运行，不阻塞普通 PR（详见 ci.yml 注释）。

---

## 八、评审意见格式示例

```
🔴 安全：认证端点无限流（v2.ts:40 login）
原因：当前仅 timingSafeEqual 防时序，但无失败锁定，攻击者可在线爆破口令。
建议：加 express-rate-limit，按 IP 与账户维度限制 /auth/login 与 /auth/verify-2fa，
     例如 5 分钟内失败 5 次锁定 15 分钟。

🟡 并发：PUT /posts/:id 冲突检测有 TOCTOU（v2.ts:174）
原因：JS 比较 updatedAt 与把 updatedAt 放进 Prisma where 之间，另一请求可能已写入。
建议：prisma.post.update({ where: { id, updatedAt: baseVersion } })，命中 0 行即 409。

💭 命名：build.ts:76 的 3221225794 建议提取为 WINDOWS_TRANSIENT_EXIT_CODES 常量。
```

---

> 本文件随代码演进更新；发现新反模式请补充到第六节"基线审计"对应级别，并优先修 🔴。
