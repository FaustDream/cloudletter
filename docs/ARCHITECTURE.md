# 云笺集 · 系统架构设计方案

> 文档性质：架构基线设计（Architecture Baseline）
> 适用对象：云笺集（Cloudletter）全仓库
> 制定依据：
> - `docs/CODE_REVIEW.md`（审查标准：严重级别、合并门槛、分模块清单、基线审计）
> - `docs/PLAN.md`（功能计划与 Phase 验收记录）
> - 现有代码快照（2026-08-21）：`server/`、`apps/`、`e2e/`、`fuwari-blog/`
> - `.github/workflows/ci.yml`、`deploy.yml`、`CODEOWNERS`、`eslint.config.js`、`.prettierrc`、`.editorconfig`
> 配套文档：`docs/DESIGN-SPEC.md`（设计规范）、`docs/DESIGN-REPORT.md`（设计报告）

---

## 0. 设计权限与覆盖声明

本方案对仓库内全部**源文件与目录**拥有完整设计权限与覆盖能力，覆盖矩阵见 `docs/DESIGN-SPEC.md` 第十节。要点：

- **完全权限（Full Authority）**：`server/`、`apps/write`、`apps/console`、`e2e/`、`docs/`、根级配置文件（`.editorconfig`、`.prettierrc`、`eslint.config.js`、`CODEOWNERS`、`.github/`）。
- **限定权限（Scoped Authority）**：`fuwari-blog/` 为第三方 Astro 模板，按"依赖"对待；本方案仅规范对其的**定向改动边界**（不得破坏 Astro 构建管线、effect-zone 分区、nginx 反代路径），不纳入本仓库 Lint / 单测门禁。
- **排除（Excluded）**：`node_modules/`、`dist/`、`.workbuddy/`（项目数据，非缓存）、`*.db`/`*.db-journal` 运行时产物。以上不受本设计正文约束，仅受构建/忽略规则约束。

---

## 1. 架构总览

云笺集采用**单仓多包（monorepo）+ 绞杀者模式（Strangler Fig）**的演进式架构：以新增的 `server/`（`/api/v2/*`）与两个 SPA（`apps/write`、`apps/console`）逐步接管旧有 `admin/` 与 `fuwari-blog` 后台能力，最终下线旧栈。

```
┌────────────────────────────────────────────────────────────────────┐
│                          客户端 / 浏览器                              │
│  ┌──────────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │ apps/write (SPA) │   │ apps/console(SPA)│   │ fuwari-blog     │  │
│  │ 写作空间 /dev/write│  │ 设置台 /dev/console│  │ Astro 静态前台  │  │
│  └────────┬─────────┘   └────────┬─────────┘   └────────┬────────┘  │
└───────────┼──────────────────────┼──────────────────────┼──────────┘
            │  HTTPS (BrowserRouter basename)              │
            ▼                      ▼                        ▼
┌────────────────────────────────────────────────────────────────────┐
│  nginx 反向代理（同源部署）                                          │
│   /dev/write/*  → SPA 静态      /dev/console/* → SPA 静态            │
│   /api/*        → cloudletter-server :3010   /  → fuwari-blog dist  │
└───────────────────────────────┬────────────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│  server/  Express 4 + Prisma + SQLite  （单 Node 服务，:3010）       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ 路由层 routes/v2.ts  · 中间件 auth / rate-limit              │  │
│  │ 领域服务 services/{auth,audit,backup,build,sync}           │  │
│  │ 持久化 prisma/ (SQLite)  · 种子 seed.ts                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│        │                                    │                        │
│        ▼                                    ▼                        │
│  ┌──────────────┐             ┌──────────────────────────┐          │
│  │ SQLite 数据  │             │ 磁盘唯一真相源            │          │
│  │ (User/Session│             │ src/content/{posts,note} │          │
│  │  /Post/Folder│             │ /*.md（落盘 + 触发构建） │          │
│  │  /Revision…) │             └──────────────────────────┘          │
│  └──────────────┘                                                    │
└────────────────────────────────────────────────────────────────────┘
            │ 构建队列（串行，失败保留上一版）
            ▼
┌────────────────────────────────────────────────────────────────────┐
│  fuwari-blog 静态构建（Astro → dist/，R3F/GLSL 星云、Pagefind、双链）│
└────────────────────────────────────────────────────────────────────┘

横切层（贯穿全部）：CI 门禁(ci.yml) · Lint(共享 eslint) · E2E(playwright) · 部署(deploy.yml)
```

---

## 2. 架构分层（8 层）

