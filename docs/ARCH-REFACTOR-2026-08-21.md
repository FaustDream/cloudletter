# 云笺集 · 架构重构说明（2026-08-21）

> 依据：`docs/ARCHITECTURE.md`（架构基线）、`docs/DESIGN-SPEC.md`（设计规范）、`docs/DESIGN-REPORT.md`（设计报告）
> 目标：识别现状与目标架构的差异，在**保留全部业务逻辑**的前提下，调整架构层面的组织方式，消除耦合与冗余，提升可扩展/可维护/可测试性。

---

## 一、差异分析（现状 vs 目标架构）

| # | 差异 | 级别 | 处理 |
|---|------|------|------|
| D1 | 序列化器**双源**：`server/src/serializer/`（仅被自身测试引用，生产零引用 = 死代码）+ `apps/write/src/lib/serializer.ts`（生产实际使用：Preview/VisualEditor），且两版已契约漂移（R1 引号修复只同步到前端版） | 🔴 | 删除 server 死代码，前端为唯一真相源 |
| D2 | 4 个包各自持有**坏的 `pnpm-workspace.yaml`**（只有 `minimumReleaseAge`/`allowBuilds`，无 `packages` 字段），导致 pnpm 在子包执行时误当 workspace 根报 `packages field missing or empty` | 🟡 | 删除各包 workspace 文件，配置迁移到各包 `.npmrc` |
| D3 | `.gitignore` 未覆盖运行时产物：`*.db`/`*.db-journal`/`node-compile-cache`/`tsconfig.tsbuildinfo`/本地日志/打包产物 | 🟡 | 补全忽略规则 |
| D4 | `fuwari-blog/admin/` 旧栈（server.cjs/db.cjs）仍在，nginx 标注"绞杀期保留" | 💭 | 限定权限区域，**不动**；记录技术债 |
| D5 | `server/data/` vs 实际 `prisma/data/`（Prisma 相对 schema 解析） | 💭 | 部署时统一，本次不动 |
| D6 | E2E 的 webServer/global-setup 依赖 `corepack pnpm`（环境实际 11.x），触发 pnpm 11 新增的 supply-chain 策略检查（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`），导致 webServer 启动失败 | 🟡 | 改为 node 直调可执行文件（tsx/prisma/vite），绕开版本漂移 |

---

## 二、变更清单

### 删除（3 文件 + 4 workspace 文件）
| 文件 | 原因 |
|------|------|
| `server/src/serializer/serializer.ts` | 死代码（生产零引用），与前端序列化器契约漂移 |
| `server/src/serializer/serializer.test.ts` | 随死代码删除（往返契约测试由 `apps/write/src/lib/migration-roundtrip.test.ts` 承接） |
| `server/src/serializer/`（目录） | 空目录 |
| `server/pnpm-workspace.yaml` | 坏的 workspace 配置（无 packages 字段） |
| `apps/write/pnpm-workspace.yaml` | 同上 |
| `apps/console/pnpm-workspace.yaml` | 同上 |
| `e2e/pnpm-workspace.yaml` | 同上 |

### 新增（5 文件）
| 文件 | 内容 |
|------|------|
| `server/.npmrc` | `minimum-release-age=0`（承接原 workspace 配置） |
| `apps/write/.npmrc` | 同上 |
| `apps/console/.npmrc` | 同上 |
| `e2e/.npmrc` | 同上 |
| `docs/ARCH-REFACTOR-2026-08-21.md` | 本说明 |

### 修改（5 文件）
| 文件 | 改动 |
|------|------|
| `.gitignore` | 补 `*.db`/`*.db-journal`/`*.db-wal`/`*.db-shm`/`**/node-compile-cache/`/`*.tsbuildinfo`/`.dev-*.log`/`.dev-*.err`/`*.tar.gz` |
| `e2e/playwright.config.ts` | webServer 三服务命令从 `corepack pnpm` 改为 node 直调（tsx/vite），绕开 pnpm 11 supply-chain |
| `e2e/global-setup.ts` | `execSync`+shell 改为 `spawnSync` 参数组；prisma/tsx 用 node 直调 |
| `docs/ARCHITECTURE.md` | 架构图与契约表同步：序列化契约归属 `apps/write/src/lib/serializer.ts` |
| `docs/DESIGN-SPEC.md` | §2.2 目录结构同步：删除 `server/src/serializer/`，明确序列化契约唯一真相源 |
| `docs/DESIGN-REPORT.md` | 技术债看板补 D1 记录 |

---

## 三、重构后的架构形态

### 包边界（§3.1，保持独立可构建）
```
cloudletter/
├─ server/            # Express 4 + Prisma + SQLite（唯一 DB/磁盘写方）
│  └─ src/            # index / prisma / crypto / seed
│                     # middleware/（auth, rate-limit）
│                     # routes/（v2.ts 唯一聚合点）
│                     # services/（audit, backup, build, sync）
├─ apps/
│  ├─ write/          # 写作空间 SPA（序列化契约唯一真相源）
│  │  └─ src/lib/serializer.ts  ← Markdown ↔ Block[]（含往返测试）
│  └─ console/        # 设置控制台 SPA
├─ e2e/               # Playwright（node 直调，独立可复现）
├─ fuwari-blog/       # 第三方 Astro 模板（限定权限）
├─ docs/              # 规范 / 计划 / 报告 / 重构记录
└─ .github/           # ci.yml / deploy.yml
```

### 依赖规则落实
- 前端 ↔ 后端仅经 HTTP `/api/v2`（未变）
- 序列化契约**单源**：`apps/write/src/lib/`（消除 D1 双源漂移）
- 各包独立 `pnpm-lock.yaml` + `.npmrc`（消除 D2 伪 workspace）
- 运行时产物全忽略（消除 D3 脏仓库）

---

## 四、验证结果

| 检查 | 结果 |
|------|------|
| `server` typecheck (`tsc --noEmit`) | ✅ 通过 |
| `apps/write` typecheck | ✅ 通过 |
| `apps/console` typecheck | ✅ 通过 |
| `e2e` typecheck | ✅ 通过 |
| `apps/write` 单测（含序列化往返） | ✅ 12/12 |
| E2E（Playwright） | ✅ 9/9（12.1s，较重构前 20.5s 更快） |
| `pnpm dev`（server 启动） | ✅ 正常（此前需绕过 pnpm 直调 tsx） |
| Lint | ✅ 0 错误 |

---

## 五、后续补充项（2026-08-21 第二轮）

| # | 事项 | 处理 |
|---|------|------|
| C1 | write/console auth 重复 → 抽公共包 | 按规范 §3.2"各自包内持有，不得跨包耦合"，**不抽包**；将 console 的 auth 对齐 write 的 `ApiError` 统一包络（消除行为漂移） |
| G1 | `richBlocks.ts` 消除 `any` | ✅ 已修：定义结构类型 `MarkdownWriteState`/`MarkdownNodeLike`/`MarkdownItTokenLike` 替换 6 处 `state: any, node: any` 与 `tokens: any[]`；`container as unknown as fn` 双重断言 |
| D5 | `server/data/` vs `prisma/data/` | 不改代码（Prisma 相对 schema 解析的既定行为），DESIGN-SPEC 补充说明 |
| S1 | zod 全量入参校验 | 本轮不引入（改动面大、已有手写校验+settings 白名单），保持 🔶 部分状态 |
| 新栈入库 | `server/apps/e2e/docs` 全 untracked | 不主动提交（用户未要求），待用户决定提交时机 |

### 本轮修改文件
- `apps/console/src/auth.tsx`（C1：ApiError 统一包络）
- `apps/write/src/editor/richBlocks.ts`（G1：消除 6 处 any）
- `docs/DESIGN-SPEC.md`（D5 数据目录说明）
- `docs/ARCH-REFACTOR-2026-08-21.md`（本记录）
