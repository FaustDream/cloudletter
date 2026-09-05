# 云笺集 · 详细设计规范文档

> 配套：`docs/ARCHITECTURE.md`（架构方案）、`docs/DESIGN-REPORT.md`（设计报告）
> 强制等级说明：`🔴 强制`（违反即阻断合并）｜`🟡 应守`（缺则挂 issue）｜`💭 建议`（一致性优化）
> 命名 / 约束与 `docs/CODE_REVIEW.md` 第四节"通用 + 分模块清单"保持一致，本文件为其**结构化总集**。

---

## 1. 命名规范（Naming）

### 1.1 文件 / 文件夹
| 对象 | 命名 | 示例 | 等级 |
|------|------|------|------|
| 后端模块 / 工具文件 | `kebab-case.ts` | `rate-limit.ts`、`serializer.ts` | 🔴 |
| React 组件文件 | `PascalCase.tsx` | `WritingSpace.tsx`、`FolderTree.tsx` | 🔴 |
| 前端非组件模块 | `camelCase.ts` / `kebab-case.ts` | `api.ts`、`paste-detect.ts` | 🟡 |
| 单测文件 | 根 `tests/` 下按包与源码文件夹镜像 `*.test.ts` | `tests/server/routes/posts-routes.test.ts`、`tests/workbench/lib/date.test.ts` | 🔴 |
| 文件夹（包内） | `kebab-case` | `services/`、`components/`、`editor/` | 🔴 |
| 路由 / API 端点 | 小写 `-` 或资源复数名词 | `/auth/login`、`/posts`、`/settings` | 🔴 |
| 环境变量 | `UPPER_SNAKE` | `PORT`、`ADMIN_PASSWORD`、`UMAMI_WEBSITE_ID` | 🟡 |

### 1.2 代码标识符
| 对象 | 命名 | 示例 |
|------|------|------|
| 函数 / 方法 | `camelCase`，**动词开头** | `createSession`、`writePostFile`、`triggerBuild` |
| 变量 | `camelCase` | `tempToken`、`buildJobs` |
| 常量 | `UPPER_SNAKE` | `WINDOWS_TRANSIENT_EXIT_CODES`、`MAX_JOBS` |
| 类型 / 接口 / 类 | `PascalCase` | `Post`、`ApiError`、`Block` |
| 枚举值 | `UPPER_SNAKE`（或 Pascal 联合） | `admin/editor/author/viewer` |
| 布尔 | **`is/has/can` 前缀** | `isPublished`、`hasChildren`、`canEdit` |
| React 组件 | `PascalCase` | `RevisionPanel`、`VisualEditor` |

### 1.3 分支 / 提交 / PR
- 分支：`feature/xxx`、`fix/xxx`（语义前缀）；一个 PR 一个关注点，规模建议 **< ~400 行**。🔴
- 提交：清晰说明"做什么 + 为什么"，关联 issue / 规格章节（如 `§6.2`）。🟡
- PR：必填 `PULL_REQUEST_TEMPLATE.md`（改动摘要 / 影响范围 / 测试 / 自审清单 / 风险）。🔴

---

## 2. 目录结构规划（Directory Layout）

### 2.1 顶层（仓库根）
```
cloudletter/
├─ server/            # 后端服务（完全权限）
├─ apps/
│  └─ workbench/     # 个人工作台 SPA（React 18 + Vite，dev 端口 3015）
├─ e2e/              # 已迁至 tests/e2e/（见 §2.4）
├─ tests/            # 测试统一目录：server/ workbench/ 单测镜像源码目录（本地维护不入库）；e2e/ 端到端工作区入库
├─ fuwari-blog/      # 第三方 Astro 模板（限定权限）
├─ docs/             # 规范 / 计划 / 报告（完全权限）
├─ .github/          # ci.yml / deploy.yml / PR 模板
├─ eslint.config.js   # 共享扁平配置（各包 re-export）
├─ .prettierrc / .editorconfig / CODEOWNERS / .gitignore
```

### 2.2 `server/`（后端）
```
server/
├─ src/
│  ├─ index.ts            # 入口：安全头、/healthz、挂载 v2、错误包络、优雅退出
│  ├─ prisma.ts           # Prisma client 单例
│  ├─ crypto.ts           # scrypt + TOTP(RFC6238)
│  ├─ seed.ts             # 种子（须 ADMIN_PASSWORD ≥8 且非弱口令）
│  ├─ middleware/         # auth.ts（requireAuth）、validate.ts（自研入参校验层）
│  ├─ guestAuth.ts        # 访客只读授权：requireGuest + requireScope 范围闸门
│  ├─ routes/             # index.ts 导出 api Router，按域拆分各子路由并聚合挂载 /api/v2
│  └─ services/           # audit / backup / build / sync（序列化契约由前端持有，见 §2.3）
├─ prisma/                # schema.prisma + migrations；data/（SQLite 运行时，相对 schema 解析）
├─ scripts/ deploy/       # 运维脚本
```

