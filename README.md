# 云笺集 · CLOUDLETTER

个人内容工作台：Express + Prisma 后端（`/api/v2/*`，绞杀者模式）+ React 18 个人工作台 SPA + Markdown 内容真相源。

## 目录结构

```
cloudletter/
├─ server/           # 后端：Express 4 + Prisma 5 + tsx（端口 3011，/healthz + /api/v2/*）
├─ apps/workbench/   # 前端：React 18 + Vite + TS（端口 3015，/api 代理至 3011）
├─ tests/            # 测试统一目录
│  ├─ server/        #   后端单测（vitest，本地不入库；routes/ middleware/ 镜像源码目录）
│  ├─ workbench/     #   前端单测（vitest，本地不入库；components/ lib/ pages/ 镜像源码目录）
│  └─ e2e/           #   Playwright 端到端测试（独立工作区，入库）
├─ shared/           # 共享样式 theme.css
└─ docs/             # DESIGN-SPEC.md 设计规范 + memory/ 上下文记忆
```

## 单测布局约定

单测文件统一放在根 `tests/` 目录（**本地目录，已加入 .gitignore 不随仓库分发**），**按被测源码所在文件夹分组镜像**：

- `tests/server/routes/posts-routes.test.ts` ↔ `server/src/routes/posts-routes.ts`
- `tests/server/middleware/validate.test.ts` ↔ `server/src/middleware/validate.ts`
- `tests/workbench/lib/date.test.ts` ↔ `apps/workbench/src/lib/date.ts`

测试文件通过 `@server/*`、`@workbench/*` 路径别名回指各包源码（别名在两包的 `vitest.config.ts` 与 `tsconfig.json` 中同步维护）。

## 常用命令

```bash
pnpm -C server dev                 # 后端开发服务器（:3011）
pnpm -C apps/workbench dev         # 前端开发服务器（:3015）
pnpm -C server test                # 后端单测（vitest run）
pnpm -C apps/workbench test        # 前端单测（vitest run）
pnpm -C server typecheck           # 后端类型检查
pnpm -C apps/workbench typecheck   # 前端类型检查
pnpm -C apps/workbench build       # 前端生产构建
pnpm -C tests/e2e test             # 端到端测试（Playwright，独立端口 4011/4015）
pnpm -C tests/e2e test:headed      # 端到端测试（有头浏览器）
```

## 变更记录

- 2026-09-05（三）：恢复被误删的 `e2e/tests` UI 端到端测试，并将整个 `e2e/` 工作区迁移至 `tests/e2e/`（`git mv` 保留历史），修正其内部相对路径（playwright.config 的 cwd 与内容目录、global-setup 的 serverDir、eslint 共享配置引用）；`.gitignore` 改为 `tests/*` + 例外 `!tests/e2e/`（单测仍本地不入库，端到端工作区入库）。
- 2026-09-05（二）：仓库边界重划——`tests/` 转为本地目录不入库（.gitignore 忽略，已提交的测试文件自版本控制移除，本地文件保留、vitest 照常运行）；`docs/`（设计规范 + 上下文记忆）重新纳入版本控制；`.gitignore` 重写分区整理。另：前条记录中"25 个测试文件"应为 23 个（server 14 + workbench 9），已更正。
- 2026-09-05：散落在 `server/src` 与 `apps/workbench/src` 的 23 个单测文件统一迁移至根 `tests/` 目录，按 `server/`（routes、middleware 镜像源码子目录）与 `workbench/`（components、lib、pages）分组；导入路径改用 `@server/*`、`@workbench/*` 别名，两包 vitest include 与 tsconfig paths/include 同步更新。迁移后 170 个用例全部通过（server 120 + workbench 50），typecheck 无回归。
