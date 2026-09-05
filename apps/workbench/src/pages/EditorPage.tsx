/**
 * 文章编辑页（写作空间并入工作台后的编辑视图，编辑内核 = BlockNote：ProseMirror/Tiptap 内核的 Notion 式块编辑器）：
 * 打开 PostsPage 列表中的文章进入本页；/posts/new 新建草稿后跳转。
 * - 格式入口三层：顶部常驻工具栏（EditorToolbar）+ 斜杠菜单(/) + 选中浮动工具栏；[[ 唤起双链补全
 * - 标题在画布内（Notion 式首行大字），纸面画布 + 阅读宽度；右栏自上而下：文档信息（可折叠）/ 大纲统计 / 双链
 * - 保存：防抖 1s 自动保存 + 顶栏手动「保存」按钮 + Ctrl/Cmd+S + 路由切换（卸载）时 flush
 * - 保存策略（本地为主）：乐观锁冲突自动以本地内容覆盖重试，仅首次给轻提示，不再弹冲突条；
 *   网络层失败落本机草稿，重连自动同步
 * - 重开策略（服务器为主）：始终加载服务器版本；本机存在较新未同步草稿时给一次性轻提示，可恢复或放弃
 * - baseVersion 乐观锁；图片粘贴/拖拽/上传统一走 /uploads（客户端先压缩略图）
 * - 右栏文档信息：分类下拉 / 标签下拉多选（可搜索·可新建）/ 摘要 / 封面 / Slug
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError, uploadImage, type Category, type PostDetail } from '../api'
import { useToast } from '../components/framework/Toast'
import { EmptyState } from '../components/framework/EmptyState'
import { confirmDialog } from '../components/framework/Modal'
import { Icon } from '../components/framework/Icon'
import { exportHtmlFile, exportMarkdownFile, printPost } from '../lib/exporters'
import { RevisionPanel } from '../components/editor/RevisionPanel'
import { EdSideMeta, Outline, WikiLinks, type Frontmatter } from '../components/editor/Outline'
import { clearDraft, isOnline, loadDraft, saveDraft, subscribeNetwork, type EditorDraft } from '../lib/offline'
import { planSaveFailure, pickStaleLocalDraft } from '../lib/savePolicy'
// BlockNote 体积大（ProseMirror 全家桶），独立 chunk 按需加载
const BlockNoteEditor = lazy(() => import('../components/editor/BlockNoteEditor').then((m) => ({ default: m.BlockNoteEditor })))

type SaveState = 'saved' | 'dirty' | 'saving'

interface Content {
  markdown: string
  title: string
  fm: Frontmatter
}

function snap(c: Content): string {
  return JSON.stringify([c.markdown, c.title, c.fm])
}

/** 顶部轻提示条（非阻断）：conflict-saved 自动消失；stale-draft 到点未处理视为放弃本机草稿 */
type EditorNotice =
  | { kind: 'conflict-saved' }
  | { kind: 'stale-draft'; draft: EditorDraft }
  | { kind: 'offline' }

const NOTICE_AUTO_CLOSE_MS: Partial<Record<EditorNotice['kind'], number>> = {
  'conflict-saved': 6000,
  'stale-draft': 12000,
}

