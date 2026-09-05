import { test, expect, type Page } from '@playwright/test'

/**
 * 文章编辑页 E2E 功能冒烟（最小闭环）：
 * 新建草稿 → BlockNote 编辑器渲染 → 标题/正文输入 → 自动保存 → 返回列表可见。
 * 站点设置分组渲染（原控制台并入工作台）。
 * 编辑体验扩展：常驻工具栏 / 右栏文档信息（可折叠·单封面标签·标签多选）/ 编辑器滚动 /
 * 大纲点击跳转 / 双链弹窗跳转 / 冲突本地覆盖 / 重开服务器为主。
 */
const BASE = 'http://localhost:4015'
const API = 'http://localhost:4011/api/v2'
const ADMIN = { email: 'admin@cloudletter.local', password: 'e2e-admin-2026' }

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE}/login`)
  await page.locator('input[type="email"]').fill(ADMIN.email)
  await page.locator('input[type="password"]').fill(ADMIN.password)
  await page.getByRole('button', { name: '登 录', exact: true }).click()
  await expect(page.locator('.tl-greet .hi')).toBeVisible()
}

/* ===== API 辅助：独立后端（:4011）直接造数，避免前端链路耦合 ===== */
let apiTokenCached = ''
async function apiToken(): Promise<string> {
  if (!apiTokenCached) {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ADMIN),
    })
    apiTokenCached = (await r.json()).token as string
  }
  return apiTokenCached
}

async function apiCreatePost(body: {
  title: string
  rawMarkdown: string
  status?: string
}): Promise<{ id: string }> {
  const r = await fetch(`${API}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await apiToken()}` },
    body: JSON.stringify({ status: 'draft', ...body }),
  })
  return r.json()
}

async function apiPutPost(id: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${API}/posts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await apiToken()}` },
    body: JSON.stringify(body),
  })
  expect(r.ok).toBeTruthy()
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

