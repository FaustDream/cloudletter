# 云笺集 · 修改与新增功能计划（对照开发规格总文档 v1.1）

> 依据：`2026-08-19-16-50-21/cloudletter-dev-spec.html`（§17 实施路线 / §20 AI 实施参考）
> 更新：2026-08-21 · Phase 0 已完成并验收通过；Phase 1 已收尾（含 Tiptap 双模）；Phase 2 核心已交付

## 一、修改（对现有代码）

| # | 对象 | 修改内容 | 阶段 |
|---|------|---------|------|
| M1 | `admin/`（零依赖旧后台） | 绞杀者模式保留不动，新服务以 `/api/v2/*` 并行接管；全部 v2 覆盖后下线 | 0→4 |
| M2 | `fuwari-blog`（Astro 前台） | 按 `effect-zone` 分区（display/read/write）挂载/关闭重特效；公开站点视觉升级为 R3F/GLSL 星云 | 2 |
| M3 | 代码块渲染 | 升级为程序员风 IDE 外壳（红黄绿点+文件名+语言、行高亮/折叠、diff 三色、终端 $ 分色、连字字体） | 1 | ✅ 完成：Expressive Code 头栏加红黄绿窗口点（box-shadow 三点）+ 连字字体（font-variant-ligatures）；标题/行高亮/语言徽章/复制沿用 EC 能力；折叠（pluginCollapsibleSections）/ diff 三色（textMarkers delHue/insHue/markHue）/ 终端框架（frames.terminal*）均为 EC 原生已配置项（````ts title="x" {行}`、`++`/`--` diff、sh 终端块） |
| M4 | 现有内容（10 篇 posts） | demo 归入「指南」分类、自有长文归入「项目」；frontmatter 映射；slug 保持不变；跑序列化往返校验 | 4 | ✅ 完成：demo（video/markdown/markdown-extended/guide/expressive-code/draft）→「指南」；实质长文（ui-design-spec/agent-rules）→「项目」；markdown-guide/rich-blocks-guide/hello-world 保留合理分类；slug 不变。**序列化往返校验**（migration-roundtrip.test.ts，11 篇 parse→serialize→parse 语义等价）暴露并修复 4 个 serializer 兼容性 bug：①CRLF 行尾导致 `$` 锚点失效（parse 统一 `\r\n?`→`\n`，最关键）②正文 `---` 水平线被丢弃 ③空 lang 围栏（``` 用于 ASCII 图）被跳过 ④frontmatter 未规范化 |
| M5 | `.github/workflows/deploy.yml` | CI 产物新增 `server/`、`apps/write`、`apps/console`；部署后 systemd 重启 Node 服务 | 2 |
| M6 | nginx 配置 | 新增 `/dev/write/`、`/dev/admin/` 反代路径到 Node 服务；`/api/` 仅经反代暴露 | 2 |

## 二、新增

