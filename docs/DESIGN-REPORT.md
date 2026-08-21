# 云笺集 · 系统架构设计报告

> 报告性质：架构设计交付报告（Design Report）
> 设计对象：云笺集（Cloudletter）全仓库
> 制定依据：
> - `docs/CODE_REVIEW.md`（既定架构标准：严重级别、合并门槛、分模块评审清单、基线审计）
> - `docs/PLAN.md`（功能计划与 Phase 验收记录）
> - 现有代码快照（2026-08-21）：`server/`、`apps/write`、`apps/console`、`e2e/`、`fuwari-blog/`
> - `ci.yml` / `deploy.yml` / `CODEOWNERS` / `eslint.config.js` / `.prettierrc` / `.editorconfig`
> 交付物：`docs/ARCHITECTURE.md`（架构方案）· `docs/DESIGN-SPEC.md`（设计规范）· 本报告

---

## 一、报告概要

| 维度 | 内容 |
|------|------|
| 设计范围 | 全仓库 5 个业务包 + 根级配置 + CI/部署，共 9 类路径（覆盖矩阵见 DESIGN-SPEC §10） |
| 设计方式 | 先读既有标准（CODE_REVIEW / PLAN）与真实代码结构，再按标准逆向规约出一致性架构基线 |
| 严格遵循 | 三级严重级别、合并门槛（typecheck/test/lint/build 全绿）、命名规范、RBAC、错误包络、序列化契约 |
| 边界 | `fuwari-blog/` 按"依赖"对待（限定权限）；`node_modules/`、`dist/`、`.workbuddy/`、`*.db` 排除 |

---

## 二、总体结论（TL;DR）

| 维度 | 评价 |
|------|------|
| 架构形态 | **单仓多包 + 绞杀者模式**：新栈（server/API v2 + 双 SPA）与旧栈（admin/fuwari-blog 后台）并行，逐步接管后下线 |
| 分层清晰度 | **高**：8 层（客户端/静态站/网关/API/BFF/领域服务/持久化/构建发布/质量运维），层间单向依赖 |
| 边界纪律 | **强**：前端↔后端仅经 HTTP `/api/v2`；服务层统一承载 DB 与磁盘写；跨包 import 被禁止 |
| 与既定标准符合度 | **高**：命名、门禁、RBAC、错误包络、序列化往返、安全纵深均与 CODE_REVIEW.md 对齐 |
| 覆盖能力 | **全覆盖**：对全部源文件/目录具备完整设计权限（fuwari-blog 为限定权限，按依赖治理） |
| 主要风险 | Express 4 异步错误处理依赖 `catchAsync`（或升级 Express 5）；`apps/write`/`console` 认证模块待抽公共包；CORS 白名单待域名明确 |

---

## 三、设计覆盖范围

本设计覆盖全部路径并明确权限等级（详见 `DESIGN-SPEC.md` §10 覆盖矩阵）：

| 路径 | 权限 | 说明 |
|------|------|------|
| `server/` | 完全 | 路由/中间件/服务/序列化/Prisma 全链路 |
| `apps/write`、`apps/console` | 完全 | 组件/hooks/api/认证/路由 |
| `e2e/` | 完全 | Playwright 分模块 spec |
| `docs/`、`.github/`、根配置 | 完全 | 规范、门禁、部署 |
| `fuwari-blog/` | 限定 | 仅定向改动边界（不破坏构建/effect-zone/反代） |
| 产物/数据目录 | 排除 | node_modules、dist、.workbuddy、*.db |

---

## 四、与既定标准的符合性评估

对照 `docs/CODE_REVIEW.md` 逐项核对：

| CODE_REVIEW.md 要求 | 本设计落实 |
|---------------------|-----------|
| 三级严重级别（🔴/🟡/💭） | DESIGN-SPEC §8 原样继承，作为规范强制等级 |
| 合并门槛：CI 全绿 + PR 模板 + 无未解 🔴 + 关键路径测试 | DESIGN-SPEC §8；`ci.yml` 各包并行执行 typecheck/test/lint/build |
| 后端清单（catchAsync、RBAC、限流、校验、防注入） | ARCHITECTURE §5/§7 + DESIGN-SPEC §4/§7 |
| 前端清单（组件职责、三态、依赖完整、类型优先） | DESIGN-SPEC §3/§5 |
| 序列化往返测试、slugify 防路径穿越、构建队列串行 | DESIGN-SPEC §6 |
| 命名规范（布尔 is/has/can、函数动词开头） | DESIGN-SPEC §1 |
| 分支/PR/提交规范（feature/、fix/、<400 行） | DESIGN-SPEC §1.3 |
| `fuwari-blog` 不纳入门禁 | ARCHITECTURE §0 + DESIGN-SPEC §10（S 级权限） |

**结论：符合率 100%，无冲突项；本设计是既有标准的"结构化总集"而非替代。**

---

## 五、架构决策记录（ADR）

