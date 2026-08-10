# 云笺集 · Fuwari 博客

基于 [Fuwari](https://github.com/saicaca/fuwari)（Astro + Tailwind CSS）的个人博客，替代原「云笺集」Node 博客。

## 结构

```
.
├── src/
│   ├── config.ts          # 站点配置（标题/主题色/导航/个人资料）
│   ├── content/
│   │   ├── posts/         # 博客文章（Markdown + frontmatter）
│   │   └── spec/about.md  # 关于页
│   └── pages/             # 页面组件
├── admin/
│   ├── server.cjs         # 在线编辑服务（Node 零依赖）
│   └── public/index.html  # 管理后台界面
├── deploy/
│   ├── nginx-dev.conf     # nginx 配置（/dev/ 静态站 + /dev/admin 反代）
│   └── fuwari-admin.service  # systemd 服务单元
└── astro.config.mjs       # Astro 配置（site/base）
```

## 本地开发

```bash
pnpm install        # 安装依赖（需 pnpm >= 9）
pnpm dev            # 本地开发 :4321
pnpm build          # 构建到 dist/（含 pagefind 搜索索引）
pnpm new-post <name>  # 新建文章
```

## 部署（服务器 121.37.222.241）

- 项目目录：`/srv/fuwari/`
- 博客访问：`http://121.37.222.241/dev/`
- 管理后台：`http://121.37.222.241/dev/admin/`
- 在线编辑服务：systemd `fuwari-admin`（端口 3010）
- 构建命令：`pnpm build`（BUILD_CMD 环境变量，保存文章后自动触发）

nginx 配置要点（`/etc/nginx/sites-enabled/arcade`）：

```nginx
location /dev/ {
    alias /srv/fuwari/dist/;
    index index.html;
    add_header Cache-Control "no-cache";
    try_files $uri $uri/ =404;
}
location /dev/admin/ {
    proxy_pass http://127.0.0.1:3010/;
    ...
}
```

## 更新流程

1. 写作：本地 `src/content/posts/*.md`，或线上 `/dev/admin/`
2. 部署：
   - 本地：`scp` 文章或改完后 `tar` 打包上传
   - 线上：改 `/srv/fuwari/src/content/posts/*.md` 后，保存会自动触发构建；或手动 `curl -X POST http://127.0.0.1/dev/admin/api/build`

## 日后迁移 GitHub Pages

1. 改 `astro.config.mjs`：`base: '/blog/'`、`site: 'https://<user>.github.io'`
2. 在 `src/config.ts` 更新站点 URL
3. 用 GitHub Actions 部署（Fuwari 仓库自带 `.github/workflows/deploy.yml`）
4. 迁移后管理后台不再需要（纯静态），可停掉 `fuwari-admin`

## 文章 frontmatter 格式

```yaml
---
title: 文章标题
published: 2026-08-01     # 日期
tags: [标签1, 标签2]
category: 分类
description: 摘要
draft: false               # true 则暂不发布
---
```
