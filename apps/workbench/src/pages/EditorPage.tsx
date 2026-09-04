/**
 * 文章编辑页（写作空间并入工作台后的编辑视图，编辑内核 = BlockNote：ProseMirror/Tiptap 内核的 Notion 式块编辑器）：
 * 打开 PostsPage 列表中的文章进入本页；/posts/new 新建草稿后跳转。
 * - 现代交互范式：无鼠标工具栏，格式入口 = 斜杠菜单(/) / 选中浮动工具栏 / 块拖拽菜单；[[ 唤起双链补全
 * - 标题在画布内（Notion 式首行大字），纸面画布 + 阅读宽度；右栏属性面板可收起（cl_ed_side）
 * - 导出：Markdown / 自包含 HTML / 打印·PDF（见 lib/exporters.ts）
 * - 防抖 1s 自动保存 + Ctrl/Cmd+S 手动保存 + 路由切换（卸载）时 flush 一次保存
 * - baseVersion 乐观锁冲突处理；发布前存在未解决冲突即中止（避免静默覆盖他人修改）
 * - 图片粘贴/拖拽/上传统一走 /uploads（客户端先压缩略图：长边 ≤2000px / JPEG q0.85）
 * - 右栏：文档属性（分类下拉/标签chip/封面上传）/ 大纲统计 / 双链列表（点击跳转对应文章）
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
import { EdMetaBar, Outline, WikiLinks, type Frontmatter } from '../components/editor/Outline'
import { clearDraft, isOnline, loadDraft, saveDraft, subscribeNetwork, type EditorDraft } from '../lib/offline'
// BlockNote 体积大（ProseMirror 全家桶），独立 chunk 按需加载
const BlockNoteEditor = lazy(() => import('../components/editor/BlockNoteEditor').then((m) => ({ default: m.BlockNoteEditor })))

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict'

interface Content {
  markdown: string
  title: string
  fm: Frontmatter
}

function snap(c: Content): string {
  return JSON.stringify([c.markdown, c.title, c.fm])
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
  /** 全站标签名（右栏标签 chip 候选） */
  const [tagNames, setTagNames] = useState<string[]>([])
  const [content, setContent] = useState<Content>({ markdown: '', title: '', fm: {} })
  const [slug, setSlug] = useState('')
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [showHistory, setShowHistory] = useState(false)
  /** 右栏（属性/大纲）显隐：写作时可收起获得沉浸画布，记忆在 localStorage */
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('cl_ed_side') !== '0')
  /** 在线状态（离线时本地草稿兜底，重连自动同步） */
  const [online, setOnline] = useState(isOnline)
  /** 本地草稿恢复条：'newer'=服务器版本比本地旧；'offline'=断网时在离线编辑中 */
  const [restoreBar, setRestoreBar] = useState<null | { kind: 'newer' | 'offline'; draft: EditorDraft }>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 最近一次落库/加载时的内容快照：与当前内容不同即视为脏 */
  const savedSnap = useRef('')

  const patchContent = (patch: Partial<Content>) => {
    setContent((prev) => {
      const next = { ...prev, ...patch }
      setSaveState(snap(next) === savedSnap.current ? 'saved' : 'dirty')
      return next
    })
  }

  /* ===== 加载 ===== */
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
    // 本地草稿兜底检测：快照比服务器新且内容不同 → 提示恢复；否则清理无用快照
    const d = loadDraft(postId)
    if (d && d.savedAt > new Date(p.updatedAt).getTime() && snap(d.content) !== snap(c)) {
      setRestoreBar({ kind: 'newer', draft: d })
    } else if (d) {
      clearDraft(postId)
    }
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
          setRestoreBar({ kind: 'offline', draft: d })
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

  /* ===== 保存 ===== */
  const doSave = useCallback(
    async (override = false): Promise<boolean> => {
      if (!post || baseVersion === null) return false
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
        if (e instanceof ApiError && e.code === 'CONFLICT') {
          setSaveState('conflict')
          if (override) toast(e.message, 'err')
        } else if (e instanceof TypeError) {
          // 网络层失败（fetch 抛 TypeError）：内容留在本机草稿，重连后自动同步
          setOnline(false)
          setSaveState('dirty')
          toast('网络不可用，改动已保存到本机，恢复网络后自动保存')
        } else {
          setSaveState('dirty')
          toast(e instanceof ApiError ? e.message : '保存失败', 'err')
        }
        return false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [post, baseVersion, content, categories, slug],
  )

  // 防抖 1s 自动保存
  useEffect(() => {
    if (!post || saveState !== 'dirty') return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { doSave().catch(console.error) }, 1000)
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

  // 离线监听：断网瞬间把当前内容落为本地草稿；恢复网络后若有未保存内容立即自动同步
  useEffect(() => {
    const off = subscribeNetwork((onlineNow) => {
      setOnline(onlineNow)
      if (onlineNow) {
        if (saveStateRef.current === 'dirty') void doSaveRef.current()
      } else if (postRef.current) {
        saveDraft(postRef.current.id, { content, slug, baseVersion, savedAt: Date.now() })
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

  // Ctrl/Cmd + S 手动保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void doSaveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 路由切换（SPA 内部跳转）触发卸载：脏内容立即 flush 一次保存
  useEffect(() => () => {
    if (saveStateRef.current === 'dirty') void doSaveRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 脏内容关闭标签页前提醒（beforeunload 兜底）
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'conflict') return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saveState])

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

  /** 双链点击：按标题反查文章并跳编辑页 */
  const openWikilink = useCallback((target: string) => {
    const name = target.split('|')[0].trim()
    const hit = linkTargets.find((t) => t.title === name)
    if (hit && hit.id !== post?.id) nav(`/posts/${hit.id}/edit`)
    else if (hit) toast('就是当前这篇文章')
    else toast(`未找到「${name}」对应的文章`, 'err')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkTargets, post?.id])

  /* ===== 发布 / 删除（冲突时中止，不静默覆盖） ===== */
  const publish = async () => {
    if (!post) return
    if (saveState === 'conflict') {
      toast('当前存在未解决的冲突，请先选择「以本地为准覆盖」或「加载服务器版本」', 'err')
      return
    }
    if (saveState === 'dirty') {
      const ok = await doSave()
      if (!ok) return // 保存失败（含刚转成 conflict）一律中止
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

  /** 恢复本地草稿：覆盖当前编辑内容，随后走自动保存/离线同步 */
  const restoreLocalDraft = () => {
    const bar = restoreBar
    if (!bar) return
    setContent(bar.draft.content)
    setSlug(bar.draft.slug)
    setBaseVersion(bar.draft.baseVersion)
    savedSnap.current = ''
    setSaveState('dirty')
    setRestoreBar(null)
    if (isOnline()) void doSaveRef.current() // 在线则立即落库
  }

  /** 放弃本地草稿：清理快照并保持服务器版本 */
  const discardLocalDraft = () => {
    if (restoreBar && id) clearDraft(id)
    setRestoreBar(null)
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
          {saveState === 'conflict' && '⚠ 冲突'}
        </span>
        <span className={`pill ${post.status === 'published' ? 'ok' : 'warn'}`}>
          {post.status === 'published' ? '已发布' : '草稿'}
        </span>
        <div className="spacer" />
        <ExportMenu
          disabled={saveState === 'conflict'}
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
        <button className="btn slim" onClick={publish} title="Ctrl / ⌘ + S 手动保存">{post.status === 'published' ? '转为草稿' : '发布'}</button>
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

      {saveState === 'conflict' && (
        <div className="ed-conflict">
          该文章已在其他会话被修改。
          <button className="btn slim warn" onClick={() => { doSave(true).catch(console.error) }}>以本地为准覆盖</button>
          <button className="btn slim" onClick={() => { loadPost(post.id).catch(console.error) }}>加载服务器版本</button>
        </div>
      )}

      {restoreBar?.kind === 'newer' && (
        <div className="ed-conflict">
          检测到本机存有较新的未同步草稿（{new Date(restoreBar.draft.savedAt).toLocaleString()}）。
          <button className="btn slim warn" onClick={restoreLocalDraft}>恢复本地草稿</button>
          <button className="btn slim" onClick={discardLocalDraft}>使用服务器版本</button>
        </div>
      )}

      {restoreBar?.kind === 'offline' && (
        <div className="ed-conflict">
          网络不可用：正在离线编辑本机草稿，恢复网络后将自动保存。
        </div>
      )}

      {!online && saveState === 'dirty' && !restoreBar && (
        <div className="ed-conflict">网络不可用：改动已保存在本机，恢复网络后自动同步。</div>
      )}

      {/* 文档信息（紧凑横条）：置于画布上方，不占用右侧编辑空间 */}
      <EdMetaBar
        fm={content.fm}
        slug={slug}
        onSlugChange={setSlug}
        onChange={(fm) => patchContent({ fm })}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        tagSuggestions={tagNames}
        onUploadCover={handleCoverUpload}
      />

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
              />
            </Suspense>
          </div>
        </div>

        {sideOpen && (
          <aside className="ed-side">
            <Outline markdown={content.markdown} />
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