> 数据目录：`DATABASE_URL=file:./data/xxx.db` 由 Prisma 相对 `schema.prisma` 所在目录解析，故 SQLite 实际落于 `server/prisma/data/`（非 `server/data/`）。此为 Prisma 既定行为，部署脚本与 E2E 均依赖此路径；如需迁移到 `server/data/` 需同步改动 .env 与脚本（低优先级，部署时统一）。

> 序列化契约（Markdown ↔ Block[]）为**内容格式契约**，由前端 `apps/workbench/src/lib/`（Markdown/序列化工具）承载（编辑 + 预览），服务端以 `rawMarkdown` 原样落盘。禁止在 `server/` 重复实现导致双源漂移（已清理历史死代码）。

### 2.3 `apps/workbench/`（前端 SPA）
```
apps/workbench/
├─ src/
│  ├─ main.tsx / App.tsx  # 入口 + 路由
│  ├─ api.ts              # API 客户端（错误包络解析）
│  ├─ auth.tsx            # 认证上下文（Bearer 持久化）
│  ├─ components/         # PascalCase 组件，按领域分子目录（framework/ editor/ timeline/ battle/ settings/）
│  ├─ pages/              # PascalCase 页面（*Page.tsx）
│  ├─ lib/                # camelCase 工具（date / pomodoro / guestApi ...，单测见根 tests/workbench/）
│  └─ i18n/ styles
├─ index.html · vite.config.ts · tsconfig.json · eslint.config.js
```

### 2.4 `tests/e2e/`
```
tests/e2e/
├─ tests/*.spec.ts        # workbench / editor 分文件（覆盖主链路与编辑器）
├─ content/               # 测试用 content 快照（_settings / note / posts）
├─ playwright.config.ts · global-setup.ts
```
规则：测试独立可重复、不依赖固定时间、共享 `e2e-test.db`；只用 `getByRole`/`getByText` 稳定选择器。

---

## 3. 编码与类型约束（Code & Type）

### 3.0 格式化基线（Prettier + EditorConfig）
- 无分号（`semi: false`）、单引号（`singleQuote: true`）、行宽 100（`printWidth: 100`）、2 空格缩进、箭头函数始终带括号（`arrowParens: always`）、尾逗号 `all`。🔴
- 文件 UTF-8、LF 换行、末尾留空行、去行尾空格（`.md`/`.yml` 例外）。🔴
- 提交前确保 `typecheck` 与 `lint` 通过（根共享 `eslint.config.js`，各包 re-export 后 `eslint .`；server 另含 `format` 走 prettier）。🔴

- **TypeScript 严格优先**：避免 `any`（`@typescript-eslint/no-explicit-any: warn`）；避免 `as any` 与 `req.user!` 非空断言（`no-non-null-assertion: warn`），优先显式守卫。🔴 关键路径禁用 any。
- **全等**：`eqeqeq: ['warn','smart']`（允许 `== null`）。🟡
- **常量**：`prefer-const: error`；禁止重复 import（`no-duplicate-imports: error`）。🔴
- **日志**：`no-console: ['warn', { allow: ['warn','error'] }]`；请求主链路禁 `console.log` 调试，用 `audit()`。🔴
- **React**：`react-hooks/rules-of-hooks: error`、`exhaustive-deps: warn`；`useEffect` 依赖完整、清理订阅/定时器；列表用稳定 `key` 与虚拟化。🟡
- **类型共享**：前后端共享契约以 `src/api.ts` 中的 TS 类型表达；序列化器改动须补"往返语义等价"测试。🔴
- **未使用标识**：未使用参数/变量以 `_` 前缀命名（`no-unused-vars: warn` 忽略 `_` 开头），避免误用裸未使用变量。🟡
- **前端模块**：启用 `isolatedModules` + `allowImportingTsExtensions`；类型导入用 `import type`，避免跨模块类型循环依赖。🟡

---

## 4. API 设计规范（API Contract）

