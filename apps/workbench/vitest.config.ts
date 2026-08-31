import { defineConfig } from 'vitest/config'

/** 前端单元测试：只覆盖纯函数（日期/大纲/双链/diff/高亮），组件行为走 e2e */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