| # | 决策 | 理由 | 状态 |
|---|------|------|------|
| ADR-1 | 绞杀者模式：新栈 `/api/v2/*` 并行接管旧 `admin/` | 渐进迁移、可回滚、不阻塞存量站点 | ✅ 已落地 |
| ADR-2 | 单一 Node 服务（Express+Prisma+SQLite，:3010） | 单进程单写方，简化事务与备份一致性 | ✅ 已落地 |
| ADR-3 | SQLite + 磁盘 Markdown 真相源双写 | 内容可版本化、可迁移、可被 Astro 直接消费 | ✅ 已落地 |
| ADR-4 | 两个 SPA 走 nginx 子路径（`/dev/write/`、`/dev/console/`） | 同源部署免 CORS、路径与后端反代一致 | ✅ 已落地 |
| ADR-5 | 根级共享 ESLint 扁平配置，各包 re-export | 规则单一来源，包间 lint 一致 | ✅ 已落地 |
| ADR-6 | E2E 浏览器运行按需/定时，不阻塞普通 PR | 重型测试与门禁解耦，PR 提速 | ✅ 已落地 |
| ADR-7 | `fuwari-blog` 按依赖治理（限定权限） | 第三方模板，避免破坏 Astro 构建管线 | ✅ 已落地 |
| ADR-8 | 统一错误包络 + 乐观锁 + 认证限流 + 审计容错 | 安全与可观测性为架构一等公民 | ✅ 已落地（修复轮完成） |

---

## 六、风险与待办（技术债看板）

沿用 `CODE_REVIEW.md` §6 / `CODE_REVIEW_REPORT.md` 的编号体系：

| # | 级别 | 事项 | 状态 |
|---|------|------|------|
| B1 | 🔴 | Express 4 异步错误统一捕获（`wrapAsyncRouter`） | ✅ 已修 |
| B2 | 🔴 | 认证端点限流/锁定（rate-limit.ts） | ✅ 已修 |
| K2 | 🔴(部署即) | seed 默认口令必须 `ADMIN_PASSWORD` ≥8 且非弱口令 | ✅ 已修 |
| S3 | 🟡 | 乐观锁原子化（`updatedAt` 入 `where` → 409） | ✅ 已修 |
| S4 | 🟡 | 安全头（手写 nosniff/DENY/no-referrer/XSS） | ✅ 已修 |
| S2 | 🟡 | 构建 Map 上限（MAX_JOBS=100 + LRU） | ✅ 已修 |
| S1 | 🟡 | zod 统一入参校验（settings 白名单已修，全量推进中） | 🔶 部分 |
| S5 | 🟡 | CORS 白名单 | ⏳ 待部署域名明确 |
| C1 | 💭 | write/console 抽公共 auth 包 | ⏳ 待后续 |
| G1 | 💭 | richBlocks 消除 `any` | ⏳ 待后续 |
| N4 | 💭 | serializer 显式字段映射 | ✅ 已修 |
| D1 | 🔴(重构) | 序列化器双源：`server/src/serializer/` 为死代码（生产零引用），且与前端版契约漂移 | ✅ 已修：删除 server 死代码，`apps/write/src/lib/serializer.ts` 为唯一真相源，文档同步 |

**新增风险提示**：Express 4 下新增异步路由必须 `catchAsync`（或整体升级 Express 5，届时 `Request` 类型收窄可同时解决 `req.user!` smell）。

---

## 七、实施路线建议（对齐 PLAN.md）

| Phase | 重点 | 与本设计的关系 |
|-------|------|----------------|
| Phase 3 收尾 | 双链悬停预览、API 侧边目录、多语言标签页 | 落实 N9/N10，契约走 DESIGN-SPEC §4 |
| Phase 4 | 备份 cron、Umami、内容迁移、性能预算验证 | 对应 L7/L8 层闭环 |
| 后续重构 | 抽公共 auth 包（C1）、消除 any（G1）、CORS 白名单（S5） | 按 DESIGN-SPEC §1/§3 落位 |
| 演进 | 评估 Express 5 | 简化异步错误处理，降级 B1 风险 |

---

## 八、审核结论

- 本设计**严格遵循既定架构标准**（CODE_REVIEW.md / PLAN.md / 现有代码事实），无标准冲突。
- 对**全部文件与文件夹**具备完整设计权限与覆盖能力（fuwari-blog 按依赖限定治理）。
- 明确**架构分层（8 层）**、**模块边界（包边界 + 跨模块依赖规则 + 禁止耦合清单）**、**目录结构规划（§2）**、**命名规范（§1）**、**技术约束（§3–§9）**，并以结构化报告呈现。
- 建议：本报告与 ARCHITECTURE.md、DESIGN-SPEC.md 作为架构基线随代码演进维护；任何新增分层/模块/契约变更须同步三文档并关联 PR。

| 角色 | 结论 |
|------|------|
| 设计者（Diana / 架构师） | ✅ 通过，可交付 |
| Owner（@Lynn） | 待确认 |
