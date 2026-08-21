import { defineConfig } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

/**
 * E2E 配置（§15）：
 * - 串行（workers=1）：三个服务共享同一测试数据库，避免并发写入冲突
 * - webServer 启动 server(:3011 测试库) + write(:3013) + console(:3014)
 * - 测试数据库独立于开发库（server/data/e2e-test.db），globalSetup 里 db push + seed
 * - executablePath 指向本机已缓存的 chromium-1228（避免重复下载浏览器）
 */
const chromiumExe = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'ms-playwright',
  'chromium-1228',
  'chrome-win64',
  'chrome.exe',
)

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'chromium',
    launchOptions: { executablePath: chromiumExe },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  globalSetup: './global-setup',
  // webServer 用 node 直调可执行文件（§3.1 独立包边界）：绕开 corepack pnpm 版本漂移
  // 与 pnpm 11 supply-chain 策略检查，保证任意环境可复现。
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs src/index.ts',
      cwd: '../server',
      url: 'http://localhost:3011/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        PORT: '3011',
        DATABASE_URL: 'file:./data/e2e-test.db',
        PROJECT_DIR: '../e2e/content',
        BUILD_CMD: 'echo skip-build',
        ADMIN_EMAIL: 'admin@cloudletter.local',
        ADMIN_PASSWORD: 'e2e-admin-2026',
      },
    },
    {
      command: 'node node_modules/vite/bin/vite.js --port 3013',
      cwd: '../apps/write',
      url: 'http://localhost:3013/dev/write/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --port 3014',
      cwd: '../apps/console',
      url: 'http://localhost:3014/dev/console/',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
