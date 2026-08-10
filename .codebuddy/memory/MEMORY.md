# 长期记忆 · 项目约定

## 站点命名约定（2026-08-07 确认）
- **导航页**（http://121.37.222.241/，服务器 /srv/portal/）叫 **「拾光集」**（用户保留此名）
- **个人博客**（http://121.37.222.241/dev/）叫 **「云笺集」**（与导航页区分），英文名 Cloudletter，slogan「以文字与代码，记录生活与思考」
- 两站名不能重名

## 博客架构（2026-08-10 重构：Node 服务 → Fuwari 静态站）
- 博客已从自研 Node 服务（/srv/dev + :3002）**迁移到 Fuwari**（Astro 静态博客），源码在本地 `d:/gitHub/Sever/fuwari-blog/`、服务器 `/srv/fuwari/`
- 原 dev 服务已停用（systemctl disable dev）；**文章目录变为 `/srv/fuwari/src/content/posts/`**（旧 /srv/articles/ 保留两篇已迁完）
- 博客本体：nginx 静态托管 `/srv/fuwari/dist/`（`/dev/` location，alias + try_files）
- **在线编辑**：Node 零依赖服务 `/srv/fuwari/admin/server.cjs`（systemd `fuwari-admin` :3010，nginx `/dev/admin/` 反代），保存文章自动触发 `pnpm build`（BUILD_CMD 环境变量，注意 systemd 里需加引号 `Environment="BUILD_CMD=pnpm build"`）
- nginx 配置文件：`/etc/nginx/sites-enabled/arcade`（含全部站点，备份在 /etc/nginx/arcade.bak）
- **Fuwari 关键配置**：站点信息/主题色在 `src/config.ts`（朱砂红 hue=9，lang=zh_CN）；base 路径在 `astro.config.mjs`（当前 `/dev/`）；文章 frontmatter 用 `published`（非 date）、`tags`、`category`、`draft`
- 构建命令：`pnpm build`（需 pnpm>=9，服务器已全局安装）；node 在 /usr/local/bin/node
- 部署方式不变：scp 上传（注意 Windows 打包用 tar 排除 node_modules/dist/.git）

## 服务器与部署约定（2026-08-10 精简后）
- **仅保留两个站点**：导航页「拾光集」（/srv/portal/） + 博客「云笺集」（/srv/fuwari/）
- 非 git 仓库，部署靠 scp：`scp -i C:/Users/Lynn/.ssh/id_ed25519 <本地> root@121.37.222.241:<远程>`
- **导航页（portal）**：nginx 静态服务，上传 /srv/portal/index.html 即生效，无需重启
- SSH MCP(ssh-server-agent) 白名单不含 scp/管道符；偶发 30s 超时，可改用本机 ssh
- 已移除：lol、tft、fishing-kiln 三个模块（代码和数据已删除）

## 部署端口
- fuwari-admin(在线编辑):3010，nginx 反代到 /dev/admin/
- admin 后台现支持两个标签页：**文章管理** 和 **站点设置**（通过 GET/PUT /api/settings 读写 src/config.ts，保存后自动构建）
