import { test, expect, type Page } from '@playwright/test'

/**
 * 文章编辑页 E2E 功能冒烟（最小闭环）：
 * 新建草稿 → BlockNote 编辑器渲染 → 标题/正文输入 → 自动保存 → 返回列表可见。
 * 站点设置分组渲染（原控制台并入工作台）。
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

test.describe('工作台 · 文章编辑页', () => {
  test('新建草稿 → BlockNote 编辑 → 自动保存 → 列表可见', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)

    // 文章页 → 新建草稿 → 进入编辑页
    await page.goto(`${BASE}/posts`)
    await page.getByRole('button', { name: /新建草稿/ }).click()
    // 标题已入纸面画布（顶栏仅留操作项）
    await expect(page.locator('.ed-paper .ed-canvas-title')).toBeVisible({ timeout: 15_000 })
    // BlockNote 编辑内核渲染（contenteditable）
    const editor = page.locator('.ed-blocknote .bn-editor')
    await expect(editor).toBeVisible({ timeout: 15_000 })

    // 输入标题与正文 → 未保存状态出现 → 防抖自动保存后回到「已保存」
    await page.locator('.ed-paper .ed-canvas-title').fill('E2E 编辑器验证文章')
    await editor.click()
    await page.keyboard.type('E2E 自动保存正文内容。')
    await expect(page.locator('.save-state.dirty')).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.save-state.saved')).toBeVisible({ timeout: 10_000 })

    // 返回列表，文章存在
    await page.getByRole('button', { name: '← 返回' }).click()
    await expect(page.locator('.header h2')).toHaveText(/文章/)
    await expect(page.locator('.ptitle', { hasText: 'E2E 编辑器验证文章' }).first()).toBeVisible()
  })

  test('站点设置分组渲染（原控制台并入）', async ({ page }) => {
    await login(page)
    await page.goto(`${BASE}/settings?g=site`)
    // 左侧分组导航（set-nav-item）含「站点设置」，精确到导航项避免 strict mode
    const nav = page.locator('.set-nav-item', { hasText: '站点设置' })
    await expect(nav.first()).toBeVisible()
    // 分组标题（.set-sec-h）：site 组首个板块为「站点自定义中心」
    const sec = page.locator('.set-sec-h', { hasText: '站点自定义中心' })
    await expect(sec.first()).toBeVisible()
  })
})
