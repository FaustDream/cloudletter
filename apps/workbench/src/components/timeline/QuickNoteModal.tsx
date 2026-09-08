/**
 * 速记停靠面板（Auto-hide Docking）：
 * - 把手常驻屏幕边缘（右侧 / 底部，双击把手切换停靠边并记忆），面板从停靠边滑入滑出
 * - 鼠标移入把手/面板展开；移出 600ms 后自动收起（焦点在面板内时不收起，防打字被打断）
 *   点击面板外也收起；Ctrl/⌘+N 唤起、Esc 收起、保存成功自动收起
 * - 编辑器首次展开后保持挂载（草稿不丢），收起仅视觉隐藏；保存后重置草稿
 * - 灵感 = 灵感笔记（与文章共用分类/标签，Notion 式下拉，可搜索新建）；
 *   计划 = 直接进今日计划（PlanItem：紧急度 level / 完成时间 dueDate / 标题 text / 详情 note）
 * - 经 experience 开关决定 XP 文案
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type Category, type NoteType } from '../../api'
import { useToast } from '../framework/Toast'
import { Dropdown } from '../framework/Dropdown'
import { TagMultiSelect } from '../editor/TagMultiSelect'
import { MarkdownEditor } from '../editor/MarkdownEditor'
import { resolveCategoryIdByName } from '../../lib/taxonomy'
import { readGamePrefs } from '../../lib/gamePrefs'

/** 速记模式：灵感 | 计划 */
const NOTE_TYPES: Array<[string, string]> = [['inspiration', '💡 灵感'], ['plan', '📋 计划']]

/** 停靠边记忆（localStorage） */
const DOCK_SIDE_KEY = 'cl_dock_side'
type DockSide = 'right' | 'bottom'
const readDockSide = (): DockSide => (localStorage.getItem(DOCK_SIDE_KEY) === 'bottom' ? 'bottom' : 'right')

const LEVELS = [
  { value: 'P0', label: 'P0 · 紧急' },
  { value: 'P1', label: 'P1 · 重要' },
  { value: 'P2', label: 'P2 · 一般' },
  { value: 'P4', label: 'P4 · 不紧急' },
]

