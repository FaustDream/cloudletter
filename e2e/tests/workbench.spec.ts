import { test, expect, type Page } from '@playwright/test'

/**
 * 工作台 E2E 功能冒烟（最小闭环）：
 * 登录 → 总览渲染 → 全部子页面渲染 → 今日计划 新增/完成/删除。
 * 运行于独立后端 4011（e2e 测试库 admin@cloudletter.local），与开发实例隔离。
 */
const BASE = 'http://localhost:4015'
const ADMIN = { email: 'admin@cloudletter.local', password: 'e2e-admin-2026' }

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`)
  await page.locator('input[type="email"]').fill(ADMIN.email)
  await page.locator('input[type="password"]').fill(ADMIN.password)
  await page.getByRole('button', { name: '登 录', exact: true }).click()
  await expect(page.locator('.tl-greet .hi')).toBeVisible()
}

test.describe('工作台 · 核心闭环', () => {
  test('登录 → 总览渲染', async ({ page }) => {
    await login(page)
    await expect(page.locator('.tl-greet .hi')).toHaveText('时光长河')
  })

  test('侧栏导航：全部子页面渲染非空白', async ({ page }) => {
    await login(page)
    const pages: Array<{ path: string; text: string }> = [
      { path: '/posts', text: '文章' },
      { path: '/organize?tab=category', text: '组织' },
      { path: '/search', text: '全站检索' },
      { path: '/goals-home', text: '目标' },
      { path: '/ledger', text: '记账本' },
      { path: '/notes', text: '灵感笔记' },
    ]
    for (const p of pages) {
      await page.goto(`${BASE}${p.path}`)
      await expect(page.locator('.header h2').first()).toContainText(p.text, { timeout: 10_000 })
    }
    // 站点设置页头结构不同（set-crumb）
    await page.goto(`${BASE}/settings?g=site`)
    await expect(page.locator('.set-crumb')).toContainText('站点设置', { timeout: 10_000 })
  })

  test('今日计划：新增 → 完成 → 删除 闭环', async ({ page }) => {
    await login(page)
    await page.goto(`${BASE}/goals-home?tab=plan`)
    await page.getByRole('button', { name: /新建计划/ }).click()
    await page.locator('.modal input[type="text"]').first().fill('E2E 计划冒烟')
    await page.locator('.modal .mfoot .btn').last().click()
    await expect(page.getByText('E2E 计划冒烟')).toBeVisible()

    const row = page.locator('.wb-item', { hasText: 'E2E 计划冒烟' })
    await row.locator('.wchk').click()
    await expect(row.locator('.wchk')).toHaveClass(/on/)

    await row.locator('.wdel').click()
    await expect(page.getByText('E2E 计划冒烟')).toHaveCount(0)
  })

  test('登出后访问受保护页面回到登录页', async ({ page }) => {
    await login(page)
    await page.goto(`${BASE}/posts`)
    // 清除本地登录态后刷新 → 应被重定向到 /login
    await page.evaluate(() => {
      localStorage.removeItem('cl_token')
      document.cookie = 'cl_token=; path=/; max-age=0'
    })
    await page.goto(`${BASE}/posts`)
    await expect(page).toHaveURL(/\/login/)
  })
})
