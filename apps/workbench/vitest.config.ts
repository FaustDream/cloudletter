import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** 前端单元测试：只覆盖纯函数（日期/大纲/双链/diff/高亮），组件行为走 e2e */
export default defineConfig({
  resolve: {
    alias: {
      // 单测统一放仓库根 tests/workbench/*，@workbench/* 指回本包源码
      '@workbench': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['../../tests/workbench/**/*.test.ts'],
    environment: 'node',
  },
})