/** 客户端缩略图压缩：长边 ≤2000px、JPEG q0.85（GIF 保留动图原样，小图不重压） */
async function compressImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.size < 200 * 1024) return file
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
  if (scale === 1 && (file.type === 'image/jpeg' || file.type === 'image/webp')) return file
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.85))
  return blob ?? file
}

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
  const [content, setContent] = useState<Content>({ markdown: '', title: '', fm: {} })
  const [slug, setSlug] = useState('')
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [showHistory, setShowHistory] = useState(false)
  /** 右栏（文档信息/大纲）显隐：写作时可收起获得沉浸画布，记忆在 localStorage */
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('cl_ed_side') !== '0')
  /** 在线状态（离线时本地草稿兜底，重连自动同步） */
  const [online, setOnline] = useState(isOnline)
  /** 顶部轻提示（非阻断，替代旧的冲突横幅与草稿恢复横幅） */
  const [notice, setNotice] = useState<EditorNotice | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 最近一次落库/加载时的内容快照：与当前内容不同即视为脏 */
  const savedSnap = useRef('')
  /** 本会话是否已提示过冲突覆盖（只提示第一次） */
  const conflictSeenRef = useRef(false)

  const patchContent = (patch: Partial<Content>) => {
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
    const c: Content = {
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
  }, [])

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

  /* ===== 保存（冲突自动以本地覆盖重试，见 savePolicy） =====
   * kind：manual=手动保存（按钮/Ctrl+S/发布前落库，历史必留快照）；auto=自动保存（5s 静默 + 服务端 2 分钟频控） */
  const doSave = useCallback(
    async (kind: 'manual' | 'auto' = 'auto', override = false): Promise<boolean> => {
      if (!post || baseVersion === null) return false
      // 内容与最近一次落库一致：无需请求（保存按钮始终可点，点了也只是确认状态）
      if (!override && snap(content) === savedSnap.current) {
        setSaveState('saved')
        return true
      }
      setSaveState('saving')
      // frontmatter.category（名称）→ categoryId；未知名称置空（后端会同步删除文件 frontmatter 中的分类）
      const catName = (content.fm.category ?? '').trim()
      const categoryId = catName ? categories.find((c) => c.name === catName)?.id ?? '' : ''
      const body: Record<string, unknown> = {
        title: content.title || '无标题',
        slug,
        summary: content.fm.summary ?? '',
        rawMarkdown: content.markdown,
        categoryId,
        tags: content.fm.tags ?? [],
        cover: content.fm.cover ?? '',
        revisionKind: kind,
      }
      if (!override) body.baseVersion = baseVersion
      try {
        const r = await api.put<{ ok: boolean; status: string; slug: string; updatedAt: string }>(
          `/posts/${post.id}`,
          body,
        )
        setSlug(r.slug)
        setBaseVersion(new Date(r.updatedAt).getTime())
        savedSnap.current = snap(content)
        setSaveState('saved')
        clearDraft(post.id) // 落库成功：本地兜底快照使命完成
        return true
      } catch (e) {
        const plan = planSaveFailure(e, { alreadyOverridden: override })
        if (plan.kind === 'retry-override') {
          if (!conflictSeenRef.current) {
            conflictSeenRef.current = true
            setNotice({ kind: 'conflict-saved' })
          }
          return doSave(kind, true) // 本地为主：覆盖重试（覆盖保存不带 baseVersion，不会再冲突）
        }
        if (plan.kind === 'offline') {
          // 网络层失败（fetch 抛 TypeError）：内容留在本机草稿，重连后自动同步
          setOnline(false)
          setSaveState('dirty')
          toast('网络不可用，改动已保存到本机，恢复网络后自动保存')
          return false
        }
        setSaveState('dirty')
        toast(e instanceof ApiError ? e.message : '保存失败', 'err')
        return false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [post, baseVersion, content, categories, slug],
  )

  // 自动保存：5s 静默防抖（每次输入都会重置计时，连续编辑不落库；停手 5s 后保存）
  useEffect(() => {
    if (!post || saveState !== 'dirty') return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { doSave('auto').catch(console.error) }, 5000)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [content, slug, post, saveState, doSave])

  // 最新 doSave/saveState/post 的 ref：供快捷键、卸载 flush 与断网监听使用（避免闭包过期）
  const doSaveRef = useRef(doSave)
  doSaveRef.current = doSave
  const saveStateRef = useRef(saveState)
  saveStateRef.current = saveState
  const postRef = useRef(post)
  postRef.current = post

  // 离线监听：断网瞬间落本地草稿并提示；恢复网络后清掉离线提示并自动同步
  useEffect(() => {
    const off = subscribeNetwork((onlineNow) => {
      setOnline(onlineNow)
      if (onlineNow) {
        setNotice((n) => (n?.kind === 'offline' ? null : n))
        if (saveStateRef.current === 'dirty') void doSaveRef.current('auto')
      } else if (postRef.current) {
        saveDraft(postRef.current.id, { content, slug, baseVersion, savedAt: Date.now() })
        setNotice((n) => (n && n.kind !== 'offline' ? n : { kind: 'offline' }))
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, slug, baseVersion])

  // 本地草稿兜底：内容变化 600ms 后持续刷新快照（断网/崩溃/强关标签页都不丢字）
  useEffect(() => {
    if (!post || !id) return
    const t = setTimeout(() => {
      saveDraft(id, { content, slug, baseVersion, savedAt: Date.now() })
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, slug, baseVersion, post, id])

  // Ctrl/Cmd + S 手动保存（历史必留快照）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void doSaveRef.current('manual')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 路由切换（SPA 内部跳转）触发卸载：脏内容立即 flush 一次保存（冲突策略保证本地覆盖成功）
  useEffect(() => () => {
    if (saveStateRef.current === 'dirty' || saveStateRef.current === 'saving') void doSaveRef.current('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 脏内容关闭标签页前提醒（beforeunload 兜底）
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'saving') return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saveState])

  /* ===== 提示条动作 ===== */
  const closeNotice = useCallback(() => {
    setNotice((n) => {
      if (n?.kind === 'stale-draft' && id) clearDraft(id) // 到点未处理/手动放弃 → 服务器为主，清掉本机快照
      return null
    })
  }, [id])

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

  /* ===== 图片上传（粘贴 / 工具栏上传按钮） ===== */
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

/** 编辑页顶部轻提示条：非阻断、可关闭、可选自动消失（替代旧的冲突/草稿横幅） */
function EdNotice({ children, actions, onClose, autoCloseMs }: {
  children: React.ReactNode
  actions?: React.ReactNode
  onClose?: () => void
  autoCloseMs?: number
}) {
  useEffect(() => {
    if (!onClose || !autoCloseMs) return
    const t = setTimeout(onClose, autoCloseMs)
    return () => clearTimeout(t)
  }, [onClose, autoCloseMs])
  return (
    <div className="ed-note">
      <span className="ed-note-text">{children}</span>
      {actions && <span className="ed-note-ops">{actions}</span>}
      {onClose && <button className="ed-note-x" onClick={onClose} title="关闭">✕</button>}
    </div>
  )
}

/** 顶栏导出菜单：Markdown / 自包含 HTML / 打印·PDF */
function ExportMenu({ meta, markdown, disabled }: {
  meta: Parameters<typeof exportMarkdownFile>[0]
  markdown: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const run = (fn: () => void) => { setOpen(false); try { fn() } catch (e) { console.error(e) } }
  return (
    <div className="ed-export">
      <button className="btn slim ghost" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <Icon name="download" size={15} /> 导出 <span className="ed-export-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="ed-export-mask" onClick={() => setOpen(false)} />
          <div className="ed-export-menu">
            <button onClick={() => run(() => exportMarkdownFile(meta, markdown))}>
              <b>Markdown</b><em>.md 原文，零转换</em>
            </button>
            <button onClick={() => run(() => exportHtmlFile(meta, markdown))}>
              <b>HTML 文件</b><em>自包含网页，可分享/存档</em>
            </button>
            <button onClick={() => run(() => printPost(meta, markdown))}>
              <b>打印 · PDF</b><em>经系统打印另存为 PDF</em>
            </button>
          </div>
        </>
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