| # | 分层 | 承载包 / 文件 | 职责 | 对外契约 |
|---|------|--------------|------|----------|
| L1 | 客户端表现层 | `apps/write`、`apps/console` | 受登录保护的 SPA；源码/可视化/预览多模编辑、设置控制台 | REST `/api/v2` + 错误包络 |
| L2 | 静态站点层 | `fuwari-blog`（Astro） | 公开阅读前台；R3F/GLSL 特效、Pagefind 搜索、双链反链 | 构建产物 `dist/` |
| L3 | 网关 / 反代层 | `nginx` + `deploy.yml` 配置 | 路径路由、`/api/` 反代、TLS 终止、同源策略 | 路径契约 `/dev/write/`、`/dev/console/`、`/api/` |
| L4 | API / BFF 层 | `server/src/routes/v2.ts` | `Express` 路由、鉴权、RBAC、限流、输入校验、错误包络 | REST 契约（§6） |
| L5 | 领域服务层 | `server/src/services/*` | auth/audit/backup/build/sync/serializer 业务编排 | 模块内函数契约 |
| L6 | 持久化层 | `server/prisma/`（SQLite）+ `src/content/*.md` | 结构化数据（Prisma）+ 内容真相源（Markdown 文件） | Schema + 序列化契约 |
| L7 | 构建 / 发布层 | `services/build.ts` + Astro 构建 | 内容变更触发静态构建、队列化、状态可查 | Build 状态 API |
| L8 | 质量 / 运维层 | `ci.yml`、`e2e/`、`deploy.yml`、`systemd`、备份 cron | 门禁、E2E、部署、备份回滚、监控 | CI 状态 / healthz |

---

## 3. 模块边界与依赖规则

### 3.1 包边界（Package Boundary）
每个业务包为**独立可构建单元**，各自持有 `package.json`、`tsconfig.json`、`eslint.config.js`（re-export 根共享配置）、`pnpm-lock.yaml`：

- `server` — 后端服务（Node/Express/Prisma），唯一对 DB 有写权限的进程。
- `apps/write` — 写作空间 SPA（Vite + React）。
- `apps/console` — 设置控制台 SPA（Vite + React）。
- `e2e` — Playwright 端到端测试（独立运行，不随普通 PR 阻塞）。
- `fuwari-blog` — 第三方 Astro 模板（依赖态，限定权限）。

### 3.2 跨模块依赖规则（强制）
1. **前端 ↔ 后端只允许通过 HTTP `/api/v2` 通信**；禁止前端直接 import 后端源码或 Prisma client。
2. **`apps/write` 与 `apps/console` 互不直接依赖**；共享逻辑（如认证流、API 客户端）须抽取为各自包内 `src/api.ts` / `src/auth.tsx`，或通过 `server` 契约复用，不得跨包耦合。
3. **`server` 内部分层单向依赖**：`routes → services → prisma`；`routes` 不得越过 `services` 直写 DB（统一经 `services`/Prisma）。
4. **持久化唯一写方**：仅 `server` 进程写 SQLite 与 `src/content/*.md`；前端任何写操作须经 API。
5. **`fuwari-blog` 不反向依赖 `server` 源码**；其内容由 `services/sync` + Astro 构建产出，运行期只读 `dist/`。

### 3.3 被禁止的耦合
- ❌ 前端写死密钥 / 内部地址（配置走环境变量或后端下发）。
- ❌ 路由层裸 await 可能抛错的 DB 调用而不经 `catchAsync` 或 `try/catch`（Express 4 不会自动转发 rejected promise）。
- ❌ 任何未校验的 `req.body/query/params` 直接进 DB、拼 shell 或拼文件路径。
- ❌ 用原始用户输入拼文件路径（须 `slugify` 后拼路径，防路径穿越）。
- ❌ `server` 与 `apps` 共享同一 `node_modules` 或跨包相对 import。

---

## 4. 部署拓扑

- **触发**：`deploy.yml` 监听 `master` 推送 → 依次构建 `fuwari-blog` + `server`(tsx 直跑) + `apps/write` + `apps/console` → `scp` 至 `/srv/cloudletter` → `systemctl restart cloudletter-server` → `nginx -t && reload`。
- **运行**：单 Node 服务监听 `:3010`（可由 `PORT` 覆盖；`server` 经 systemd 单元 `cloudletter-server` 托管）；前端产物由 nginx 经 `/dev/write/`、`/dev/console/` 子路径提供（SPA 用 `BrowserRouter basename` 对齐）。
- **反代**：`/api/*` 仅经 `nginx` 暴露到后端；`/` 指向 `fuwari-blog` 静态站；同源部署下不设 CORS（跨域需显式白名单）。
- **探活**：`GET /healthz` 返回 `{ ok, uptime, time }`，供宕机探测；公开站点静态产物在后端宕机时仍可访问。

---

## 5. 跨模块契约（Cross-Cutting Contracts）

