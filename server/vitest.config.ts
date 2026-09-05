import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // 单测统一放仓库根 tests/server/*，@server/* 指回本包源码
      '@server': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['../tests/server/**/*.test.ts'],
    environment: 'node',
  },
})
