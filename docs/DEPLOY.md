# 云笺集 · 部署文档

> 配套：`AGENTS.md`「部署规范」一节（每次改动的部署义务）、`docs/DESIGN-SPEC.md`（质量门禁）。
> 本文描述**当前真实生效**的部署方式（2026-09-05 起执行；此前的 GitHub Actions `deploy.yml` 已删除，流程由本手册承接，命令与其一致）。

## 1. 生产架构总览

| 项 | 值 |
|------|------|
| 服务器 | 华为云 ECS `hcss-ecs-b26a`（本机 `~/.ssh/config` 别名 **`cloudletter`** → `root@121.37.222.241`，SSH 免密） |
| 后端 | `/srv/cloudletter/server`，systemd 单元 `cloudletter-server`，`tsx src/index.ts` 直跑，监听 **127.0.0.1:3012** |
| 前端 | `/srv/cloudletter/workbench`（`apps/workbench` 的 Vite 构建产物，nginx 静态托管，SPA 站点根） |
| nginx | 站点文件 `/etc/nginx/sites-enabled/arcade`（以仓库 `server/deploy/nginx-cloudletter.conf` 为准）：`/` → 静态产物、`/api/` → 127.0.0.1:3012、`/portal/` → 拾光集导航页 |
| 数据 | SQLite `/srv/cloudletter/server/data/cloudletter.db`；文章真相源 `data/posts/`；备份 `data/backups/` |
| 环境变量 | systemd 单元内固定（PORT/NODE_ENV/TZ/DATA_ROOT/DATABASE_URL/POSTS_ROOT/SETTINGS_ROOT）+ `EnvironmentFile=/srv/cloudletter/server/.env.production`（0600，SMTP/CORS 等，不入库） |

真相源口径：**以服务器上的实际效果为准**。本地与线上表现不一致时，先核对线上产物版本（`/srv/cloudletter/workbench/assets/index-*.js` 哈希、`systemctl status cloudletter-server` 的启动时间）再排查。

## 2. 前置条件

- 本机（或任一执行机）：Node 20+、pnpm 9、可 `ssh cloudletter` 免密登录（首次需把自己的公钥加入服务器 `authorized_keys`，并在 `~/.ssh/config` 配好 `cloudletter` 别名）。
- 质量门禁全绿：改动包 `typecheck` / `test` / 前端 `build` 通过（见 AGENTS.md「部署规范」）。
- 仓库工作区干净：所有待部署改动已 commit。

## 3. 标准部署流程（无数据库结构变更）

以下命令在仓库根目录执行；产物包 = **后端源码（tsx 直跑）+ 前端构建产物**，服务器上 `pnpm install` 自行装依赖，**数据目录（`data/`）永不入包**。

```bash
# ① 构建 + 打包（排除清单与历史 deploy.yml 一致；prisma/data 为本地开发库，不随包分发）
pnpm -C apps/workbench build
tar -czf deploy-v2.tar.gz -C . \
  --exclude='server/node_modules' --exclude='server/data' --exclude='server/prisma/data' \
  --exclude='server/*.test.ts' --exclude='server/**/*.test.ts' \
  --exclude='server/vitest.config.ts' --exclude='server/eslint.config.js' \
  --exclude='server/tsconfig.json' --exclude='server/tsconfig.tsbuildinfo' \
  server/package.json server/pnpm-lock.yaml server/prisma/ server/src/ server/scripts/ server/deploy/ \
  apps/workbench/dist/

# ② 上传
scp -q deploy-v2.tar.gz cloudletter:/tmp/
```

```bash
# ③ 服务器侧：备份 → 解包 → 依赖 → 库结构同步（无结构变更时 db push 为 no-op）→ 前端就位 → 重启 → 探活
ssh cloudletter 'bash -s' <<'EOF'
set -e
cd /srv/cloudletter/server
export NODE_ENV=production DATA_ROOT=/srv/cloudletter/server/data \
  DATABASE_URL=file:/srv/cloudletter/server/data/cloudletter.db \
  POSTS_ROOT=/srv/cloudletter/server/data/posts SETTINGS_ROOT=/srv/cloudletter/server/data/settings TZ=Asia/Shanghai

# 数据无价：先备份（SQLite + posts/settings/uploads/revisions 快照）
pnpm backup

tar -xzf /tmp/deploy-v2.tar.gz -C /srv/cloudletter/ && rm /tmp/deploy-v2.tar.gz
pnpm install --frozen-lockfile
# 首跑偶发安装失败（虚拟_store 与解包竞态），重跑一次即可；关键命令禁止加管道（| tail 会吞退出码）
test -x node_modules/.bin/tsx

# 库结构：必须先「停服务」再 drop-fts + db push —— 运行中的服务（公网搜索流量）会在
# drop 与 push 之间重建 FTS 表，把 push 挡在数据丢失警告上（2026-09-05 实战教训）。
# 停服窗口仅数秒；推完即起。
systemctl stop cloudletter-server
pnpm exec tsx scripts/drop-fts-tables.ts
pnpm exec prisma db push --skip-generate
pnpm db:generate
systemctl start cloudletter-server

rm -rf /srv/cloudletter/workbench && mkdir -p /srv/cloudletter/workbench
cp -r /srv/cloudletter/apps/workbench/dist/* /srv/cloudletter/workbench/

cp -f /srv/cloudletter/server/deploy/cloudletter-server.service /etc/systemd/system/cloudletter-server.service
systemctl daemon-reload
cp -f /srv/cloudletter/server/deploy/nginx-cloudletter.conf /etc/nginx/sites-enabled/arcade

systemctl restart cloudletter-server
for i in $(seq 1 15); do
  curl -fsS http://localhost:3012/healthz > /dev/null && break; sleep 1
  [ "$i" = 15 ] && { echo "healthz 探活失败"; journalctl -u cloudletter-server -n 50 --no-pager; exit 1; }
done
nginx -t && systemctl reload nginx
echo "== DEPLOY DONE =="
EOF
```

