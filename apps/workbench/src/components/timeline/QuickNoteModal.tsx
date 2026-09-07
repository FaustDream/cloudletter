/** 速记居中弹窗 —— 全局可用（Shell 挂载）；灵感=灵感笔记（与文章共用分类/标签），
 *  计划=直接进今日计划（PlanItem：紧急度 level / 完成时间 dueDate / 标题 text / 详情 note）。
 *  弹窗可拖拽（按住标题栏），位置记忆；经 experience 开关决定 XP 文案 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type Category, type NoteType } from '../../api'
import { useToast } from '../framework/Toast'
import { Dropdown } from '../framework/Dropdown'
import { MarkdownEditor } from '../editor/MarkdownEditor'
import { TagMultiSelect } from '../editor/TagMultiSelect'
import { resolveCategoryIdByName } from '../../lib/taxonomy'
import { readGamePrefs } from '../../lib/gamePrefs'

/** 速记模式：灵感 | 计划 */
const NOTE_TYPES: Array<[string, string]> = [['inspiration', '💡 灵感'], ['plan', '📋 计划']]

/** 速记按钮拖拽位置记忆（localStorage）；null = 默认左下角 */
const FAB_KEY = 'cl_fab_pos_v2'
function loadFabPos(): { x: number; y: number } | null {
  try {
    const s = localStorage.getItem(FAB_KEY)
    if (s) { const p = JSON.parse(s); if (typeof p.x === 'number' && typeof p.y === 'number') return p }
  } catch { /* 忽略损坏 */ }
  return null
}

/** 弹窗拖拽位置记忆（按住标题栏拖动）；null = 默认居中 */
const QN_POS_KEY = 'cl_qn_pos'
function loadQnPos(): { x: number; y: number } | null {
  try {
    const s = localStorage.getItem(QN_POS_KEY)
    if (s) { const p = JSON.parse(s); if (typeof p.x === 'number' && typeof p.y === 'number') return p }
  } catch { /* 忽略损坏 */ }
  return null
}

const LEVELS = [
  { value: 'P0', label: 'P0 · 紧急' },
  { value: 'P1', label: 'P1 · 重要' },
  { value: 'P2', label: 'P2 · 一般' },
  { value: 'P4', label: 'P4 · 不紧急' },
]