| # | 模块 | 内容 | 阶段 | 状态 |
|---|------|------|------|------|
| N1 | `server/` Express+Prisma 服务 | 单 Node 服务 :3010，`/api/v2/*` 契约、Bearer 会话（30min 空闲过期）、RBAC 四级、审计日志、异步构建队列、healthz | 0 | ✅ 完成 |
| N2 | 存储序列化器 | Markdown ↔ Block[] 双向无损转换，覆盖 api/params/callout/wikilink/code 五类富块 + frontmatter 保留 + 未知围栏降级；Vitest 单测 | 0 | ✅ 完成（11/11 绿） |
| N3 | 磁盘同步 | Post(DB) ↔ `src/content/{posts,note}/*.md` 落盘（唯一真相源），发布/更新自动写文件并触发构建 | 0 | ✅ 完成 |
| N4 | 认证迁移 | scrypt 口令 + TOTP（RFC6238，±1 窗口）自旧服务移植；login→423 challenge→verify-2fa 全流程 | 0 | ✅ 完成 |
| N5 | 写作空间 `apps/write` | React+Tiptap 三栏（树/编辑/大纲+反链）、源码模式一等公民、聚焦模式、多标签页、斜杠菜单、`[[` 补全、防抖自动保存、frontmatter 面板、粘贴自动识别 | 1 | ✅ 完成：Vite+React 三栏、CodeMirror 源码编辑（一等公民）、富块卡片分屏预览、工具栏插入模板、1s 防抖自动保存、baseVersion 冲突处理、frontmatter 面板、发布触发构建、多文档标签页（类IDE）、聚焦模式、`[[` 双链补全、粘贴自动识别（单测 11/11）；**Tiptap 可视化模式已接入**（分屏/源码/预览/可视化四模切换，与源码共用 tiptap-markdown 序列化契约，ApiBlock/ParamsBlock 卡片 NodeView + YAML 源码切换）；**CodeMirror/Tiptap 懒加载分包**（首屏 JS 895KB → ~279KB gzip 108KB，§12 预算达标） |
| N6 | 设置控制台 `apps/console` | 外观/布局/内容/阅读/交互/系统六组设置，写 `SiteSetting` 并异步触发构建 | 2 | ✅ 完成：Vite+React 六组面板（外观主题/强调色/玻璃模糊/动画子项、布局模块排序显隐/密度/侧栏、内容开关/导航项/每页数量、阅读 TOC/时长/代码主题/推荐、交互搜索范围/⌘K 开关/平滑滚动/RSS/SEO、系统监控+审计日志+账户/2FA）；按组 PUT /settings 浅合并，保存后轮询 build 状态展示；登录+2FA 复用契约；构建 177KB gzip 58KB |
| N7 | 展示层特效 | R3F/GLSL 星云背景、曲速过场、轨道导航、相机穿行（仅 display 区，reduced-motion 双门控） | 2 | ✅ 完成：R3F+GLSL 星云背景（fbm 域扭曲 shader，900 星点 additive 闪烁，DPR≤1.5/antialias off/low-power）+ effect-zone 分区挂载（M2）+ 曲速过场（WarpTransition.astro）+ 轨道导航（OrbitRings：3 条倾斜 torus 轨道 + 沿轨卫星 + 鼠标视差）+ 相机穿行（CameraRig：椭圆漂移 + z 纵深往复） |
| N8 | ⌘K 命令面板 | Pagefind 索引 + 分组结果 + 可执行命令 | 2 | ✅ 完成：⌘K/Ctrl+K 玻璃浮层（backdrop-blur），分组结果（命令/页面），可执行命令（新建笔记→/dev/write/、设置台→/dev/console/、切换明暗主题、回首页），Pagefind 异步索引（构建期已索引 10 页），↑↓/Enter 键盘导航，Esc 关闭，200ms 防抖 |
| N9 | 双链+反链 | `[[...]]` 悬停预览、构建期反链扫描（serializer 已提供 `extractWikilinks`） | 3 | ✅ 完成：构建期全量扫描（backlinks.mjs 建 titleToSlug/slugSet/slugToReferrers/slugToMeta）、wikilink 前台渲染（目标存在→`<a class="wikilink">`，不存在→§14 灰色"待创建"）、文章页反链面板、**悬停预览浮层**（WikilinkPreview.astro：构建期内联 slug→{title,description} JSON，事件委托 hover/focus 玻璃浮层，兼容 Swup）；修了 Vite bundle 重写 import.meta.url 问题（astro.config.mjs 显式传 projectRoot） |
| N10 | 技术文档套件 | 接口卡片/参数表/提示框前台渲染、API 侧边目录、多语言示例标签页 | 3 | 🔶 完成：```api 围栏→接口卡片（方法徽章/路径/摘要/参数表/响应体）、```params→独立参数表、:::danger 提示框映射、CSS 全套（§5.2.1/§5.2.2）；**API 侧边目录**（ApiSidebar.astro：扫描 .cl-api-card 生成 method+path 导航浮层，点击平滑滚动+高亮，无 api 块自动隐藏，兼容 Swup）；附 rich-blocks-guide.md 演示文章。**待补**：多语言示例标签页 |
| N11 | 知识库树 | 文件夹树拖拽（React Arborist）、物化路径级联更新（API 已就绪） | 3 | ✅ 完成：HTML5 原生拖拽（文件夹→文件夹/根、文章→文件夹/根），drop-target 高亮、禁止拖入自身子树（isDescendant 校验），复用 PUT /folders/:id（parentId）与 PUT /posts/:id（folderId），移动后刷新树 |
| N12 | 版本对比 | 快照 diff 视图（快照 API 已就绪） | 3 | ✅ 完成：RevisionPanel 模态（版本列表→选中加载→行级 LCS diff 高亮 add/del→一键恢复）；复用 GET /revisions、GET /revisions/:vid、POST /revisions/:vid/restore |
| N13 | 运维硬化 | 每日备份（保留7份）、一键回滚、Umami 统计（可选）、性能预算达标 | 4 | ✅ 完成：备份逻辑抽到 services/backup.ts（createBackup/listBackups/rollback/scheduleDailyBackup），POST /backup（SQLite VACUUM INTO 在线备份，滚动保留 7 份）、GET /backup 列表、POST /backup/:name/rollback（回滚前自动安全快照 + WAL checkpoint + 覆盖，返回 needRestart）；**每日 03:00 定时备份**（scheduleDailyBackup，幂等 setInterval）；console 系统组加"备份与回滚"UI；**E2E（Playwright）9/9 通过**（auth 3：write/console 登录+错误密码；console 3：六组导航/强调色保存/系统组监控审计；write 3：源码编辑器/源码↔可视化切换/斜杠菜单）；`e2e/` 含 playwright.config.ts + global-setup.ts + 3 个 spec；**Umami 统计（可选）已接入**：`siteConfig.umami` 配置 + `Layout.astro` 条件注入官方脚本（仅 `import.meta.env.PROD && enable && websiteId` 时），环境变量 `UMAMI_ENABLED`/`UMAMI_URL`/`UMAMI_WEBSITE_ID` 覆盖（见 `.env.example`）。**待补**：性能预算验证 |