## 4. 数据库结构变更的部署（带一次性迁移脚本时）

`prisma db push` 对「删列/删表」视为数据丢失，直接推终态 schema 会**先丢数据**。若本次改动包含配套的一次性迁移脚本（如 `server/scripts/migrate-notes-taxonomy.ts`，2026-09 灵感笔记接入分类/标签），必须按「**中间态 → 迁移 → 终态**」三段执行：

1. **备份**（同上 `pnpm backup`）；
2. **中间态 schema** = 旧 schema **加**新列/新表（**不删**旧列），`db push` 后 `pnpm db:generate` 让 client 同时认识新旧字段；
3. **跑迁移脚本**（旧列数据搬进新结构：如 mood → Tag、计划型速记 → PlanItem）；
4. **终态 schema**（仓库 HEAD 版）`prisma db push --skip-generate --accept-data-loss` 移除旧列——此时旧列数据已完成使命，删除无损；
5. 服务重启 + 探活（同标准流程）。

> 经验教训（2026-09-05 实战）：中间态 push 与终态 push 都会被 FTS 表挡（先 `drop-fts-tables.ts`）；「迁移脚本要能读到旧列」，故绝不能先推终态 schema。

## 5. 部署后验证清单

- `systemctl is-active cloudletter-server` + 服务器本机 `curl -fsS http://localhost:3012/healthz`；
- 公网抽查：`curl -s http://121.37.222.241/ | grep -o 'index-[^"]*\.js'` 的入口 JS 哈希与本地 `apps/workbench/dist/assets/index-*.js` 一致；`/posts` 等 SPA 路由 200；`/api/v2/*` 返回应用错误包络（说明代理与后端活着）；
- 关键功能人工点一遍本次改动涉及的页面（以服务器实际效果为准）。

## 6. 回滚

- **数据**：`data/backups/<时间戳>/` 内为备份前的 SQLite 全量 + posts/settings/uploads/revisions 快照；恢复 = 停服务 → 覆盖 `cloudletter.db` 与对应目录 → 起服务 → `drop-fts-tables.ts`（或直接重启触发重建）；
- **代码**：用上一个 `deploy-v2.tar.gz`（每次部署的包在本地仓库根同名覆盖，重大升级建议改名留档如 `deploy-v2-20260905.tar.gz`）重跑标准流程；
- **nginx**：站点文件以仓库为准，改坏时 `git checkout server/deploy/nginx-cloudletter.conf` 重走 D2/D3 步。

## 7. 已知坑（实战记录）

- **管道吞退出码**：`pnpm install | tail` 会把失败隐藏，远端脚本一律 `set -e` 且关键命令不加管道；
- **FTS 表**：任何 `db push` 前先 `drop-fts-tables.ts`（§3/§4 已内嵌）；
- **一次性迁移脚本依赖中间态**：新 Prisma client 读不到旧列，先推终态再迁移 = 静默丢数据（§4）；
- **`NODE_ENV=production` 会剪掉 devDependencies**：pnpm install 在该环境下不装 tsx/prisma CLI，而 systemd 直跑后端、FTS 清理、db push 全依赖它们——远端 install 前 `unset NODE_ENV`，装完核对 `node_modules/.bin` 里 tsx/prisma 在位（2026-09-05 实战）；
- **tar 解压会叠加陈旧前端产物**：服务器 `apps/workbench/dist` 每次解包只增不减，旧哈希 chunk 被 `cp` 带进 workbench 越积越多（入口 HTML 引用新哈希，不易察觉）。解包前先 `rm -rf /srv/cloudletter/apps/workbench/dist`，部署后核对 `workbench/assets` 文件数与本地 dist 一致（2026-09-05 实战）；
- **`.env.production` 不入库**：SMTP/CORS 凭据只在服务器上（0600）；仓库与文档禁止出现服务器密钥；
- 本机 Windows Git Bash 用 `curl -d` 直接发中文 JSON 会产生乱码，造数/调试请用 `python urllib`（UTF-8 安全）。