test.describe('工作台 · 编辑体验（工具栏/右栏/滚动/大纲/双链/保存策略）', () => {
  test('常驻工具栏 + 右栏文档信息（可折叠/单封面标签/标签多选新建）+ 手动保存按钮', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)
    await page.goto(`${BASE}/posts`)
    await page.getByRole('button', { name: /新建草稿/ }).click()
    const title = page.locator('.ed-paper .ed-canvas-title')
    await expect(title).toBeVisible({ timeout: 15_000 })

    // 常驻格式工具栏（撤销重做/H1-3/B I U S 代码/引用/三种列表）
    await expect(page.locator('.ed-toolbar .ed-tb-btn')).toHaveCount(14)
    // 手动保存按钮：初始已保存态禁用
    const saveBtn = page.getByRole('button', { name: '保存', exact: true })
    await expect(saveBtn).toBeDisabled()

    // 右栏首节 = 文档信息（可折叠）；封面标签只出现一次（旧顶部条已移除）
    await expect(page.locator('.ed-side-fold')).toHaveText(/文档信息/)
    await expect(page.locator('.ed-side .fm-k').filter({ hasText: '封面' })).toHaveCount(1)
    await page.locator('.ed-side-fold').click()
    await expect(page.locator('.ed-side-meta')).toHaveAttribute('data-open', 'false')
    await expect.poll(() => page.evaluate(() => localStorage.getItem('cl_ed_meta'))).toBe('0')
    await page.locator('.ed-side-fold').click()

    // 标签多选：搜索无命中 → 「新建」→ chip 展示
    await page.locator('.tag-ms-trigger').click()
    await page.locator('.tag-ms-search').fill('e2e标签')
    await page.locator('.tag-ms-item').filter({ hasText: '新建' }).click()
    await expect(page.locator('.tag-ms-chip').filter({ hasText: 'e2e标签' })).toBeVisible()

    // 手动保存：脏 → 点击 → 已保存
    await title.fill('工具栏与右栏验证文章')
    await expect(saveBtn).toBeEnabled()
    await saveBtn.click()
    await expect(page.locator('.save-state.saved')).toBeVisible({ timeout: 10_000 })
  })

  test('编辑器长文可下滑 + 顶部不再有文档信息条 + 大纲点击跳转', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)
    const paras = Array.from({ length: 30 }, (_, i) =>
      `第${i + 1}段：填充内容，用于验证编辑器容器在内容超出一屏后可以向下滚动查看后续文字。`).join('\n\n')
    const p = await apiCreatePost({
      title: '滚动验证文章',
      rawMarkdown: `# 开头标题\n\n${paras}\n\n## 深处标题\n\n深处的正文。\n`,
    })
    await page.goto(`${BASE}/posts/${p.id}/edit`)
    await expect(page.locator('.ed-blocknote .bn-editor')).toBeVisible({ timeout: 15_000 })

    // 旧顶部文档信息条已移除（画布与顶栏对齐，属性面板在右栏）
    await expect(page.locator('.ed-meta')).toHaveCount(0)
    // 宿主容器可向下滚动（修复前 overflow hidden 无法下滑）
    const scrolled = await page.evaluate(() => {
      const h = document.querySelector('.ed-blocknote')
      if (!h) return 0
      h.scrollTop = 400
      return h.scrollTop
    })
    expect(scrolled).toBeGreaterThan(300)

    // 大标题进大纲（首条）
    await expect(page.locator('.outline-title')).toHaveText('滚动验证文章')
    // 点击深处标题 → 对应块滚动进视口
    await page.locator('.outline-item').filter({ hasText: '深处标题' }).click()
    await expect.poll(() => page.evaluate(() => {
      const h = document.querySelector('.ed-blocknote')
      const b = Array.from(document.querySelectorAll('.bn-block-content[data-content-type="heading"]'))
        .find((x) => x.textContent?.trim() === '深处标题')
      if (!h || !b) return false
      const hr = h.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return br.top >= hr.top - 40 && br.bottom <= hr.bottom + 40
    })).toBe(true)
  })

  test('双链：点击正文 [[标题]] 弹出交互窗，可跳转关联文章', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)
    const target = await apiCreatePost({ title: '双链目标文章', rawMarkdown: '目标文章正文。' })
    const source = await apiCreatePost({ title: '双链来源文章', rawMarkdown: '见 [[双链目标文章]] 一节。' })
    await page.goto(`${BASE}/posts/${source.id}/edit`)
    await expect(page.locator('.ed-blocknote .bn-editor')).toBeVisible({ timeout: 15_000 })

    // 精确点击 [[ 文本（点击位置在双链文字上即命中）
    const box = await page.evaluate(() => {
      const editor = document.querySelector('.bn-editor')
      if (!editor) return null
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
      let n: Node | null
      while ((n = walker.nextNode())) {
        const text = n.textContent ?? ''
        const i = text.indexOf('[[')
        if (i >= 0) {
          const r = document.createRange()
          r.setStart(n, i)
          r.setEnd(n, Math.min(i + 4, text.length))
          const rect = r.getBoundingClientRect()
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        }
      }
      return null
    })
    expect(box).toBeTruthy()
    await page.mouse.click(box!.x, box!.y)
    const hint = page.locator('.bn-wl-hint')
    await expect(hint).toBeVisible()
    // 目标文章存在 → 打开按钮可用 → 点击跳到对应编辑页
    await expect(hint.locator('.bn-wl-open')).toBeEnabled()
    await hint.locator('.bn-wl-open').click()
    await page.waitForURL(`**/posts/${target.id}/edit`)
  })

  test('冲突：自动保存以本地覆盖服务器并给一次性轻提示（无冲突横幅）', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)
    await page.goto(`${BASE}/posts`)
    await page.getByRole('button', { name: /新建草稿/ }).click()
    const title = page.locator('.ed-paper .ed-canvas-title')
    await expect(title).toBeVisible({ timeout: 15_000 })
    await title.fill('冲突验证文章')
    const id = page.url().match(/\/posts\/([^/]+)\/edit/)?.[1] ?? ''
    expect(id).toBeTruthy()
    await expect(page.locator('.save-state.saved')).toBeVisible({ timeout: 10_000 })

    // 模拟另一会话修改服务器版本 → 本地 baseVersion 过期
    await apiPutPost(id, { title: '外部修改后的标题' })
    // 本地继续编辑 → 自动保存应静默以本地覆盖，仅给一条轻提示
    await title.fill('冲突验证文章v2')
    await expect(page.locator('.save-state.saved')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.ed-note')).toContainText('其他会话')
    // 冲突横幅（旧交互）不复存在
    await expect(page.locator('.ed-conflict')).toHaveCount(0)
  })

  test('重开：以服务器版本为主，本机较新草稿给一次性轻提示（可放弃）', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)
    const p = await apiCreatePost({ title: '服务器为主验证', rawMarkdown: '服务器上的正文。' })
    await page.goto(`${BASE}/posts/${p.id}/edit`)
    await expect(page.locator('.ed-blocknote .bn-editor')).toBeVisible({ timeout: 15_000 })

    // 注入一份较新的本机草稿（保存时间晚于服务器 updatedAt）
    await page.evaluate((pid) => {
      localStorage.setItem(`cl:editdraft:${pid}`, JSON.stringify({
        content: { markdown: '本机未同步的正文。', title: '本机草稿标题', fm: {} },
        slug: 'draft-slug',
        baseVersion: null,
        savedAt: Date.now(),
      }))
    }, p.id)
    await page.reload()
    // 服务器为主：画布展示服务器标题，而非本机草稿标题
    await expect(page.locator('.ed-paper .ed-canvas-title')).toHaveValue('服务器为主验证', { timeout: 15_000 })
    await expect(page.locator('.ed-note')).toContainText('未同步草稿')
    // 放弃 → 提示消失且本机草稿被清理
    await page.locator('.ed-note').getByRole('button', { name: '放弃并继续' }).click()
    await expect(page.locator('.ed-note')).toHaveCount(0)
    await expect.poll(() => page.evaluate((pid) => localStorage.getItem(`cl:editdraft:${pid}`), p.id)).toBeNull()
  })
})
