import { test, expect } from '@playwright/test'

const ADMIN = { email: 'admin@cloudletter.local', password: 'e2e-admin-2026' }

async function login(page: import('@playwright/test').Page) {
  await page.goto('http://localhost:3014/dev/console/login')
  await page.locator('input[type="email"]').fill(ADMIN.email)
  await page.locator('input[type="password"]').fill(ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.locator('.console-main')).toBeVisible()
}

test.describe('设置控制台（§9 六组）', () => {
  test('六组导航可见', async ({ page }) => {
    await login(page)
    for (const label of ['外观', '布局', '内容', '阅读', '交互', '系统']) {
      await expect(page.locator('.console-nav').getByText(label, { exact: true })).toBeVisible()
    }
  })

  test('修改强调色并保存触发构建', async ({ page }) => {
    await login(page)

    // 外观组默认选中，改强调色
    const color = page.locator('input[type="color"]')
    await color.fill('#ff0000')

    // 保存按钮从"已同步"变为可点，点击保存
    const save = page.getByRole('button', { name: '保存并触发构建' })
    await expect(save).toBeEnabled()
    await save.click()

    // 保存后出现构建状态提示（保存成功）
    await expect(page.locator('.build-state')).toBeVisible({ timeout: 10_000 })
  })

  test('系统组展示监控与审计', async ({ page }) => {
    await login(page)
    await page.locator('.console-nav').getByText('系统', { exact: true }).click()

    // 用 .section-title 限定，避免与 nav-desc 中的"监控"文字重复匹配
    await expect(page.locator('.section-title').getByText('监控', { exact: true })).toBeVisible()
    await expect(page.getByText('最近审计日志')).toBeVisible()
  })
})
