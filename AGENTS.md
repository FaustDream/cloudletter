# AGENTS.md

本文件为 AI 编码助手在本仓库中的工作约定，所有改动必须遵守。

## 工作准则

- 每次改动完成后，都必须创建一个对应的 Git commit，以便后续追踪和回滚。
- 每次改动后，都必须更新 README.md 文件，以便用户了解新功能和改动。
- 每次进行需求改动时，都必须重新读取一遍AGENTS.md文件，以便了解本仓库的约定是否更新。

## 项目名称

本项目名称为 `云笺集`，项目中文名称为 `云笺集`，项目英文名称为 `CLOUDLETTER`。  

## 技术栈

后端（server/）​
 - Express 4 + Prisma 5（ORM）+ tsx（直接跑 TS）
 - 邮件能力走 nodemailer，测试用 vitest
 - 关键约定：所有接口统一挂在 /api/v2/* 下（绞杀者模式），双鉴权体系（auth.ts 主 + guestAuth.ts 访客）

前端（apps/workbench/）​

 - React 18 + Vite + TypeScript，路由用 react-router-dom 6
 - 富交互依赖很重：three（3D）、mermaid（图）、katex（公式）、markdown-it、BlockNote（块编辑器）、CodeMirror 6
 - dev 端口 3015

工程底座
 - 包管理用 pnpm（单体仓库 monorepo，勿混用 npm/yarn）
 - 全量 TypeScript；样式约定以 shared/theme.css 为准

 ## 代码规范

读取并遵守docs\DESIGN-SPEC.md

## 上下文记忆系统

每次改动后，都必须更新docs\memory\文件，按照日期创建文件，文件名为日期，文件内容为改动内容。

## 注意事项

- 禁止使用 explicit any，使用 unknown 替代"
- "单个函数不超过 50 行，超过需拆分"
- "每个 API 路由必须有 try-catch + 统一错误响应"
- 使用 TypeScript 严格模式
- 使用 ES6+ 语法
- 使用单引号，不使用分号
- 优先使用箭头函数
- 禁止在代码中硬编码敏感信息
- 生产环境构建使用 npm run build
- 更新依赖后需要重启开发服务器

## 测试要求

- 测试文件放在 tests 目录
- 使用 Jest 测试框架
- 提交前必须通过所有测试
- 新功能必须包含对应的测试用例