- **风格**：REST，基址 `/api/v2`；统一错误包络 `{ error: { code, message, details } }`。🔴
- **状态码**：见 `ARCHITECTURE.md` §5 错误码表（401/403/422/409/404/500）。🔴
- **双鉴权体系**：管理员写接口走 `requireAuth`（server/src/auth.ts，单管理员 session）；访客只读接口走 `requireGuest` + `requireScope(scope)` 范围闸门（server/src/guestAuth.ts，未授权模块 403）。改鉴权须同时评估两者。🔴
- **端点清单**：实际挂载见 `server/src/routes/index.ts`（`/auth /posts /categories /tags /settings /search /workbench /uploads /battle /grants /guest /security /activity /integrations /feeds`，公开 `GET /rss.xml`）。🔴
- **输入校验**：用自研轻量校验层 `validateBody` / `requireValid`（`server/src/middleware/validate.ts`，`v.str()/v.num()/v.arr()/v.obj()` 声明式字段），**非 zod**（受环境依赖冲突影响）；统一返回 422 `VALIDATION` 包络。`PUT /settings` 仅允许已知分组（未知分组 422）。🔴
- **乐观锁**：并发写 `Post`/`Folder` 用 `updatedAt` 入 `where`，命中 0 行 → 409。🔴
- **安全响应**：不泄漏堆栈/SQL；错误统一走包络。🔴
- **分页 / 列表**：大结果集显式分页参数，避免一次性返回全量。🟡

---

## 5. 前端设计规范（Frontend）

- **SPA 子路径**：当前单体前端 `apps/workbench`（dev 端口 3015）；`BrowserRouter basename` 与实际部署 / nginx 反代路径对齐一致。🔴
- **三态**：所有 `fetch`/异步调用具备 loading / error / empty；错误文案对用户友好（中文）。🔴
- **性能预算**：重依赖（CodeMirror/BlockNote/three）**懒加载分包**；首屏 JS 受控，基线以实际构建产物为准。🟡
- **密钥**：不写死密钥/内部地址；配置走环境变量或后端下发。🔴
- **可访问性**：交互元素用语义角色；命令面板/模态支持键盘导航（↑↓/Enter/Esc）。🟡

---

## 6. 持久化与序列化规范（Persistence & Serialization）

- **唯一写方**：仅 `server` 进程写 SQLite 与 `src/content/*.md`。🔴
- **真相源**：`Post(DB) ↔ src/content/{posts,note}/*.md`；frontmatter 用 YAML 库序列化（非字符串拼接）。🔴
- **防路径穿越**：写文件只用 `slugify`（剥离 `\ / : * ? " < > | # ^ [ ]`）后的 slug 拼路径。🔴
- **序列化契约**：Markdown ↔ `Block[]` 双向无损；5 类富块（api/params/callout/wikilink/code）+ frontmatter 保留 + 未知围栏降级；改动须补往返测试（CRLF/空 lang 围栏/frontmatter/未知围栏降级）。🔴
- **构建队列**：串行、失败保留上一版产物；`jobs` Map 设上限（MAX_JOBS=100）并 LRU 淘汰，状态可恢复。🟡
- **备份 / 回滚**：`VACUUM INTO` 在线备份、滚动 7 份、每日 03:00；回滚前自动安全快照。🔴

---

## 7. 安全规范（Security）

- **认证（当前现实）**：单管理员本地 session，Bearer Token，30 分钟无操作过期、活动即续期；会话仅存哈希（`hashToken`）防 DB 泄露冒用；新口令长度/复杂度在 `seed` 拦截弱口令。🔴
  > ⚠️ 早期 RBAC 四级 / TOTP(±1) / 2FA / 临时 token / 内存限流 / 审计**已移除**（见 `server/src/auth.ts` 顶部注释）。恢复前本条不考核这些项。
- **限流**：原 IP + 账户双维度限流已移除，当前依赖会话 TTL 与 DB 唯一约束；如需限流须新增 `middleware`（🟡，非当前强制）。🔴
- **输入**：任意 `req.body/query/params` 校验后才进 DB / shell / 路径。🔴
- **纵深**：`x-powered-by` 关闭 + 手写安全头（nosniff/DENY/no-referrer/XSS）；跨域需显式 CORS 白名单。🟡
- **密钥管理**：`.env` 不入库（`.env.example` 提供模板）；生产弱口令（`seed` 默认）部署即升级为 Blocker。🔴

---

## 8. 质量门禁与验证规范（Quality Gate）