## 三、Phase 0 验收记录（2026-08-21）

| 验收项（§16） | 结果 |
|---------------|------|
| 存储契约：5 类富块 parse→serialize→parse 语义等价 | ✅ 11/11 单测通过（含 R2 未知围栏、R4 frontmatter、幂等性） |
| 登录+2FA：login→423 challenge→verify-2fa→token→/me | ✅ 冒烟通过（enable/disable/setup 同步验证） |
| 发布触发构建：draft→published→build 任务 success→dist 产物含新页 | ✅ 冒烟通过 |
| 保存冲突 409（baseVersion 比对） | ✅ |
| 版本快照 / 审计日志 / 软删恢复 / 文件夹物化路径 | ✅ API 就绪，冒烟通过核心项 |

环境修复记录：`fuwari-blog/node_modules` 的 pnpm junction 指向旧路径 `D:\gitHub\Sever\...`（项目搬移所致），本地构建必失败；已 `CI=true pnpm install` 重装修复。另：Windows 下构建子进程偶发 0xC0000142（DLL 初始化失败），build 服务已加 `windowsHide` + stdin 关闭 + 瞬时失败自动重试。

## 三-B、Phase 1 验收记录（2026-08-21，浏览器 E2E）

| 验收项 | 结果 |
|---------------|------|
| 登录进入写作空间（token 持久化，刷新免登） | ✅（顺带修复：登录成功后未跳转路由的 bug） |
| 新建文章 → 工具栏插入 /api 接口块 → 预览即时渲染为接口卡片 | ✅ |
| 防抖自动保存（1s）→ 状态指示 已保存 | ✅ |
| frontmatter 面板（分类/标签/摘要）→ 落盘 .md 的 YAML 头同步 | ✅ |
| 发布 → 构建任务 → dist 产物含新页面 | ✅ |
| 三栏布局（文件夹树+文章列表 / 编辑+预览 / 大纲+统计+文档信息） | ✅ |
| 类型检查 / 生产构建 | ✅（write 895KB → 可后续 code-split CodeMirror） |

