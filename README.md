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

- 2026-09-06（二）：导航重构 + 日常×计划联动 + 游戏开关。① 目标三件套升级为侧边栏独立菜单：新增 /goals（目标）/plan（计划）/checkin（习惯）独立路由页（旧聚合页 /goals-home 保留兼容），侧栏顺序调整为 云笺/灵感/文章/日常/计划/目标/习惯/检索/记账本/分类标签/设置，「灵感笔记」更名「灵感」。② 计划等级新增 P4·不紧急（服务端校验/掉落档位 game.ts/三处下拉同步）。③ 日常×计划联动：新增 FocusLog 表与 /workbench/focus CRUD；番茄钟可选定计划，完成写入专注执行记录（planId+计划名快照+分钟），时间轴新增「🍅 专注」节点类型（全视觉体系接入），日常页显示今日专注历史（次数/分钟/计划分布）；未选计划维持写灵感笔记。④ 编辑器"内容消失"服务器端路径再修：初版解析完成前 editable=false 门控（打字不再落空文档被 replace 冲掉）、外部值回灌解析失败保持现有内容不清空。⑤ 速记弹窗 margin:auto 安全居中 + 限高内滚 + 标题栏拖拽（位置记忆、双击复位居中）。⑥ 设置新增「游戏」子菜单：讨伐/经验升级开关（默认关闭），总览讨伐卡/升级庆祝/头像等级徽标/3D 宇宙 ⚔️ 入口按开关显隐。服务端单测 125/125、前端 98/98、双端 typecheck 与构建通过。部署：备份 `2026-09-06T04-35-54` → 上站（FocusLog 建表）→ healthz ok、公网哈希 index-CdlLa0el.js 一致、/plan /goals /checkin 均 200、focusLog 表可访问。
- 2026-09-06：文章编辑页画布全幅化 + 双链快捷创建。① 画布去边框卡片化：白纸（surface-solid 实底，不受去容器化影响）撑满左右两条边框线之间——左侧为应用侧栏边线（主区padding 置零 `.main:has(.ed-page)`），右侧为文档信息栏分隔线（`.ed-side` 加明显左边线），正文列居中限宽 920px；顶栏与常驻工具栏改为白底吸顶横带（底部分隔线），消除原卡片边框/圆角/阴影与横向溢出滚动条。② 双链快捷创建：工具栏「[[ ]]」与编辑区右键菜单（创建双链/识别双链/一键排版）共用 `docActions.ts`——有选区包成 `[[选区]]`，无选区插入 `[[` 触发符直接唤起文章补全（点选即完成）；e2e 补「键入 [[ 点选后无触发符残留」回归（实测 `前文[[标题]]` 干净插入）。部署教训再补两条并写入 DEPLOY.md：`NODE_ENV=production` 会让 pnpm 跳过 devDependencies（tsx/prisma 装不上，部署脚本安装步骤必须 `env -u NODE_ENV`）；并行会话 WIP 破坏构建时用 `git worktree` 干净检出（HEAD+本人改动）出包，不碰对方工作区。
- 2026-09-05（十）：五项反馈修复并已上站。① 灵感笔记去掉瀑布流布局（回归 卡片/列表/时间线/便利贴 四种）。② 修复笔记编辑"点击文字消失"：本地浏览器实测复现——双击选词触发序列化竞态，偶发上抛空串导致空文档回灌清空整篇正文且撤销无效；已在 BlockNoteEditor 加防线（文档仍有文字却序列化出空串时跳过本次同步），复测通过。③ 修复目标页详情弹窗不居中：内容超高的弹窗被 flex 居中裁掉顶部；Modal 改 createPortal 挂 body + overlay 纵向可滚 + margin:auto 安全居中。④ 目标三子页（长期目标/今日计划/习惯打卡）：新增/编辑/绑定全部从弹窗改为右侧抽屉（目标详情与编辑合一），各加 舒适/紧凑/分组 布局切换器（分组：目标按进度档、计划按 P0/P1/P2、习惯按今日已打/未打），偏好持久化。⑤ 全站去容器化·轻度融合：`.main` 作用域覆写 `--surface-card: transparent`/`--shadow-card: none`/极浅边框，卡片与玻璃背景融为一体、hover 浮现边界，实底浮层不受影响；基调写入 DESIGN-SPEC §9。部署验证：备份 `2026-09-05T08-03-36` → 上站 → healthz ok、公网哈希 index-YQ0mSPaR.js 一致、/goals-home 200。
- 2026-09-05（九）：文章编辑页第二批十项改进并已上站。① Slug 增加说明文案与悬停提示（URL 标识用途与命名建议）。② 摘要默认折叠为「＋ 摘要」按钮（有内容时自动展开），减少右栏占位。③ 分类改用与标签一致的 Notion 式下拉（可搜索/勾选/新建，`onCreateCategory` 落库）；确认：标签保存经服务端 `syncTags` upsert、分类经 POST /categories 落库，二者新建后都会同步到「分类标签」菜单。④ 「转为草稿」= 撤回发布（已发布→草稿，仅自己可见），按钮加悬停说明。⑤ 历史版本治理：自动保存改为 5s 静默防抖（连续编辑不落库）；服务端 `Revision.kind` 区分手动/自动，手动必留快照、自动距上次快照 2 分钟内不重复产生；历史列表显示「手动/自动」徽标。⑥ 工具栏扩至 25 项：新增文字/背景颜色面板、双链（选区包 [[ ]]）、识别双链（全文标题→双链，markdown 往返可撤销）、一键排版（序号行→标题自动出大纲）、插入链接/图片/表格/分隔线/代码块/提示框/嵌入网页。⑦ 保存按钮始终可点（内容未变时点击仅确认状态）。⑧ 修复封面不入库：编辑保存 now 携带 `cover` 写入 frontmatter（根因是 PUT 从未接收 cover，草稿里只有本机），列表卡片视图展示封面。⑨ 双链补强：工具栏选区包 [[ ]] 与「识别双链」一键扫描（长标题优先、排除自身/围栏/既有链接）。⑩ 「一键排版」自动把「第一章/一、/1、」等序号行转为标题并进大纲。配套：docTransforms 纯函数单测 10 例、服务端 cover/频控路由测试、e2e 更新（25 项工具栏/唯一标签名）。
- 2026-09-05（八）：四项体验改造并上站。① 移除 GitHub 功能（侧栏入口与应用内 iframe 抽屉删除——服务器无法直连 github.com，iframe 对无代理访客不可用）。② 灵感笔记详情/编辑合一：点卡片开 720px 右侧抽屉，标题/分类/标签/富文本正文内联直接编辑保存，删除二次编辑弹窗；`Drawer` 改 `createPortal` 挂 body，根治祖先 transform/filter 把 fixed 抽屉困在页面容器（"只有容器大小"）的几何问题。③ 笔记布局增至 5 种：新增 瀑布流（columns 多列不等高）与 便利贴（暖色纸片/胶带/轻微旋转/楷体标题，含暗色适配），页头新增即点即换切换器（`cl_note_style` 此前无任何 UI 写入入口），时间线彩条选择器随 data-mood→data-tags 修正。④ 侧边栏悬停抽屉动画顺滑化（0.26s + 更柔缓贝塞尔 + 透明度淡入淡出）。⑤ nginx 为 `/index.html` 增加 `no-cache`——此前浏览器可能缓存旧 SPA 包，导致"改动上线了用户看到的还是旧版"。部署验证：备份 `2026-09-05T07-14-28` → 上站 → healthz ok、公网哈希 index-BqF9TXzm.js 与本地一致、`Cache-Control: no-cache` 生效、/ /posts /organize 均 200。
- 2026-09-05（七）：内容组织与速记体系大改造。① 灵感笔记接入文章的分类/标签体系（后端 `NoteItem.categoryId` + `NoteTag` 中间表，旧 `type/mood/done/doneAt` 列移除，一次性迁移脚本 `server/scripts/migrate-notes-taxonomy.ts`：mood→正式标签、计划型速记→今日计划、无分类默认「灵感」）；新建笔记默认分类/标签=灵感，与文章共用增改；分类删除同时检查文章与笔记占用。② 分类标签页瘦身为 分类/标签/图谱（看板、洞察下线，设置页"分类标签看板"主题分组移除）；点分类/标签改为右侧滑出内容抽屉（`TaxonomyDrawer` + `lib/taxonomy` 过滤纯函数），混合列出该分类/标签下的文章与灵感笔记，条目直达（文章进编辑页、笔记深链 `/notes?focus=`）不再整页跳转。③ 速记弹窗（⚡ FAB 移至左下角）灵感=富文本(MarkdownEditor)+分类/标签，计划=标题+紧急度(P0/P1/P2)+完成时间+详情，直接进今日计划（PlanItem）；速记汇总页聚焦灵感；时间轴/访客页/快捷动作/日常页同步适配。④ 全站功能弹窗去除视觉背景遮罩（透明捕获层保留点击外关闭+Esc），沉浸式场景（图片灯箱/升级庆祝/3D 专注）除外，浮层规范写入 DESIGN-SPEC §9。前端单测新增 taxonomy 过滤 4 例（全量 88/88）、后端 123/123、构建通过。
- 2026-09-05（六）：建立部署体系并完成当日改动上站。新增 `docs/DEPLOY.md`（部署文档：生产架构总览、标准部署流程、数据库结构变更的「中间态 schema → 一次性迁移 → 终态 schema」三段法、验证清单、回滚、实战坑），`AGENTS.md` 新增「部署规范」一节（每次改动除 git 提交外必须部署上线，以服务器实际效果为准）。本次已执行部署：备份 `2026-09-05T06-13-55` → 灵感笔记分类标签迁移（5 条速记 mood→标签）→ 8 个提交上站（含编辑页九项优化与侧边栏/导览改动），公网入口 JS 哈希与本地构建一致，healthz 探活通过。
- 2026-09-05（五）：文章编辑页九项体验优化与 bug 修复。① 保存策略改为「本地为主」：顶栏新增手动「保存」按钮（脏状态可用，保留 Ctrl/⌘+S），自动保存遇乐观锁冲突自动以本地内容覆盖重试，仅会话内首次给一条非阻断轻提示，移除旧的「冲突横幅」；重开文章一律以服务器版本为主，本机较新未同步草稿仅给一次性轻提示（可恢复/放弃，超时未处理视为放弃并清理快照），不再反复弹出「服务器/本地不一致」。② 编辑态保持：SPA 内离开页面强制落库（冲突策略保证成功），重开仍是编辑页且内容最新。③ 布局重排：文档信息条自页面顶部移入右栏首节（可折叠，`cl_ed_meta` 记忆），画布与顶栏直接对齐、消除顶部左侧空白；封面标签修复重复显示（两处「封面」并为 fm-row 单标签）。④ 标签改为 Notion 式下拉多选（`TagMultiSelect`：已选 chip、搜索过滤、勾选/新建、↑↓/Enter/Esc 键盘支持，候选构建抽 `lib/tagOptions.ts` 纯函数）。⑤ 修复编辑器无法下滑：`.ed-blocknote` 由 `overflow: hidden` 改为滚动容器。⑥ 大纲识别放宽：`#标题`（无空格）、引用内标题（`> # x`）、ATX 收尾（`## 标题 ##`）均可识别；文章大标题进大纲首条；大纲项与大标题可点击跳转（按文本定位标题块 `scrollIntoView`）。⑦ 新增常驻格式工具栏 `EditorToolbar`（撤销/重做、H1-H3、加粗/斜体/下划线/删除线/行内代码、引用、三种列表，激活态跟随光标，吸附于编辑区顶部）。⑧ 双链修复：原实现依赖 BlockNote 0.54 已移除的私有字段 `_tiptapEditor` 导致点击 `[[标题]]` 从不弹窗，改用标准 DOM Selection 检测（`lib/wikilinkText.ts` 纯函数 + 200ms 防误关时序）；交互窗增强——显示目标是否存在、用法说明，「打开关联文章」可跳转。配套：纯函数单测 17 例新增/更新（savePolicy/tagOptions/wikilinkText/outline），e2e 新增 5 例（工具栏/右栏/滚动/大纲跳转、双链弹窗、冲突覆盖、重开服务器为主等），前端 84 例、后端 120 例、端到端 7 例全部通过。
- 2026-09-05（四）：侧边栏与「组织」页三项 UX 改进。① 侧边栏悬停展开重构为独立滑入抽屉：图标轨道常驻、全尺寸菜单作浮层仅动画 `transform`（合成器线程执行，零重排），替代原 `width` 逐帧重排——重页面（three/mermaid/BlockNote）下不再掉帧；另加 450ms 程序化关闭误触抑制、hover intent 120ms→80ms、`prefers-reduced-motion` 降级。② 能力导览条改为会话级弹出：新账户必弹、重新登录后首次进入弹一次（登录会话标记 `cl_login_epoch` 由 `api.setToken` 统一写入），提供「我知道了」（本会话）/「永不提示」/右上 ✕（本会话），页头新增「导览」入口可随时重看；旧 `cl_org_toured` 自动迁移为永不提示，设置页清偏好保留导览记录。③ 菜单「组织」更名「分类标签」（更贴合分类+标签+看板/图谱/洞察的实际功能），路由 `/organize` 与存储键不变；设置页布局主题分组同步更名「分类标签看板」。配套单测 `tests/workbench/lib/tour.test.ts`（本地不入库）11 例全绿。
- 2026-09-05（三）：恢复被误删的 `e2e/tests` UI 端到端测试，并将整个 `e2e/` 工作区迁移至 `tests/e2e/`（`git mv` 保留历史），修正其内部相对路径（playwright.config 的 cwd 与内容目录、global-setup 的 serverDir、eslint 共享配置引用）；`.gitignore` 改为 `tests/*` + 例外 `!tests/e2e/`（单测仍本地不入库，端到端工作区入库）。
- 2026-09-05（二）：仓库边界重划——`tests/` 转为本地目录不入库（.gitignore 忽略，已提交的测试文件自版本控制移除，本地文件保留、vitest 照常运行）；`docs/`（设计规范 + 上下文记忆）重新纳入版本控制；`.gitignore` 重写分区整理。另：前条记录中"25 个测试文件"应为 23 个（server 14 + workbench 9），已更正。
- 2026-09-05：散落在 `server/src` 与 `apps/workbench/src` 的 23 个单测文件统一迁移至根 `tests/` 目录，按 `server/`（routes、middleware 镜像源码子目录）与 `workbench/`（components、lib、pages）分组；导入路径改用 `@server/*`、`@workbench/*` 别名，两包 vitest include 与 tsconfig paths/include 同步更新。迁移后 170 个用例全部通过（server 120 + workbench 50），typecheck 无回归。
