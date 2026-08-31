# Cloudletter V2 蓝图（冻结版）

> 目标定位收缩：**个人写作 + 个人博客发布工具**，而非 CMS / 多用户平台 / 企业级知识库。
> 现仓库降级为「需求原型 + 代码资产库」，V2 按本蓝图重砌，旧代码保留参考、不再作为主路径。

---

## 1. 核心目标

> **一个自己每天愿意使用的个人写作与博客发布工具。**

写作 → 自动保存 → 分类/标签 → 发布 → 博客展示。

## 2. 目录结构（同仓新建）

```
cloudletter
├── server/            # 极简 API（Express + Prisma + SQLite 元数据）
│   └── src/
│       ├── index.ts           # 入口 + 挂载 + 极简错误中间件
│       ├── prisma.ts          # Prisma client
│       ├── auth.ts            # 单管理员本地 session（简单）
│       ├── content.ts         # Markdown 文件读写 = 唯一真相源操作
│       ├── routes/            # posts / categories / tags / revisions / search / settings
│       └── prisma/schema.prisma
├── apps/
│   ├── editor/                # 写文章：CodeMirror 6 + Markdown
│   └── blog/                  # 博客展示：Fuwari (Astro)，只改皮
├── shared/                    # 设计令牌 theme.css + API 类型契约
├── e2e/                       # Playwright
└── docs/
```

## 3. 核心架构决策（已拍板）

| 决策 | 结论 | 影响 |
|---|---|---|
| 内容真相源 | **Markdown 文件**（`apps/blog/src/content/**/*.md`） | 正文即文件，Astro 直接消费，消除 DB↔磁盘双写一致性 |
| 存储 | SQLite 只存：单管理员凭据 + 文章元数据索引 + 版本历史 | 砍 Folder 物化路径、复杂媒体、构建队列持久化 |
| 认证 | 单管理员本地口令 + 简单 session | 砍 RBAC 四级、2FA、限流、审计 |
| 编辑器 V1 | 仅 CodeMirror 6 + Markdown | 砍 VisualEditor、Tiptap、richBlocks、serializer、paste-detect |
| 博客前台 | Fuwari/Astro 第三方，锁版本只改皮 | 不碰 Fuwari 核心架构 |

## 4. 模块 × 成熟方案

**自研（博客核心业务）：**
- 文章 list/get/create/update/delete/publish 业务逻辑
- DB↔文件元数据核对 + 版本历史（save 时写快照）
- 编辑器业务流程（列表 → 编辑 → 自动保存 → 发布）
- 博客特有管理界面

**用成熟方案（不再自研）：**

| 原自研 | 换为 |
|---|---|
| 手写 `validate.ts` | zod |
| 手写安全头 + `wrapAsyncRouter` hack | helmet + express-async-errors / Express 5 |
| 手写 frontmatter→YAML | js-yaml |
| 手写 block↔Markdown | 弃用（V1 纯 Markdown）|
| 内存构建队列 | 砍掉——发布即触发 `pnpm build` 简单串行 |
| 搜索 | SQLite FTS5（Markdown 正文建索引）|
| RSS/Sitemap | Astro 内建 |
| 前端状态管理 | zustand（如需要）|
| 后端/ORM | Express + Prisma + SQLite（保留）|

**直接删（第一批）：** 复杂 RBAC、2FA、限流、审计、文件夹树/物化路径、富块、VisualEditor、block 序列化、复杂构建队列、复杂 console、复杂媒体、统计、portal。

## 5. 极简 API 面

```
POST/GET  /api/v2/auth/login · /auth/me · /auth/logout
GET/POST/PUT/DELETE /api/v2/posts
GET/PUT   /api/v2/posts/:id/revisions · POST /api/v2/posts/:id/revisions/:vid/restore
GET/POST/PUT/DELETE /api/v2/categories
GET/POST/DELETE     /api/v2/tags
GET/PUT   /api/v2/settings
GET       /api/v2/search?q=
```

## 6. Post 领域模型（瘦身版）

```
title · slug · content(MD)      # 真相源在文件，SQLite 存元数据指针
status: draft | published
category · tags[] · cover       # frontmatter YAML
createdAt · updatedAt · publishedAt
revisions[]                     # SQLite（版本时间戳 + 摘要；正文快照存文件）
```

## 7. P0 / P1 / P2 边界

- **P0（必须有）**：文章、MD 编辑、自动保存、草稿、发布、分类、标签、创建/修改/发布时间、版本历史、博客首页+文章详情、搜索、响应式
- **P1（以后加）**：快捷键、大纲、图片拖拽/粘贴、代码高亮、预览、全文搜索优化、RSS、Sitemap、SEO、暗色
- **P2（暂不做）**：多用户、协作、评论、点赞、收藏、复杂媒体库、文件夹、富块、可视化编辑器、插件、AI Agent、多平台发布

## 8. 落地顺序

1. **收敛后端**：删 RBAC/2FA/限流/审计/备份/构建队列/文件夹/统计 → 只留极小 API + 单登录
2. **反真相源**：`sync.ts` 从「DB 为主 + 落盘镜像」改为「文件为主 + SQLite 元数据/历史」
3. **瘦身前端**：砍 VisualEditor/Tiptap/富块，留 CodeMirror + Markdown；删 console 半成品，合并为轻 editor
4. **锁博客**：锁定 Fuwari 版本，只改 logo/命名/配色/导航/卡片
5. **补 e2e**：主路径（登录 → 写 → 存 → 发布 → 博客可见）