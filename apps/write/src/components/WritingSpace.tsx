/**
 * 写作空间主界面（§8）：三栏布局 + 多文档标签页（类 IDE）+ 防抖自动保存（1s）
 * + baseVersion 冲突处理 + 发布 + 聚焦模式
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type FolderNode, type PostDetail, type PostListItem } from '../api'
import { useAuth } from '../auth'
import { FolderTree } from './FolderTree'
import { Preview } from './Preview'
import { RevisionPanel } from './RevisionPanel'
import { FrontmatterPanel, Outline, type Frontmatter } from './Outline'

// 编辑器按需加载（§12 首包瘦身）：CodeMirror 与 Tiptap 各进独立 chunk，首屏不加载
const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })))
const VisualEditor = lazy(() => import('./VisualEditor').then((m) => ({ default: m.VisualEditor })))

type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict'
type Filter = 'all' | 'blog' | 'note' | 'trashed'
type ViewMode = 'split' | 'source' | 'preview' | 'visual'

interface Content {
  markdown: string
  title: string
  fm: Frontmatter
}

function snap(c: Content): string {
  return JSON.stringify([c.markdown, c.title, c.fm])
}

export function WritingSpace() {
  const { user, logout } = useAuth()
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [posts, setPosts] = useState<PostListItem[]>([])
  const [linkTargets, setLinkTargets] = useState<string[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [activeFolder, setActiveFolder] = useState<string | null>(null)

  // 多文档标签页（§8.1）：打开过的文章 id 集合 + 当前激活
  const [openIds, setOpenIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [post, setPost] = useState<PostDetail | null>(null)

  const [content, setContent] = useState<Content>({ markdown: '', title: '', fm: {} })
  const [baseVersion, setBaseVersion] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [focusMode, setFocusMode] = useState(false)
  const [buildInfo, setBuildInfo] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 最近一次落库/加载时的内容快照：与当前内容不同即视为脏 */
  const savedSnap = useRef('')

  // 🟡W4 修复：用户操作失败的非静默反馈（toast，3s 自动消失）
  const [errorMsg, setErrorMsg] = useState('')
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifyError = (e: unknown, fallback: string) => {
    const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback
    setErrorMsg(msg)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setErrorMsg(''), 3000)
  }

  const patchContent = (patch: Partial<Content>) => {
    setContent((prev) => {
      const next = { ...prev, ...patch }
      if (snap(next) === savedSnap.current) setSaveState('saved')
      else setSaveState('dirty')
      return next
    })
  }

  /* ===== 列表加载 ===== */
  const loadPosts = useCallback(async () => {
    const q = new URLSearchParams()
    if (filter === 'trashed') q.set('status', 'trashed')
    else {
      if (filter !== 'all') q.set('type', filter)
      if (activeFolder) q.set('folderId', activeFolder)
    }
    const r = await api.get<{ items: PostListItem[]; total: number }>(`/posts?${q}`)
    // 回收站内容只在专门的 tab 里出现
    setPosts(filter === 'trashed' ? r.items : r.items.filter((p) => p.status !== 'trashed'))
  }, [filter, activeFolder])

  const loadFolders = useCallback(async () => {
    const r = await api.get<{ tree: FolderNode[] }>('/folders')
    setFolders(r.tree)
  }, [])

  /** 双链补全候选：全部非回收站文章标题 */
  const loadLinkTargets = useCallback(async () => {
    const r = await api.get<{ items: PostListItem[] }>('/posts')
    setLinkTargets(r.items.filter((p) => p.status !== 'trashed').map((p) => p.title))
  }, [])

  useEffect(() => {
    loadPosts().catch(console.error)
  }, [loadPosts])
  useEffect(() => {
    loadFolders().catch(console.error)
    loadLinkTargets().catch(console.error)
  }, [loadFolders, loadLinkTargets])

  /* ===== 打开 / 关闭标签页 ===== */
  const openPost = useCallback(
    async (id: string) => {
      try {
        const p = await api.get<PostDetail>(`/posts/${id}`)
        let fm: Frontmatter = {}
        try {
          fm = JSON.parse(p.frontmatter || '{}')
        } catch {
          fm = {}
        }
        const c: Content = { markdown: p.rawMarkdown, title: p.title, fm }
        setPost(p)
        setActiveId(p.id)
        setOpenIds((ids) => (ids.includes(p.id) ? ids : [...ids, p.id]))
        setContent(c)
        savedSnap.current = snap(c)
        setBaseVersion(new Date(p.updatedAt).getTime().toString())
        setSaveState('saved')
        setBuildInfo('')
      } catch (e) {
        // §15 健壮性：后端错误不应让整个 React 崩溃（黑屏）
        console.error('[openPost]', e)
      }
    },
    [],
  )

  const closeTab = (id: string) => {
    // 🟡W3 修复：setState updater 必须是纯函数。先在外部基于当前 openIds 计算 next，
    // 再统一 setState；异步副作用（openPost）移到 updater 之外，避免 StrictMode 双调用重复拉取。
    const next = openIds.filter((i) => i !== id)
    setOpenIds(next)
    if (id === activeId) {
      const fallback = next[next.length - 1] ?? null
      setActiveId(fallback)
      if (fallback) {
        openPost(fallback).catch(console.error)
      } else {
        setPost(null)
        setContent({ markdown: '', title: '', fm: {} })
        savedSnap.current = ''
        setBaseVersion(null)
      }
    }
  }

  const tabTitle = (id: string): string => {
    if (id === activeId) return content.title || post?.title || '（无标题）'
    return posts.find((p) => p.id === id)?.title ?? '…'
  }

  /* ===== 保存 ===== */
  const doSave = useCallback(
    async (override = false) => {
      if (!post || !baseVersion) return
      setSaveState('saving')
      try {
        const body: Record<string, unknown> = {
          title: content.title || '无标题',
          rawMarkdown: content.markdown,
          frontmatter: { ...content.fm, title: content.title },
        }
        if (!override) body.baseVersion = baseVersion
        const r = await api.put<{ ok: boolean; updatedAt: string; buildId: string | null }>(
          `/posts/${post.id}`,
          body,
        )
        setBaseVersion(new Date(r.updatedAt).getTime().toString())
        savedSnap.current = snap(content)
        setSaveState('saved')
        if (r.buildId) setBuildInfo(`已触发构建 ${r.buildId}`)
        loadPosts().catch(() => {})
        loadLinkTargets().catch(() => {})
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONFLICT') {
          setSaveState('conflict')
        } else {
          setSaveState('dirty')
          console.error(e)
        }
      }
    },
    [post, baseVersion, content, loadPosts, loadLinkTargets],
  )

  // 防抖 1s 自动保存（§8.1）
  useEffect(() => {
    if (!post || saveState !== 'dirty') return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(), 1000)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [content, post, saveState, doSave])

  /* ===== 新建 / 发布 / 删除 ===== */
  const createPost = async (type: 'blog' | 'note', folderId: string | null) => {
    try {
      const title = type === 'note' ? '新建笔记' : '新文章'
      const r = await api.post<{ id: string }>('/posts', {
        type,
        title,
        folderId,
        rawMarkdown: `# ${title}\n\n`,
        frontmatter: {},
        status: 'draft',
      })
      await loadPosts()
      await loadLinkTargets()
      await openPost(r.id)
    } catch (e) {
      // §15 健壮性：后端错误不应让整个 React 崩溃
      console.error('[createPost]', e)
      notifyError(e, '创建文章失败')
    }
  }

  const publish = async () => {
    if (!post) return
    try {
      if (saveState === 'dirty') await doSave()
      const next = post.status === 'published' ? 'draft' : 'published'
      const r = await api.put<{ buildId: string | null }>(`/posts/${post.id}`, { status: next })
      await openPost(post.id)
      setBuildInfo(next === 'published' ? `已发布，构建任务 ${r.buildId ?? '—'}` : '已转为草稿')
      loadPosts().catch(() => {})
    } catch (e) {
      notifyError(e, '发布/撤销发布失败')
    }
  }

  const trash = async () => {
    if (!post) return
    try {
      await api.del(`/posts/${post.id}`)
      closeTab(post.id)
      loadPosts().catch(() => {})
      loadLinkTargets().catch(() => {})
    } catch (e) {
      notifyError(e, '删除文章失败')
    }
  }

  const createFolder = async (name: string, parentId: string | null) => {
    try {
      await api.post('/folders', { name, parentId })
      loadFolders().catch(() => {})
    } catch (e) {
      notifyError(e, '创建文件夹失败')
    }
  }

  /* ===== 树拖拽移动（§8.1 / N11） ===== */
  const moveFolder = async (folderId: string, parentId: string | null) => {
    try {
      await api.put(`/folders/${folderId}`, { parentId })
      loadFolders().catch(() => {})
    } catch (e) {
      console.error(e)
      notifyError(e, '移动文件夹失败')
    }
  }

  const movePost = async (postId: string, folderId: string | null) => {
    try {
      await api.put(`/posts/${postId}`, { folderId })
      loadPosts().catch(() => {})
    } catch (e) {
      console.error(e)
      notifyError(e, '移动文章失败')
    }
  }

  /* ===== 渲染 ===== */
  return (
    <div className="ws" data-zone="write">
      <header className="topbar">
        <div className="brand">
          云笺集 <span className="brand-sub">写作空间</span>
        </div>
        {post && (
          <>
            <input
              className="title-input"
              value={content.title}
              onChange={(e) => patchContent({ title: e.target.value })}
              placeholder="文章标题"
            />
            <span className={`save-state ${saveState}`}>
              {saveState === 'saved' && '已保存'}
              {saveState === 'dirty' && '未保存…'}
              {saveState === 'saving' && '保存中…'}
              {saveState === 'conflict' && '⚠ 冲突'}
            </span>
            <button className="btn" onClick={publish}>
              {post.status === 'published' ? '转为草稿' : '发布'}
            </button>
            <button className="btn" onClick={() => setShowHistory(true)}>
              历史
            </button>
            <button className="btn danger" onClick={trash}>
              删除
            </button>
          </>
        )}
        <div className="spacer" />
        <span className="user-chip">{user?.email}</span>
        <button className="btn" onClick={logout}>
          退出
        </button>
      </header>

      {saveState === 'conflict' && (
        <div className="conflict-bar">
          该文章已在其他会话被修改。
          <button className="btn warn" onClick={() => doSave(true)}>
            以本地为准覆盖
          </button>
          <button className="btn" onClick={() => activeId && openPost(activeId)}>
            加载服务器版本
          </button>
        </div>
      )}

      {errorMsg && <div className="ws-toast" role="alert">{errorMsg}</div>}

      <div className="ws-body">
        <FolderTree
          folders={folders}
          posts={posts}
          activeFolder={activeFolder}
          onSelectFolder={setActiveFolder}
          activePostId={activeId}
          onSelectPost={(id) => openPost(id).catch(console.error)}
          onCreateFolder={createFolder}
          onCreatePost={(t, f) => createPost(t, f).catch(console.error)}
          onMoveFolder={moveFolder}
          onMovePost={movePost}
          filter={filter}
          onFilterChange={setFilter}
        />

        <main className="center">
          {openIds.length > 0 && (
            <div className="doc-tabs">
              {openIds.map((id) => (
                <div key={id} className={`doc-tab ${id === activeId ? 'active' : ''}`}>
                  <span className="doc-tab-title" onClick={() => openPost(id).catch(console.error)}>
                    {tabTitle(id)}
                  </span>
                  <span className="doc-tab-close" title="关闭" onClick={() => closeTab(id)}>
                    ×
                  </span>
                </div>
              ))}
            </div>
          )}
          {post ? (
            <>
              <div className="mode-tabs">
                {(['split', 'source', 'preview', 'visual'] as const).map((m) => (
                  <button key={m} className={viewMode === m ? 'active' : ''} onClick={() => setViewMode(m)}>
                    {m === 'split' ? '分屏' : m === 'source' ? '源码' : m === 'preview' ? '预览' : '可视化'}
                  </button>
                ))}
                <button
                  className={focusMode ? 'active focus-btn' : 'focus-btn'}
                  title="聚焦模式：仅当前段落明亮"
                  onClick={() => setFocusMode((v) => !v)}
                >
                  聚焦
                </button>
                {buildInfo && <span className="build-info">{buildInfo}</span>}
              </div>
              <div className={`center-panes ${viewMode} ${focusMode ? 'focus' : ''}`}>
                <Suspense fallback={<div className="editor-loading">编辑器载入中…</div>}>
                  {viewMode === 'visual' ? (
                    <div className="pane editor-pane visual-pane">
                      <VisualEditor
                        markdown={content.markdown}
                        onChange={(v) => patchContent({ markdown: v })}
                      />
                    </div>
                  ) : (
                    <>
                      {viewMode !== 'preview' && (
                        <div className="pane editor-pane">
                          <Editor
                            value={content.markdown}
                            onChange={(v) => patchContent({ markdown: v })}
                            getLinkTargets={() => linkTargets}
                            focusMode={focusMode}
                          />
                        </div>
                      )}
                      {viewMode !== 'source' && !focusMode && (
                        <div className="pane preview-pane">
                          <Preview markdown={content.markdown} />
                        </div>
                      )}
                    </>
                  )}
                </Suspense>
              </div>
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-title">选择或创建一篇文章</div>
              <p>源码模式是一等公民；富块（接口/参数表/提示框/双链）直接用 Markdown 语法书写，右侧即时预览。</p>
              <p className="welcome-tip">粘贴接口片段 / 参数表格 / GFM 警告块会自动转成结构化块；输入 `[[` 可补全双链。</p>
            </div>
          )}
        </main>

        <aside className="right-pane">
          {post && <FrontmatterPanel fm={content.fm} onChange={(fm) => patchContent({ fm })} />}
          <Outline markdown={content.markdown} />
        </aside>
      </div>

      {showHistory && post && (
        <RevisionPanel
          postId={post.id}
          currentMarkdown={content.markdown}
          onRestored={(md) => {
            patchContent({ markdown: md })
            setShowHistory(false)
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
