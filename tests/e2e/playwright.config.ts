import { defineConfig } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

/**
 * E2E 配置：
 * - 串行（workers=1）：工作台前端(:4015)与其独立后端(:4011, e2e 测试库)共享状态，避免并发写入冲突
 * - write/console 独立应用已下线（编辑器/站点设置已并入工作台），仅保留工作台一套 webServer
 * - 测试数据库独立于开发库（server/data/e2e-test.db），globalSetup 里 db push + seed
 * - 内容目录通过 POSTS_ROOT/SETTINGS_ROOT 指向 tests/e2e/content，与开发数据完全隔离
 * - executablePath 指向本机已缓存的 chromium（Linux/CI 需自行调整或改用 channel 定位）
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

// 与开发实例完全隔离的内容目录（config.ts 只读 POSTS_ROOT / SETTINGS_ROOT）
const E2E_CONTENT = '../../tests/e2e/content'

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
  // webServer 用 node 直调可执行文件：绕开 corepack pnpm 版本漂移与 pnpm 11 supply-chain 策略检查
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs src/index.ts',
      cwd: '../../server',
      url: 'http://localhost:4011/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        PORT: '4011',
        DATABASE_URL: 'file:./data/e2e-test.db',
        POSTS_ROOT: `${E2E_CONTENT}/posts`,
        SETTINGS_ROOT: `${E2E_CONTENT}/_settings`,
        BUILD_CMD: 'echo skip-build',
        ADMIN_EMAIL: 'admin@cloudletter.local',
        ADMIN_PASSWORD: 'e2e-admin-2026',
      },
    },
    {
      command: 'node node_modules/vite/bin/vite.js --port 4015',
      cwd: '../../apps/workbench',
      url: 'http://localhost:4015/',
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        API_PROXY: 'http://localhost:4011',
      },
    },
  ],
})
