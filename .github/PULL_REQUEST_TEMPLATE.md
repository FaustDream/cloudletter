<!-- 代码审查 PR 模板（云笺集） -->

## 改动摘要
<!-- 做了什么、为什么做，关联规格章节（如 §6.2）或 issue -->

## 影响范围
- [ ] 后端 API（`server/`）
- [ ] 前端 `apps/write`
- [ ] 前端 `apps/console`
- [ ] 序列化 / 存储契约
- [ ] 磁盘同步 / 构建 / 备份
- [ ] E2E 脚本
- [ ] `fuwari-blog/`（第三方模板，仅定向改动）

## 测试与验证
- [ ] 已补/改单测（涉及 API 契约、序列化、鉴权、存储落盘时必填）
- [ ] 已跑 `pnpm typecheck && pnpm test && pnpm lint`（每包）
- [ ] 手动验证步骤（如适用）：

## 自审清单（对照 docs/CODE_REVIEW.md）
- [ ] 无 🔴 级别问题遗留
- [ ] 来自 `req.body/query/params` 的输入已校验（未直接进 DB / shell / 路径）
- [ ] 写接口在 `requireAuth` + 最小 `requireRole` 之后
- [ ] 无未处理的 `async` 抛错（Express 4 需 `catchAsync` 或升级 Express 5）
- [ ] 关键操作已 `audit()`；错误信息不泄漏内部细节
- [ ] 无调试 `console.log`、无死代码

## 风险 / 后续
<!-- 已知的 🟡 项、技术债、待补测试，或需 follow-up 的 issue -->