- **合并门槛（DoD）**：CI 全绿（typecheck ✅ / test ✅ / lint ✅ / build ✅）+ PR 模板已填 + 无未解决 🔴 + 关键路径有测试 + 至少一审批。🔴
- **CI（`ci.yml`）**：对 `master` 的 PR，各包并行 `install→db:generate(server)→typecheck→test→装 lint→lint→build(前端)`；E2E 仅 typecheck+lint（浏览器运行按需/定时，不阻塞普通 PR）。🔴
- **严重级别**：🔴 Blocker（安全/数据损坏/宕机/破契约/缺关键错误处理，必须改）｜🟡 Suggestion（校验/并发/性能/可维护性，应改或挂 issue）｜💭 Nit（命名/一致性，可选）。🔴
- **测试要求**：涉及 API 契约、序列化、鉴权/权限、存储落盘的改动**必须带测试**。🔴

---

## 9. 视觉 / UX 设计规范（Visual & UX）

> 既有的项目视觉基线（来自 `USER.md` 与 `fuwari-blog` 实现），作为前端与展示层设计约束。

- **整体调性**：温暖、低饱和的奶油色（cream）视觉风格；公开站点以 R3F/GLSL 星云背景营造科技感（仅 display 区，read 区安静）。💭
- **玻璃拟态**：命令面板 / 悬停预览 / 模态采用 `backdrop-blur` 玻璃浮层（与现有 ⌘K 浮层一致）。💭 注意：玻璃模糊只作用于**浮层本体**，不得作用于浮层背后的页面（见下条）。
- **浮层遮罩（硬性约束）**：功能弹窗 / 抽屉 / 悬浮面板**一律不使用视觉背景遮罩**——不做整页变暗、不给背后页面加 backdrop 模糊，避免"弹窗一出、全页失衡"。需要「点击外部关闭」时，用**透明捕获层**实现（`.overlay`、`.drawer-mask`、`.rev-mask` 等仅作为 fixed 透明命中层，配合 Esc 与关闭按钮兜底）。例外（允许全屏沉浸遮罩）：图片灯箱 `.md-lightbox`、升级庆祝 `.lvup-overlay`、3D 专注模式 `.uni3d.full`。新增浮层组件必须遵守本条，评审时按此检查。🟠
- **动效门控**：所有重特效（星云、曲速过场、轨道导航、相机穿行）须 `effect-zone` 分区挂载 + `prefers-reduced-motion` 双门控，低性能设备降级（DPR≤1.5 / antialias off / low-power）。🟡
- **主题系统**：前端主题 CSS 变量以 `shared/theme.css` 为**唯一真相源**，组件内禁止硬编码主题色；明/暗主题经设置下发，强调色经设置台可配。🔴
- **代码块**：程序员风 IDE 外壳（窗口点 + 文件名 + 语言徽章、行高亮/折叠、diff 三色、终端 `$` 分色、连字字体）。💭

---

## 10. 文件 / 文件夹覆盖矩阵（Coverage Matrix）

> 本方案对以下**全部路径**具备设计权限。L=完全权限 / S=限定权限 / X=排除。

| 路径 | 类型 | 门禁 | Lint 规则集 | 构建/测试 | 设计权限 | Owner |
|------|------|------|------------|-----------|----------|-------|
| `server/` | 后端包 | ✅ | 共享+node | typecheck/test/lint/build | **L** | @Lynn |
| `apps/write/` | 前端包 | ✅ | 共享+react | typecheck/test/lint/build | **L** | @Lynn |
| `apps/console/` | 前端包 | ✅ | 共享+react | typecheck/test/lint/build | **L** | @Lynn |
| `tests/e2e/` | 测试包 | ✅(typecheck+lint) | 共享 | E2E 按需/定时 | **L** | @Lynn |
| `docs/` | 文档 | ✅(doc) | — | — | **L** | @Lynn |
| `.github/` | CI/部署 | ✅ | — | 触发门禁/发布 | **L** | @Lynn |
| 根配置（eslint/.prettierrc/.editorconfig/CODEOWNERS） | 配置 | ✅ | — | 被各包引用 | **L** | @Lynn |
| `fuwari-blog/` | 第三方模板 | ❌ | 不纳入 | Astro 自有构建 | **S**（仅定向改动边界） | @Lynn |
| `node_modules/`、`dist/`、`.workbuddy/`、`*.db` | 产物/数据 | ❌ | — | 忽略 | **X** | — |

**权限说明**：
- **L（完全）**：可新增 / 修改 / 删除文件与目录，须遵守本规范第 1–9 节与 `CODE_REVIEW.md` 清单。
- **S（限定）**：仅允许"不破坏 Astro 构建管线 / effect-zone 分区 / nginx 反代路径"的定向改动；不纳入本仓库 Lint/单测门禁，不评审其内部实现。
- **X（排除）**：运行时/缓存/项目数据，不受设计正文约束，仅受 `.gitignore` 与构建规则约束。