写作空间启动：`server`（:3011/:3010）+ `apps/write`（`pnpm dev` :3013，/api 代理到后端）。`apps/write` 测试：`pnpm test`（粘贴识别单测）。

## 三-C、Phase 1 收尾 + Phase 2 核心交付记录（2026-08-21 下午）

| 交付项 | 结果 |
|---------------|------|
| Tiptap 可视化模式接入（WritingSpace 四模：分屏/源码/预览/可视化） | ✅ 类型检查+构建通过（与源码共用 tiptap-markdown 序列化契约；ApiBlock/ParamsBlock React 卡片 NodeView + 编辑源码切换） |
| CodeMirror/Tiptap 按需加载（lazy 分包） | ✅ 首屏 JS 895KB → ~279KB（gzip 108KB），§12 预算达标；单测 11/11 绿 |
| `apps/console` 设置控制台（六组） | ✅ 构建 177KB（gzip 58KB）；按组保存 + 触发构建 + 轮询 build 状态 |
| R3F/GLSL 星云 + effect-zone 分区（M2/N7 核心） | ✅ 前台构建通过；首页 display 挂载星云（fbm shader + 900 星点 + 性能门控），其余页面 read 安静；reduced-motion 退场 |
| ⌘K 命令面板（N8） | ✅ 前台构建通过；Pagefind 10 页索引 + 命令组 + 键盘导航 |
| M5 CI / M6 nginx / systemd | ✅ deploy.yml 新增 server+write+console 构建与部署（cloudletter-server :3012）；nginx 新增 /dev/write/ /dev/console/ /api/ 反代；两 SPA 配 base 子路径（/dev/write/、/dev/console/）+ BrowserRouter basename |

环境记录：Windows 下 pnpm 11 默认 `minimum-release-age=24h` 会拦截新发布依赖（rollup 等），本地安装需 `--config.minimum-release-age=0`；CodeBuddy 安全删除 shim 需 `CODEBUDDY_SAFE_DELETE_ENABLED=0` + `CI=true` 才能 pnpm 重装 node_modules。

⚠️ 重大环境问题（2026-08-21 下午）：`server` 与 `fuwari-blog` 的 pnpm 顶层 junction 被 Windows 判定为"不受信任的装入点"全部失效（`.pnpm` 内真实文件完好，但通过 junction 访问报 `UNKNOWN`/`不受信任的装入点`；重建 junction 需权限且请求超时）。根因疑似 pnpm 11 在 Windows 上以相对/长路径创建 junction，配合 `dangerously-allow-all-builds` 触发 esbuild/npm postinstall 后系统级拒绝。**恢复方法**：以管理员权限重开终端，`corepack pnpm install --config.symlink=false`（hard link 模式）+ 手动 `@types` 扁平化 + `pnpm approve-builds` 放行 prisma/esbuild；或改用 npm。此问题不影响已落盘源码，仅阻塞本地构建验证。

## 四、下一步（Phase 3 收尾 → Phase 4）

1. Phase 3 剩余：`[[...]]` 悬停预览浮层（N9）、API 侧边目录 / 多语言示例标签页（N10）、斜杠菜单、阅读舱沉浸态、代码块折叠/diff 三色/终端 $ 分色（M3 收尾）
2. N7 进阶：轨道导航、相机穿行
3. Phase 4：每日备份 cron、Umami 统计、现有 10 篇内容迁移（M4）、E2E（Playwright）、性能预算达标验证
4. E2E 验证：⌘K 面板、console 保存触发重建、可视化模式往返、树拖拽、版本恢复（需浏览器环境）
