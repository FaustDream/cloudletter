---
title: 云笺集富块渲染指南
published: 2026-08-21
description: 接口卡片 / 参数表 / 提示框 / 双链 / 程序员代码块的前台渲染验证与写法。
tags: [指南, 云笺集]
category: 指南
draft: false
---

# 富块渲染指南

本文演示云笺集存储契约（§5）的五类富块在前台的渲染效果。写作方法参见 [[markdown|Markdown 示例文章]]。

## 接口卡片（```api）

```api
method: GET
path: /api/v2/posts/:id
summary: 获取单篇文章详情（含 rawMarkdown 与 frontmatter）
params:
  - name: id
    in: path
    type: string
    required: true
    desc: 文章 ID（cuid）
  - name: fields
    in: query
    type: string
    required: false
    desc: 逗号分隔的字段白名单
responses:
  - status: 200
    desc: 成功
    body: |
      { "id": "ckx1", "title": "示例", "status": "published" }
  - status: 404
    desc: 文章不存在
```

## 独立参数表（```params）

```params
- name: page
  type: number
  required: false
  default: 1
  desc: 页码
- name: size
  type: number
  required: false
  default: 20
  desc: 每页条数
```

## 提示框（::: 容器）

:::tip
用 `/api` 快捷插入接口块，外部粘贴的接口片段会被自动识别。
:::

:::danger
禁止在生产环境直接连接 :3012 端口，API 仅经 nginx 反代暴露。
:::

## 程序员代码块（标题 + 行高亮）

```ts title="serializer.ts" {2,5}
export function serialize(blocks: Block[]): string {
  return blocks.map(toMarkdown).join('\n\n') + '\n'  // 高亮：拼接
}
function toMarkdown(b: Block): string {
  return b.t === 'api' ? fence('api', b) : plain(b)   // 高亮：富块围栏
}
```
