/**
 * 文章编辑页（写作空间并入工作台后的编辑视图，编辑内核 = BlockNote：ProseMirror/Tiptap 内核的 Notion 式块编辑器）：
 * 打开 PostsPage 列表中的文章进入本页；/posts/new 新建草稿后跳转。
 * - 格式入口三层：顶部常驻工具栏（EditorToolbar）+ 斜杠菜单(/) + 选中浮动工具栏；[[ 唤起双链补全
 * - 标题在画布内（Notion 式首行大字），纸面画布 + 阅读宽度；右栏自上而下：文档信息（可折叠）/ 大纲统计 / 双链
 * - 保存：防抖 1s 自动保存 + 顶栏手动「保存」按钮 + Ctrl/Cmd+S + 路由切换（卸载）时 flush
 * - 保存策略（本地为主）/ 离线草稿 / 本地快照兜底由 useEditorSave hook 收敛（见 useEditorSave.ts）
 * - 重开策略（服务器为主）：始终加载服务器版本；本机存在较新未同步草稿时给一次性轻提示，可恢复或放弃
 * - baseVersion 乐观锁；图片粘贴/拖拽/上传统一走 /uploads（客户端先压缩略图，见 lib/image.ts）
 * - 右栏文档信息：分类下拉 / 标签下拉多选（可搜索·可新建）/ 摘要 / 封面 / Slug
 */
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, uploadImage, type Category, type PostDetail } from '../api'
import { useToast } from '../components/framework/Toast'
import { EmptyState } from '../components/framework/EmptyState'
import { confirmDialog } from '../components/framework/Modal'
import { Icon } from '../components/framework/Icon'
import { clearDraft, isOnline, loadDraft } from '../lib/offline'
import { pickStaleLocalDraft } from '../lib/savePolicy'
import { compressImage } from '../lib/image'
import { EdNotice, NOTICE_AUTO_CLOSE_MS } from '../components/editor/EdNotice'
import { ExportMenu } from '../components/editor/ExportMenu'
import { useEditorSave, snap, type EditorContent } from '../components/editor/useEditorSave'
import { RevisionPanel } from '../components/editor/RevisionPanel'
import { EdSideMeta, Outline, WikiLinks, type Frontmatter } from '../components/editor/Outline'
// BlockNote 体积大（ProseMirror 全家桶），独立 chunk 按需加载
const BlockNoteEditor = lazy(() => import('../components/editor/BlockNoteEditor').then((m) => ({ default: m.BlockNoteEditor })))