export function QuickNoteModal({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false)
  /** 首次展开后编辑器常挂载（收起仅视觉隐藏，草稿不丢） */
  const [everOpened, setEverOpened] = useState(false)
  const [side, setSide] = useState<DockSide>(readDockSide)
  const [type, setType] = useState<NoteType>('inspiration')
  // 灵感表单（非受控编辑器：value 仅初值，编辑内容不回灌，杜绝"打字变撤销/丢字"）
  const [text, setText] = useState('')
  const [tagNames, setTagNames] = useState<string[]>(['灵感'])
  const [categoryName, setCategoryName] = useState<string>('')
  const [tagPool, setTagPool] = useState<string[]>([])
  const [cats, setCats] = useState<Category[]>([])
  // 计划表单（直接进今日计划）
  const [planTitle, setPlanTitle] = useState('')
  const [planNote, setPlanNote] = useState('')
  const [level, setLevel] = useState('P1')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  /** 草稿轮次：保存后 +1 重挂载编辑器，换一份干净草稿 */
  const [draftEpoch, setDraftEpoch] = useState(0)
  const toast = useToast()
  const panelRef = useRef<HTMLDivElement>(null)
  const hideTimer = useRef<number | undefined>(undefined)

  // 展开时补齐分类/标签下拉数据（灵感笔记默认「灵感」分类与标签）
  useEffect(() => {
    if (!everOpened) return
    api.get<{ items: Category[] }>('/categories').then((r) => {
      setCats(r.items)
      setCategoryName((v) => v || (r.items.find((c) => c.name === '灵感')?.name ?? ''))
    }).catch(() => {})
    api.get<{ items: Array<{ id: string; name: string }> }>('/tags').then((r) => {
      setTagPool((pool) => (pool.length ? pool : r.items.map((t) => t.name)))
    }).catch(() => {})
  }, [everOpened])

  // Ctrl/⌘+N 唤起 / Esc 收起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); expand() }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 展开时：点击面板/把手之外收起（触屏无 hover 的兜底）
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])

  const expand = () => {
    clearTimeout(hideTimer.current)
    setEverOpened(true)
    setOpen(true)
  }
  /** 鼠标移出面板/把手：延迟收起（焦点仍在面板内时不收，防打字被打断） */
  const scheduleHide = () => {
    clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (panelRef.current?.contains(document.activeElement)) return
      setOpen(false)
    }, 600)
  }
  /** 双击把手：切换停靠边（右 ↔ 底）并记忆 */
  const toggleSide = () => {
    const next = side === 'right' ? 'bottom' : 'right'
    setSide(next)
    try { localStorage.setItem(DOCK_SIDE_KEY, next) } catch { /* 忽略 */ }
    expand()
  }
  /** 保存成功 / 收起：清空草稿（draftEpoch 重挂载编辑器换干净草稿） */
  const resetDraft = () => {
    setText(''); setTagNames(['灵感']); setCategoryName(''); setPlanTitle(''); setPlanNote(''); setLevel('P1'); setDueDate('')
    setDraftEpoch((e) => e + 1)
  }
  const collapse = () => { setOpen(false); resetDraft() }

  /** 保存时解析分类 id：优先按名匹配已有分类，否则新建（下拉内「新建」已落库的可直接命中） */
  const resolveCategoryId = (name: string): Promise<string> =>
    resolveCategoryIdByName(cats, name, async (n) => {
      const r = await api.post<{ item: Category }>('/categories', { name: n })
      setCats((list) => [...list, r.item])
      return r.item
    })

  const saveInspiration = async () => {
    const body = text.trim()
    if (!body) { toast('写一句再保存~', 'err'); return }
    await api.post('/workbench/notes', {
      title: body.split('\n')[0].slice(0, 120) || '（无标题）',
      body,
      categoryId: await resolveCategoryId(categoryName),
      tags: tagNames,
      date: new Date().toISOString().slice(0, 10),
    })
    toast(readGamePrefs().xp ? '已存入灵感笔记 · +10 XP' : '已存入灵感笔记')
  }

  const savePlan = async () => {
    const title = planTitle.trim()
    if (!title) { toast('给计划起个标题吧', 'err'); return }
    await api.post('/workbench/plan', { text: title.slice(0, 2000), level, dueDate, note: planNote })
    toast('已加入今日计划 · 完成后进时间轴')
  }

  const save = async () => {
    setSaving(true)
    try {
      if (type === 'inspiration') await saveInspiration()
      else await savePlan()
      setOpen(false)
      resetDraft()
      onSaved?.()
      // 全局广播：任意页面保存速记后，时间轴等关心数据的页面自行刷新
      window.dispatchEvent(new CustomEvent('cl:quicknote:saved'))
    } catch (e: any) {
      toast(e?.message || '保存失败', 'err')
    } finally {
      setSaving(false)
    }
  }

  const xp = readGamePrefs().xp

  return createPortal(
    <div className={`qdock side-${side}${open ? ' open' : ''}${everOpened ? ' ever' : ''}`}>
      <button
        className="qdock-handle"
        onMouseEnter={expand}
        onMouseLeave={scheduleHide}
        onDoubleClick={toggleSide}
        onClick={expand}
        title="⚡ 速记 · 悬停展开 · 点击外部收起"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="qdock-handle-tx">⚡ 速记</span>
      </button>

      {everOpened && (
        <div
          ref={panelRef}
          className="qdock-panel"
          role="dialog"
          aria-label="速记"
          onMouseEnter={expand}
          onMouseLeave={scheduleHide}
        >
          <h3>⚡ 速记 <span className="kick">灵感 / 计划 · Ctrl/⌘+N · Esc 收起</span>
            <button className="qdock-switch" type="button" onClick={toggleSide} title="切换停靠边（右侧 / 底部）">⇄</button>
          </h3>
          <div className="type-pills">
            {NOTE_TYPES.map(([k, l]) => (
              <button key={k} className={`tpill-opt${type === k ? ' on' : ''}`} type="button" onClick={() => setType(k as NoteType)}>{l}</button>
            ))}
          </div>
          {type === 'inspiration' ? (
            <>
              <MarkdownEditor key={`ins-${draftEpoch}`} value={text} onChange={setText} minHeight={120} uncontrolled />
              <div className="grid g-2 qn-row">
                <TagMultiSelect
                  multiple={false}
                  ariaLabel="分类（与文章共用，可新建）"
                  placeholder="选择分类…"
                  tags={categoryName ? [categoryName] : []}
                  suggestions={cats.map((c) => c.name)}
                  onCreate={(name) => api.post<{ item: Category }>('/categories', { name }).then((r) => { setCats((list) => [...list, r.item]); return r.item })}
                  onChange={(next) => setCategoryName(next[0] ?? '')}
                />
                <TagMultiSelect
                  ariaLabel="标签（与文章共用，可新建）"
                  placeholder="添加标签…"
                  tags={tagNames}
                  suggestions={tagPool}
                  onChange={setTagNames}
                />
              </div>
            </>
          ) : (
            <>
              <input type="text" value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} placeholder="计划标题（要做什么）" className="qdock-input" />
              <div className="grid g-2 qn-row">
                <Dropdown value={level} align="left" options={LEVELS} onChange={(v) => setLevel(v)} ariaLabel="紧急度" />
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} title="完成时间（可留空）" />
              </div>
              <MarkdownEditor key={`plan-${draftEpoch}`} value={planNote} onChange={setPlanNote} minHeight={120} uncontrolled />
            </>
          )}
          <div className="nactions">
            <button className="btn ghost" type="button" onClick={() => { setOpen(false); resetDraft() }}>收起</button>
            <button className="btn" type="button" onClick={save} disabled={saving}>
              {saving ? '保存中…' : type === 'inspiration' ? (xp ? '存入灵感笔记 · +XP' : '存入灵感笔记') : '加入今日计划'}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

export { NOTE_TYPES }
