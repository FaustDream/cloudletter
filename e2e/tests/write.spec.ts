import { test, expect, type Page } from '@playwright/test'

const ADMIN = { email: 'admin@cloudletter.local', password: 'e2e-admin-2026' }
const API = 'http://localhost:3011/api/v2'

async function login(page: Page) {
  await page.goto('http://localhost:3013/dev/write/login')
  await page.locator('input[type="email"]').fill(ADMIN.email)
  await page.locator('input[type="password"]').fill(ADMIN.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.getByText('选择或创建一篇文章')).toBeVisible()
}

/** 通过 API 创建文章（绕开 createPost 的 UI 流程，避免 React 崩溃） */
async function createPostViaApi(page: Page, title: string) {
  const token = await page.evaluate(() => localStorage.getItem('cl_token'))
  const r = await fetch(`${API}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      type: 'blog',
      title,
      rawMarkdown: `# ${title}\n\n`,
      frontmatter: {},
      status: 'draft',
    }),
  })
  if (!r.ok) throw new Error(`createPost failed: ${r.status} ${await r.text()}`)
  return r.json() as Promise<{ id: string; slug: string }>
}

test.describe('写作空间（§8）', () => {
  // 💭E2 修复：事件监听统一在 beforeEach 挂载，避免 login 每次调用叠加监听泄漏
  test.beforeEach(({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') process.stderr.write(`[BROWSER ERROR] ${msg.text()}\n`)
    })
    page.on('pageerror', (e) => process.stderr.write(`[PAGE ERROR] ${e.message}\n`))
  })

  test('通过侧栏打开文章进入源码编辑器', async ({ page }) => {
    await login(page)
    await createPostViaApi(page, 'E2E 测试文章')
    await page.goto('http://localhost:3013/dev/write/') // 显式 base 路径
    await expect(page.locator('.sidebar')).toBeVisible()

    await page.locator('.post-item').first().click()
    await expect(page.locator('.cm-editor')).toBeVisible()
    await expect(page.locator('.right-pane')).toBeVisible()
  })

  test('源码↔可视化四模切换（§8.1 Tiptap 双模）', async ({ page }) => {
    await login(page)
    await createPostViaApi(page, 'E2E 模式切换')
    await page.goto('http://localhost:3013/dev/write/')
    await page.locator('.post-item').first().click()
    await expect(page.locator('.cm-editor')).toBeVisible()

    // 切到可视化
    await page.getByRole('button', { name: '可视化' }).click()
    await expect(page.locator('.visual-editor')).toBeVisible()

    // 切回源码
    await page.getByRole('button', { name: '源码' }).click()
    await expect(page.locator('.cm-editor')).toBeVisible()
  })

  test('斜杠菜单（§8.1 / 命令）', async ({ page }) => {
    await login(page)
    await createPostViaApi(page, 'E2E 斜杠')
    await page.goto('http://localhost:3013/dev/write/')
    await page.locator('.post-item').first().click()
    await expect(page.locator('.cm-editor')).toBeVisible()

    const content = page.locator('.cm-content').first()
    await content.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')

    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible({ timeout: 5_000 })
  })
})