export function EditorPage() {
  const nav = useNavigate()
  const { id } = useParams<{ id: string }>()
  const toast = useToast()

  const [post, setPost] = useState<PostDetail | null>(null)
  const [loading, setLoading] = useState(true)
  /** 双链候选：{ id, title }，[[ 补全与双链跳转共用 */
  const [linkTargets, setLinkTargets] = useState<Array<{ id: string; title: string }>>([])
  const [categories, setCategories] = useState<Category[]>([])
  /** 全站标签名（右栏标签多选候选） */
  const [tagNames, setTagNames] = useState<string[]>([])
  const [content, setContent] = useState<EditorContent>({ markdown: '', title: '', fm: {} })
  const [slug, setSlug] = useState('')
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  /** 右栏（文档信息/大纲）显隐：写作时可收起获得沉浸画布，记忆在 localStorage */
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('cl_ed_side') !== '0')
  const [showHistory, setShowHistory] = useState(false)

  /** 保存会话（保存策略/离线草稿/快捷键/notice 状态在此闭环，页面只做组合） */
  const {
    savedSnap, saveState, online, notice,
    setSaveState, setNotice, setOnline,
    doSave, doSaveRef,
  } = useEditorSave({
    post, content, slug, baseVersion, categories, setSlug, setBaseVersion, toast,
  })

  const patchContent = (patch: Partial<EditorContent>) => {
    setContent((prev) => {
      const next = { ...prev, ...patch }
      setSaveState(snap(next) === savedSnap.current ? 'saved' : 'dirty')
      return next
    })
  }

  /* ===== 加载（重开以服务器为主） ===== */
  const loadPost = useCallback(async (postId: string) => {
    const p = await api.get<PostDetail>(`/posts/${postId}`)
    let fm: Frontmatter = {}
    try {
      fm = JSON.parse(p.frontmatter || '{}')
    } catch {
      fm = {}
    }
    // 元数据优先来自结构化字段，frontmatter 仅作补充
    const c: EditorContent = {
      markdown: p.rawMarkdown,
      title: p.title,
      fm: { ...fm, category: fm.category ?? p.category?.name ?? '', tags: fm.tags ?? p.tags },
    }
    setPost(p)
    setContent(c)
    setSlug(p.slug)
    savedSnap.current = snap(c)
    setBaseVersion(new Date(p.updatedAt).getTime())
    setSaveState('saved')
    // 本机较新草稿只给一次性轻提示（可恢复/放弃），不再弹恢复横幅；其余快照直接清理
    const d = loadDraft(postId)
    const stale = pickStaleLocalDraft(new Date(p.updatedAt).getTime(), d)
    if (stale && snap(stale.content) !== snap(c)) setNotice({ kind: 'stale-draft', draft: stale })
    else if (d) clearDraft(postId)
  }, [savedSnap, setSaveState, setNotice])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    loadPost(id)
      .catch((e) => {
        const d = loadDraft(id)
        // 断网/网络失败 + 有本地草稿 → 离线降级进入编辑，重连后自动同步
        if (d && (e instanceof TypeError || !isOnline())) {
          setContent(d.content)
          setSlug(d.slug)
          setBaseVersion(d.baseVersion)
          setPost({
            id, title: d.content.title, slug: d.slug, status: 'draft', summary: '',
            rawMarkdown: d.content.markdown, frontmatter: '{}', categoryId: null, category: null,
            tags: [], createdAt: '', updatedAt: new Date().toISOString(), publishedAt: null,
          } as PostDetail)
          savedSnap.current = ''
          setSaveState('dirty')
          setOnline(false)
          setNotice({ kind: 'offline' })
        } else {
          toast(e instanceof ApiError ? e.message : '载入文章失败', 'err')
        }
      })
      .finally(() => setLoading(false))
    // 双链候选：全部文章标题（带 id 供双链跳转）
    api.get<{ items: PostDetail[] }>('/posts')
      .then((r) => setLinkTargets(r.items.map((p) => ({ id: p.id, title: p.title }))))
      .catch(() => {})
    api.get<{ items: Category[] }>('/categories')
      .then((r) => setCategories(r.items))
      .catch(() => {})
    api.get<{ items: Array<{ id: string; name: string }> }>('/tags')
      .then((r) => setTagNames(r.items.map((t) => t.name)))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  /* ===== 提示条动作 ===== */
  const closeNotice = useCallback(() => {
    setNotice((n) => {
      if (n?.kind === 'stale-draft' && id) clearDraft(id) // 到点未处理/手动放弃 → 服务器为主，清掉本机快照
      return null
    })
  }, [id, setNotice])

  /** 恢复本机较新草稿：覆盖当前编辑内容并立即落库 */
  const restoreLocalDraft = () => {
    if (notice?.kind !== 'stale-draft') return
    const d = notice.draft
    setContent(d.content)
    setSlug(d.slug)
    setBaseVersion(d.baseVersion)
    savedSnap.current = ''
    setSaveState('dirty')
    if (id) clearDraft(id)
    setNotice(null)
    if (isOnline()) void doSaveRef.current('manual')
  }

  /* ===== 图片上传（粘贴 / 工具栏上传按钮，封面共用同一压缩链路） ===== */
  const handlePasteImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const blob = await compressImage(file)
      const r = await uploadImage(blob)
      toast(`图片已上传（${(r.bytes / 1024).toFixed(0)} KB）`)
      return r.url
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '图片上传失败', 'err')
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 封面上传（右栏属性面板）：与正文图片同一压缩/上传链路，成功后写回 frontmatter.cover */
  const handleCoverUpload = useCallback(async (file: File): Promise<string | null> => {
    try {
      const blob = await compressImage(file)
      const r = await uploadImage(blob)
      return r.url
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '封面上传失败', 'err')
      return null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 右栏新建分类：落库（同步到「分类标签」菜单）并刷新全站分类候选 */
  const handleCreateCategory = useCallback(async (name: string) => {
    try {
      const c = await api.post<Category>('/categories', { name })
      setCategories((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]))
      toast(`已创建分类「${c.name}」`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '创建分类失败', 'err')
      throw e
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 双链点击：按标题反查文章并跳编辑页 */
  const openWikilink = useCallback((target: string) => {
    const name = target.split('|')[0].trim()
    const hit = linkTargets.find((t) => t.title === name)
    if (hit && hit.id !== post?.id) nav(`/posts/${hit.id}/edit`)
    else if (hit) toast('就是当前这篇文章')
    else toast(`未找到「${name}」对应的文章`, 'err')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTargets, post?.id])

  /** 大纲点击跳转：按标题文本定位正文中的标题块（引用内标题无块锚点时忽略） */
  const jumpToHeading = useCallback((text: string) => {
    const blocks = document.querySelectorAll<HTMLDivElement>('.bn-block-content[data-content-type="heading"]')
    for (const b of blocks) {
      if ((b.textContent ?? '').trim() === text) {
        b.scrollIntoView({ block: 'center' })
        return
      }
    }
  }, [])

  /** 大纲首条（文章大标题）点击：回到画布开头并聚焦标题 */
  const jumpToTitle = useCallback(() => {
    document.querySelector('.ed-blocknote')?.scrollTo({ top: 0 })
    document.querySelector<HTMLInputElement>('.ed-canvas-title')?.focus()
  }, [])

  /* ===== 发布 / 删除（发布=对访客公开；转为草稿=撤回，仅自己可见） ===== */
  const publish = async () => {
    if (!post) return
    if (saveState === 'dirty') {
      const ok = await doSave('manual')
      if (!ok) return // 保存失败一律中止
      if (savedSnap.current !== snap(content)) return
    }
    try {
      const next = post.status === 'published' ? 'draft' : 'published'
      await api.put<{ ok: boolean; status: string; updatedAt: string }>(`/posts/${post.id}`, { status: next })
      toast(next === 'published' ? '已发布' : '已转为草稿')
      await loadPost(post.id)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '发布/撤销发布失败', 'err')
    }
  }

  const trash = async () => {
    if (!post) return
    if (!(await confirmDialog({ title: '删除文章', description: `确定删除「${post.title}」？此操作不可恢复。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/posts/${post.id}`)
      toast('已删除')
      nav('/posts')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '删除文章失败', 'err')
    }
  }

  if (loading) return <EmptyState variant="hero" style={{ paddingTop: 120 }}>载入文章中…</EmptyState>
  if (!post) return <EmptyState variant="hero" style={{ paddingTop: 120 }}>文章不存在或已被删除</EmptyState>

  return (
    <div className="ed-page">
      <div className="ed-topbar">
        <button className="btn slim ghost" onClick={() => nav('/posts')} title="返回文章列表">← 返回</button>
        <span className={`save-state ${saveState}`}>
          {saveState === 'saved' && '✓ 已保存'}
          {saveState === 'dirty' && (online ? '未保存…' : '未保存（离线·已存本机）')}
          {saveState === 'saving' && '保存中…'}
        </span>
        <span className={`pill ${post.status === 'published' ? 'ok' : 'warn'}`}>
          {post.status === 'published' ? '已发布' : '草稿'}
        </span>
        <div className="spacer" />
        <ExportMenu
          meta={{
            title: content.title || '无标题',
            summary: content.fm.summary,
            category: content.fm.category,
            tags: content.fm.tags,
            cover: content.fm.cover,
            date: post.publishedAt || post.updatedAt,
          }}
          markdown={content.markdown}
        />
        <button
          className="btn slim"
          onClick={() => { void doSaveRef.current('manual') }}
          title="手动保存（Ctrl / ⌘ + S）· 历史中必留快照"
        >
          保存
        </button>
        <button
          className="btn slim"
          onClick={publish}
          title={post.status === 'published' ? '转为草稿：撤回发布，文章仅自己可见' : '发布：文章对访客公开可见'}
        >
          {post.status === 'published' ? '转为草稿' : '发布'}
        </button>
        <button className="btn slim ghost" onClick={() => setShowHistory(true)}>历史</button>
        <button className="btn slim ghost danger-ghost" onClick={trash}>删除</button>
        <button
          className={`btn slim ghost icon-only${sideOpen ? ' on' : ''}`}
          onClick={() => {
            const next = !sideOpen
            setSideOpen(next)
            localStorage.setItem('cl_ed_side', next ? '1' : '0')
          }}
          title={sideOpen ? '收起信息栏' : '展开信息栏'}
        >
          <Icon name="panelFold" size={16} />
        </button>
      </div>

      {notice?.kind === 'conflict-saved' && (
        <EdNotice onClose={closeNotice}>
          检测到其他会话修改了这篇文章，已按「本地为主」用当前内容覆盖保存。
        </EdNotice>
      )}
      {notice?.kind === 'stale-draft' && (
        <EdNotice
          onClose={closeNotice}
          autoCloseMs={NOTICE_AUTO_CLOSE_MS['stale-draft']}
          actions={<>
            <button className="btn slim warn" onClick={restoreLocalDraft}>恢复本机草稿</button>
            <button className="btn slim" onClick={closeNotice}>放弃并继续</button>
          </>}
        >
          本机存有较新的未同步草稿（{new Date(notice.draft.savedAt).toLocaleString()}），当前展示的是服务器版本。
        </EdNotice>
      )}
      {notice?.kind === 'offline' && (
        <EdNotice onClose={closeNotice}>网络不可用：正在离线编辑本机草稿，恢复网络后自动保存。</EdNotice>
      )}

      <div className="ed-body" data-side={sideOpen ? 'open' : 'closed'}>
        <div className="ed-main">
          <div className="ed-paper">
            <input
              className="ed-canvas-title"
              value={content.title}
              onChange={(e) => patchContent({ title: e.target.value })}
              placeholder="无标题"
              maxLength={200}
            />
            <Suspense fallback={<div className="ed-loading">编辑器载入中…</div>}>
              <BlockNoteEditor
                key={post.id}
                value={content.markdown}
                onChange={(v) => patchContent({ markdown: v })}
                onPasteImage={handlePasteImage}
                wikilinkTargets={linkTargets}
                onOpenWikilink={openWikilink}
                currentTitle={content.title}
                notify={(message, kind) => toast(message, kind)}
              />
            </Suspense>
          </div>
        </div>

        {sideOpen && (
          <aside className="ed-side">
            <EdSideMeta
              fm={content.fm}
              slug={slug}
              onSlugChange={setSlug}
              onChange={(fm) => patchContent({ fm })}
              categories={categories.map((c) => ({ id: c.id, name: c.name }))}
              tagSuggestions={tagNames}
              onUploadCover={handleCoverUpload}
              onCreateCategory={handleCreateCategory}
            />
            <Outline
              markdown={content.markdown}
              title={content.title}
              onTitleClick={jumpToTitle}
              onItemClick={jumpToHeading}
            />
            <WikiLinks
              markdown={content.markdown}
              currentTitle={content.title}
              onOpen={openWikilink}
            />
          </aside>
        )}
      </div>

      {showHistory && (
        <RevisionPanel
          postId={post.id}
          currentMarkdown={content.markdown}
          onRestored={(md) => {
            patchContent({ markdown: md })
            setShowHistory(false)
            toast('已恢复到所选版本（自动保存将落库）')
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}

/** /posts/new：创建草稿后直接进入编辑页 */
export function NewPostPage() {
  const nav = useNavigate()
  const toast = useToast()
  useEffect(() => {
    let alive = true
    api.post<{ id: string }>('/posts', { title: '无标题', rawMarkdown: '', status: 'draft' })
      .then((r) => { if (alive) nav(`/posts/${r.id}/edit`, { replace: true }) })
      .catch((e) => {
        toast(e instanceof ApiError ? e.message : '创建文章失败', 'err')
        nav('/posts', { replace: true })
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <EmptyState variant="hero" style={{ paddingTop: 120 }}>正在创建草稿…</EmptyState>
}