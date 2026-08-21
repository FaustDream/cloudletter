import { test, expect } from '@playwright/test'

const ADMIN = { email: 'admin@cloudletter.local', password: 'e2e-admin-2026' }

test.describe('认证（§6.1 登录）', () => {
  test('write 登录后进入写作空间', async ({ page }) => {
    await page.goto('http://localhost:3013/dev/write/login')
    await page.locator('input[type="email"]').fill(ADMIN.email)
    await page.locator('input[type="password"]').fill(ADMIN.password)
    await page.getByRole('button', { name: '登录' }).click()

    // 登录后进入写作空间：文件夹树 + 未选中文章时的空状态
    await expect(page.locator('.sidebar')).toBeVisible()
    await expect(page.getByText('选择或创建一篇文章')).toBeVisible()
  })

  test('console 登录后进入设置控制台', async ({ page }) => {
    await page.goto('http://localhost:3014/dev/console/login')
    await page.locator('input[type="email"]').fill(ADMIN.email)
    await page.locator('input[type="password"]').fill(ADMIN.password)
    await page.getByRole('button', { name: '登录' }).click()

    // 登录后进入设置控制台（左导航 + 右表单）
    await expect(page.locator('.console-nav')).toBeVisible()
    await expect(page.locator('.console-main')).toBeVisible()
  })

  test('错误密码被拒绝', async ({ page }) => {
    await page.goto('http://localhost:3014/dev/console/login')
    await page.locator('input[type="email"]').fill(ADMIN.email)
    await page.locator('input[type="password"]').fill('wrong-password')
    await page.getByRole('button', { name: '登录' }).click()

    await expect(page.locator('.login-error')).toBeVisible()
  })
})