export function QuickNoteModal({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<NoteType>('inspiration')
  // 灵感表单（非受控编辑器：value 仅初值，编辑内容不回灌，杜绝“打字变撤销/丢字”）
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
  const toast = useToast()
  // ── 速记按钮：可拖拽移动（位移 >5px 视为拖拽，不触发展开；双击复位左下） ──
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(loadFabPos)
  const fabRef = useRef<HTMLButtonElement>(null)
  const fabDrag = useRef<{ bx: number; by: number; gx: number; gy: number; moved: boolean } | null>(null)
  const fabPosRef = useRef<{ x: number; y: number } | null>(fabPos)

  useEffect(() => {
    const clampX = (x: number) => Math.min(Math.max(8, x), window.innerWidth - 140)
    const clampY = (y: number) => Math.min(Math.max(8, y), window.innerHeight - 64)
    const onMove = (e: PointerEvent) => {
      const d = fabDrag.current
      if (!d) return
      const dx = e.clientX - d.gx, dy = e.clientY - d.gy
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true
      if (!d.moved) return
      const pos = { x: clampX(d.bx + dx), y: clampY(d.by + dy) }
      fabPosRef.current = pos
      setFabPos(pos)
    }
    const onUp = () => {
      const d = fabDrag.current
      if (!d) return
      fabDrag.current = null
      if (d.moved) {
        try {
          const now = fabPosRef.current
          if (now) localStorage.setItem(FAB_KEY, JSON.stringify(now))
        } catch { /* 忽略 */ }
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const onFabDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || fabDrag.current) return
    e.preventDefault()
    const r = fabRef.current?.getBoundingClientRect()
    if (!r) return
    fabDrag.current = { bx: r.left, by: r.top, gx: e.clientX, gy: e.clientY, moved: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
  }
  const onFabClick = () => {
    if (fabDrag.current?.moved) return
    setOpen(true)
  }
  const onFabReset = () => {
    fabDrag.current = null
    fabPosRef.current = null
    setFabPos(null)
    try { localStorage.removeItem(FAB_KEY) } catch { /* 忽略 */ }
    toast('速记按钮已复位到左下角')
  }

  /* ── 弹窗拖拽：按住标题栏移动，位置记忆（双击标题栏复位居中） ── */
  const [qnPos, setQnPos] = useState<{ x: number; y: number } | null>(loadQnPos)
  const modalRef = useRef<HTMLDivElement>(null)
  const qnDrag = useRef<{ bx: number; by: number; gx: number; gy: number; moved: boolean } | null>(null)
  const qnPosRef = useRef<{ x: number; y: number } | null>(qnPos)

  useEffect(() => {
    const clampX = (x: number) => Math.min(Math.max(8, x), window.innerWidth - 120)
    const clampY = (y: number) => Math.min(Math.max(8, y), window.innerHeight - 80)
    const onMove = (e: PointerEvent) => {
      const d = qnDrag.current
      if (!d) return
      const dx = e.clientX - d.gx, dy = e.clientY - d.gy
      if (!d.moved && Math.hypot(dx, dy) > 5) d.moved = true
      if (!d.moved) return
      const pos = { x: clampX(d.bx + dx), y: clampY(d.by + dy) }
      qnPosRef.current = pos
      setQnPos(pos)
    }
    const onUp = () => {
      const d = qnDrag.current
      if (!d) return
      qnDrag.current = null
      if (d.moved) {
        try {
          const now = qnPosRef.current
          if (now) localStorage.setItem(QN_POS_KEY, JSON.stringify(now))
        } catch { /* 忽略 */ }
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const onTitleDown = (e: React.PointerEvent<HTMLHeadingElement>) => {
    if (e.button !== 0 || qnDrag.current) return
    const r = modalRef.current?.getBoundingClientRect()
    if (!r) return
    e.preventDefault()
    qnDrag.current = { bx: r.left, by: r.top, gx: e.clientX, gy: e.clientY, moved: false }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 忽略 */ }
  }
  const onTitleClick = () => {
    if (qnDrag.current?.moved) return
    // 单击标题不做任何事（双击 = 复位居中）
  }
  const onTitleReset = () => {
    if (qnDrag.current?.moved) return
    qnDrag.current = null
    qnPosRef.current = null
    setQnPos(null)
    try { localStorage.removeItem(QN_POS_KEY) } catch { /* 忽略 */ }
    toast('速记弹窗已复位到居中')
  }

  useEffect(() => {
    // ⌘/Ctrl + N（可含 Shift）唤起；Esc 关闭（总览页专用，全局 ⌘⇧N 已让路）
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setOpen((v) => !v) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 打开时补齐分类/标签下拉数据（灵感笔记默认「灵感」分类与标签）
  useEffect(() => {
    if (!open || cats.length > 0) return
    api.get<{ items: Category[] }>('/categories').then((r) => {
      setCats(r.items)
      const def = r.items.find((c) => c.name === '灵感')
      setCategoryName((v) => v || (def?.name ?? ''))
    }).catch(() => {})
    api.get<{ items: Array<{ id: string; name: string }> }>('/tags').then((r) => {
      setTagPool((pool) => (pool.length ? pool : r.items.map((t) => t.name)))
    }).catch(() => {})
  }, [open, cats.length])

  /** 保存时解析分类 id：优先按名匹配已有分类，否则新建（下拉内「新建」已落库的可直接命中） */
  const resolveCategoryId = (name: string): Promise<string> =>
    resolveCategoryIdByName(cats, name, async (n) => {
      const r = await api.post<{ item: Category }>('/categories', { name: n })
      setCats((list) => [...list, r.item])
      return r.item
    })

  const close = () => {
    setOpen(false); setText(''); setTagNames(['灵感']); setCategoryName(''); setPlanTitle(''); setPlanNote(''); setLevel('P1'); setDueDate('')
  }

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
      close()
      onSaved?.()
      // 全局广播：任意页面保存速记后，时间轴等关心数据的页面自行刷新
      window.dispatchEvent(new CustomEvent('cl:quicknote:saved'))
    } catch (e: any) {
      toast(e?.message || '保存失败', 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {createPortal(
        <button
          ref={fabRef}
          className="fab"
          style={fabPos ? { left: fabPos.x, top: fabPos.y, right: 'auto', bottom: 'auto' } : undefined}
          onPointerDown={onFabDown}
          onClick={onFabClick}
          onDoubleClick={onFabReset}
          title="⚡ 速记 · 按住可拖拽移动位置 · 双击复位左下角"
        >⚡ 速记</button>,
        document.body,
      )}
      {open && createPortal(
        <div className="overlay" onClick={close}>
          <div
            ref={modalRef}
            className="nmodal"
            style={qnPos ? { position: 'fixed', left: qnPos.x, top: qnPos.y, right: 'auto', bottom: 'auto', margin: 0 } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 onPointerDown={onTitleDown} onClick={onTitleClick} onDoubleClick={onTitleReset} title="按住拖动 · 双击复位居中" style={{ cursor: 'grab', userSelect: 'none' }}>
              速记 <span className="kick">灵感 / 计划 · Ctrl/⌘+N 唤起 · Esc 关闭</span>
            </h3>
            <div className="type-pills">
              {NOTE_TYPES.map(([k, l]) => (
                <button key={k} className={`tpill-opt${type === k ? ' on' : ''}`} type="button" onClick={() => setType(k as NoteType)}>{l}</button>
              ))}
            </div>
            {type === 'inspiration' ? (
              <>
                <MarkdownEditor value={text} onChange={setText} minHeight={120} uncontrolled />
                <div className="grid g-2 qn-row">
                  <TagMultiSelect
                    multiple={false}
                    ariaLabel="分类（与文章共用，可新建）"
                    placeholder="选择分类…"
                    tags={categoryName ? [categoryName] : []}
                    suggestions={cats.map((c) => c.name)}
                    onChange={(next) => setCategoryName(next[0] ?? '')}
                  />
                  <TagMultiSelect
                    multiple
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
                <input type="text" value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} placeholder="计划标题（要做什么）" autoFocus />
                <div className="grid g-2 qn-row">
                  <Dropdown
                    value={level}
                    align="left"
                    options={LEVELS}
                    onChange={(v) => setLevel(v)}
                    ariaLabel="紧急度"
                  />
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} title="完成时间（可留空）" />
                </div>
                <MarkdownEditor value={planNote} onChange={setPlanNote} minHeight={120} />
              </>
            )}
            <div className="nactions">
              <button className="btn ghost" type="button" onClick={close}>取消</button>
              <button className="btn" type="button" onClick={save} disabled={saving}>
                {saving ? '保存中…' : type === 'inspiration' ? (readGamePrefs().xp ? '存入灵感笔记 · +XP' : '存入灵感笔记') : '加入今日计划'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export { NOTE_TYPES }
