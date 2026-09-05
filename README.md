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
└─ docs/             # DESIGN-SPEC.md 设计规范 + DEPLOY.md 部署文档 + memory/ 上下文记忆
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

- 2026-09-05（八）：四项体验改造并上站。① 移除 GitHub 功能（侧栏入口与应用内 iframe 抽屉删除——服务器无法直连 github.com，iframe 对无代理访客不可用）。② 灵感笔记详情/编辑合一：点卡片开 720px 右侧抽屉，标题/分类/标签/富文本正文内联直接编辑保存，删除二次编辑弹窗；`Drawer` 改 `createPortal` 挂 body，根治祖先 transform/filter 把 fixed 抽屉困在页面容器（"只有容器大小"）的几何问题。③ 笔记布局增至 5 种：新增 瀑布流（columns 多列不等高）与 便利贴（暖色纸片/胶带/轻微旋转/楷体标题，含暗色适配），页头新增即点即换切换器（`cl_note_style` 此前无任何 UI 写入入口），时间线彩条选择器随 data-mood→data-tags 修正。④ 侧边栏悬停抽屉动画顺滑化（0.26s + 更柔缓贝塞尔 + 透明度淡入淡出）。⑤ nginx 为 `/index.html` 增加 `no-cache`——此前浏览器可能缓存旧 SPA 包，导致"改动上线了用户看到的还是旧版"。部署验证：备份 `2026-09-05T07-14-28` → 上站 → healthz ok、公网哈希 index-BqF9TXzm.js 与本地一致、`Cache-Control: no-cache` 生效、/ /posts /organize 均 200。
- 2026-09-05（七）：内容组织与速记体系大改造。① 灵感笔记接入文章的分类/标签体系（后端 `NoteItem.categoryId` + `NoteTag` 中间表，旧 `type/mood/done/doneAt` 列移除，一次性迁移脚本 `server/scripts/migrate-notes-taxonomy.ts`：mood→正式标签、计划型速记→今日计划、无分类默认「灵感」）；新建笔记默认分类/标签=灵感，与文章共用增改；分类删除同时检查文章与笔记占用。② 分类标签页瘦身为 分类/标签/图谱（看板、洞察下线，设置页"分类标签看板"主题分组移除）；点分类/标签改为右侧滑出内容抽屉（`TaxonomyDrawer` + `lib/taxonomy` 过滤纯函数），混合列出该分类/标签下的文章与灵感笔记，条目直达（文章进编辑页、笔记深链 `/notes?focus=`）不再整页跳转。③ 速记弹窗（⚡ FAB 移至左下角）灵感=富文本(MarkdownEditor)+分类/标签，计划=标题+紧急度(P0/P1/P2)+完成时间+详情，直接进今日计划（PlanItem）；速记汇总页聚焦灵感；时间轴/访客页/快捷动作/日常页同步适配。④ 全站功能弹窗去除视觉背景遮罩（透明捕获层保留点击外关闭+Esc），沉浸式场景（图片灯箱/升级庆祝/3D 专注）除外，浮层规范写入 DESIGN-SPEC §9。前端单测新增 taxonomy 过滤 4 例（全量 88/88）、后端 123/123、构建通过。
- 2026-09-05（六）：建立部署体系并完成当日改动上站。新增 `docs/DEPLOY.md`（部署文档：生产架构总览、标准部署流程、数据库结构变更的「中间态 schema → 一次性迁移 → 终态 schema」三段法、验证清单、回滚、实战坑），`AGENTS.md` 新增「部署规范」一节（每次改动除 git 提交外必须部署上线，以服务器实际效果为准）。本次已执行部署：备份 `2026-09-05T06-13-55` → 灵感笔记分类标签迁移（5 条速记 mood→标签）→ 8 个提交上站（含编辑页九项优化与侧边栏/导览改动），公网入口 JS 哈希与本地构建一致，healthz 探活通过。
- 2026-09-05（五）：文章编辑页九项体验优化与 bug 修复。① 保存策略改为「本地为主」：顶栏新增手动「保存」按钮（脏状态可用，保留 Ctrl/⌘+S），自动保存遇乐观锁冲突自动以本地内容覆盖重试，仅会话内首次给一条非阻断轻提示，移除旧的「冲突横幅」；重开文章一律以服务器版本为主，本机较新未同步草稿仅给一次性轻提示（可恢复/放弃，超时未处理视为放弃并清理快照），不再反复弹出「服务器/本地不一致」。② 编辑态保持：SPA 内离开页面强制落库（冲突策略保证成功），重开仍是编辑页且内容最新。③ 布局重排：文档信息条自页面顶部移入右栏首节（可折叠，`cl_ed_meta` 记忆），画布与顶栏直接对齐、消除顶部左侧空白；封面标签修复重复显示（两处「封面」并为 fm-row 单标签）。④ 标签改为 Notion 式下拉多选（`TagMultiSelect`：已选 chip、搜索过滤、勾选/新建、↑↓/Enter/Esc 键盘支持，候选构建抽 `lib/tagOptions.ts` 纯函数）。⑤ 修复编辑器无法下滑：`.ed-blocknote` 由 `overflow: hidden` 改为滚动容器。⑥ 大纲识别放宽：`#标题`（无空格）、引用内标题（`> # x`）、ATX 收尾（`## 标题 ##`）均可识别；文章大标题进大纲首条；大纲项与大标题可点击跳转（按文本定位标题块 `scrollIntoView`）。⑦ 新增常驻格式工具栏 `EditorToolbar`（撤销/重做、H1-H3、加粗/斜体/下划线/删除线/行内代码、引用、三种列表，激活态跟随光标，吸附于编辑区顶部）。⑧ 双链修复：原实现依赖 BlockNote 0.54 已移除的私有字段 `_tiptapEditor` 导致点击 `[[标题]]` 从不弹窗，改用标准 DOM Selection 检测（`lib/wikilinkText.ts` 纯函数 + 200ms 防误关时序）；交互窗增强——显示目标是否存在、用法说明，「打开关联文章」可跳转。配套：纯函数单测 17 例新增/更新（savePolicy/tagOptions/wikilinkText/outline），e2e 新增 5 例（工具栏/右栏/滚动/大纲跳转、双链弹窗、冲突覆盖、重开服务器为主等），前端 84 例、后端 120 例、端到端 7 例全部通过。
- 2026-09-05（四）：侧边栏与「组织」页三项 UX 改进。① 侧边栏悬停展开重构为独立滑入抽屉：图标轨道常驻、全尺寸菜单作浮层仅动画 `transform`（合成器线程执行，零重排），替代原 `width` 逐帧重排——重页面（three/mermaid/BlockNote）下不再掉帧；另加 450ms 程序化关闭误触抑制、hover intent 120ms→80ms、`prefers-reduced-motion` 降级。② 能力导览条改为会话级弹出：新账户必弹、重新登录后首次进入弹一次（登录会话标记 `cl_login_epoch` 由 `api.setToken` 统一写入），提供「我知道了」（本会话）/「永不提示」/右上 ✕（本会话），页头新增「导览」入口可随时重看；旧 `cl_org_toured` 自动迁移为永不提示，设置页清偏好保留导览记录。③ 菜单「组织」更名「分类标签」（更贴合分类+标签+看板/图谱/洞察的实际功能），路由 `/organize` 与存储键不变；设置页布局主题分组同步更名「分类标签看板」。配套单测 `tests/workbench/lib/tour.test.ts`（本地不入库）11 例全绿。
- 2026-09-05（三）：恢复被误删的 `e2e/tests` UI 端到端测试，并将整个 `e2e/` 工作区迁移至 `tests/e2e/`（`git mv` 保留历史），修正其内部相对路径（playwright.config 的 cwd 与内容目录、global-setup 的 serverDir、eslint 共享配置引用）；`.gitignore` 改为 `tests/*` + 例外 `!tests/e2e/`（单测仍本地不入库，端到端工作区入库）。
- 2026-09-05（二）：仓库边界重划——`tests/` 转为本地目录不入库（.gitignore 忽略，已提交的测试文件自版本控制移除，本地文件保留、vitest 照常运行）；`docs/`（设计规范 + 上下文记忆）重新纳入版本控制；`.gitignore` 重写分区整理。另：前条记录中"25 个测试文件"应为 23 个（server 14 + workbench 9），已更正。
- 2026-09-05：散落在 `server/src` 与 `apps/workbench/src` 的 23 个单测文件统一迁移至根 `tests/` 目录，按 `server/`（routes、middleware 镜像源码子目录）与 `workbench/`（components、lib、pages）分组；导入路径改用 `@server/*`、`@workbench/*` 别名，两包 vitest include 与 tsconfig paths/include 同步更新。迁移后 170 个用例全部通过（server 120 + workbench 50），typecheck 无回归。