| 契约 | 规范 | 位置 |
|------|------|------|
| 错误包络 | `{ error: { code, message, details } }`，禁止泄漏堆栈/SQL | `routes/v2.ts`、`index.ts` |
| 错误码 | `AUTH_REQUIRED 401` / `FORBIDDEN 403` / `VALIDATION 422` / `CONFLICT 409` / `NOT_FOUND 404` / `BUILD_FAILED 500` | `routes/v2.ts` 头部注释 |
| 认证流 | scrypt 口令 + TOTP(RFC6238, ±1 窗口)；`login → 423 challenge + tempToken → verify-2fa → Bearer token` | `crypto.ts`、`middleware/auth.ts` |
| 会话 | Bearer，30min 空闲过期；`requireAuth` + 最小 `requireRole` | `middleware/auth.ts` |
| RBAC | 四级 `admin/editor/author/viewer` | `middleware/auth.ts` |
| 限流 | IP + 账户双维度，5min×5 失败锁 15min（login/verify-2fa/改密） | `middleware/rate-limit.ts` |
| 序列化 | Markdown ↔ `Block[]` 双向无损；覆盖 api/params/callout/wikilink/code 五类富块 + frontmatter 保留 + 未知围栏降级 | `apps/write/src/lib/serializer.ts`（唯一真相源） |
| 存储真相源 | `Post(DB) ↔ src/content/{posts,note}/*.md`；发布/更新自动写文件并触发构建 | `services/sync.ts` |
| 站点设置 | `SiteSetting` 按分组（外观/布局/内容/阅读/交互/系统）`PUT /settings` 浅合并，仅允许已知分组 | `routes/v2.ts` |
| 审计 | `audit()` 容错（失败不阻断业务） | `services/audit.ts` |

---

## 6. 数据模型（Prisma / SQLite）

`server/prisma/schema.prisma` 定义以下模型（单一写方为 `server` 进程）：

`User` · `Session` · `Post`（含 `frontmatter` JSON：category/tags/date/summary/cover）· `Folder`（物化路径）· `Category` · `Tag` · `PostTag`（`@@id([postId,tagId])`）· `Revision`（版本快照）· `Media` · `SiteSetting` · `AuditLog` · `Backup`。

设计约束：并发写同一资源（文章/文件夹）须用**乐观锁**（`updatedAt` 放入 Prisma `where`，命中 0 行即 409，消除 TOCTOU）；备份用 `VACUUM INTO` 在线备份、滚动保留 7 份、每日 03:00 定时、回滚前自动安全快照。

---

## 7. 关键流程

1. **登录 + 2FA**：`POST /auth/login` → 校验口令（timingSafeEqual）→ 开 2FA 则返回 `423 + tempToken` → `POST /auth/verify-2fa` → `createSession` 发 Bearer。失败受 `authLimiter` 限流。
2. **保存 → 同步 → 构建**：前端防抖自动保存 → `PUT /posts/:id`（乐观锁）→ `services/sync` 写 `src/content/*.md`（slugify 防穿越）→ `triggerBuild` 入串行队列 → Astro 构建（失败保留上一版）。
3. **备份 / 回滚**：`POST /backup` 在线备份；`POST /backup/:name/rollback` 回滚前自动快照 + WAL checkpoint + 覆盖，返回 `needRestart`。

---

## 8. 技术选型与版本基线

| 维度 | 选型 | 基线版本 | 约束 |
|------|------|----------|------|
| 运行时 | Node | 20（CI 固定） | 本地可用 22，部署以 20 为准 |
| 包管理 | pnpm | 9 | `--frozen-lockfile` 部署；`minimumReleaseAge:0` 本地放行 |
| 后端 | Express + Prisma + SQLite + tsx + vitest | Express 4.21 / Prisma 5.22 | 异步路由须 `catchAsync` 或升级 Express 5 |
| 前端 | React + Vite + TypeScript + react-router-dom | React 18.3 / Vite 5.4 / TS 5.7 | SPA 子路径 + BrowserRouter basename |
| 编辑器 | Tiptap 3 + CodeMirror 6（懒加载分包） | Tiptap 3.30 / CM 6 | 源码模式一等公民，共用 tiptap-markdown 契约 |
| 测试 | vitest（单测）/ Playwright（E2E） | vitest 2 / Playwright 1.62 | 单测 colocated `*.test.ts`；E2E 按需 |
| 质量 | ESLint 9 扁平配置（共享）+ Prettier | eslint 9 / ts-eslint 8 | 各包 re-export 根 `eslint.config.js` |
| 部署 | GitHub Actions + ssh/scp + systemd + nginx | — | `ci.yml` 门禁、`deploy.yml` 发布解耦 |

> 本方案随代码演进更新；新增分层 / 模块 / 契约须同步更新本文件与 `DESIGN-SPEC.md`、`DESIGN-REPORT.md`，并在 PR 描述关联对应章节（如 §3.2）。
