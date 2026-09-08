/**
 * 文章编辑器 · 保存会话 hook（保存策略/离线草稿/重开取舍/快捷键由本 hook 集中管理）。
 * 页面只保留内容状态与 UI 交互，保存管道（乐观锁覆盖、离线兜底、本地草稿、卸载 flush）在此闭环。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, type Category, type PostDetail } from '../../api'
import type { Frontmatter } from './Outline'
import { clearDraft, isOnline, saveDraft, subscribeNetwork, type EditorDraft } from '../../lib/offline'
import { planSaveFailure } from '../../lib/savePolicy'

export interface EditorContent {
  markdown: string
  title: string
  fm: Frontmatter
}

export type SaveState = 'saved' | 'dirty' | 'saving'

/** 顶部轻提示条（非阻断）：conflict-saved 自动消失；stale-draft 到点未处理视为放弃本机草稿 */
export type EditorNotice =
  | { kind: 'conflict-saved' }
  | { kind: 'stale-draft'; draft: EditorDraft }
  | { kind: 'offline' }

export function snap(c: EditorContent): string {
  return JSON.stringify([c.markdown, c.title, c.fm])
}

interface UseEditorSaveArgs {
  post: PostDetail | null
  content: EditorContent
  slug: string
  /** 乐观锁基准版本（服务器 updatedAt 毫秒）；null=尚未载入 */
  baseVersion: number | null
  categories: Category[]
  setSlug: (v: string) => void
  setBaseVersion: (v: number | null) => void
  toast: (text: string, kind?: 'ok' | 'err') => void
}

export function useEditorSave({
  post, content, slug, baseVersion, categories, setSlug, setBaseVersion, toast,
}: UseEditorSaveArgs) {
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [online, setOnline] = useState(isOnline)
  const [notice, setNotice] = useState<EditorNotice | null>(null)
  /** 最近一次落库/加载时的内容快照：与当前内容不同即视为脏 */
  const savedSnap = useRef('')
  /** 本会话是否已提示过冲突覆盖（只提示第一次） */
  const conflictSeenRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const id = post?.id

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
    if (!post) return
    const t = setTimeout(() => {
      saveDraft(post.id, { content, slug, baseVersion, savedAt: Date.now() })
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, slug, baseVersion, post])

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (saveStateRef.current === 'dirty' || saveStateRef.current === 'saving') void doSaveRef.current('auto')
  }, [])

  // 脏内容关闭标签页前提醒（beforeunload 兜底）
  useEffect(() => {
    if (saveState !== 'dirty' && saveState !== 'saving') return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saveState])

  return {
    savedSnap, saveState, online, notice,
    setSaveState, setOnline, setNotice,
    doSave, doSaveRef, saveStateRef, postRef,
  }
}