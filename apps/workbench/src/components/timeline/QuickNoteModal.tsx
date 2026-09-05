/** 速记居中弹窗 —— 全局可用（Shell 挂载）；灵感=灵感笔记（与文章共用分类/标签），
 *  计划=直接进今日计划（PlanItem：紧急度 level / 完成时间 dueDate / 标题 text / 详情 note） */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type Category, type NoteType } from '../../api'
import { useToast } from '../framework/Toast'
import { Dropdown } from '../framework/Dropdown'
import { MarkdownEditor } from '../editor/MarkdownEditor'

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

const LEVELS = [
  { value: 'P0', label: 'P0 · 紧急' },
  { value: 'P1', label: 'P1 · 重要' },
  { value: 'P2', label: 'P2 · 一般' },
]

export function QuickNoteModal({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<NoteType>('inspiration')
  // 灵感表单
  const [text, setText] = useState('')
  const [tags, setTags] = useState('灵感')
  const [categoryId, setCategoryId] = useState('')
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

  useEffect(() => {
    // ⌘/Ctrl + N（可含 Shift）唤起；Esc 关闭（总览页专用，全局 ⌘⇧N 已让路）
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); setOpen((v) => !v) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 打开时补齐分类下拉（灵感笔记默认「灵感」分类）
  useEffect(() => {
    if (!open || cats.length > 0) return
    api.get<{ items: Category[] }>('/categories')
      .then((r) => {
        setCats(r.items)
        setCategoryId((v) => v || r.items.find((c) => c.name === '灵感')?.id || '')
      })
      .catch(() => {})
  }, [open, cats.length])

  const close = () => {
    setOpen(false); setText(''); setTags('灵感'); setPlanTitle(''); setPlanNote(''); setLevel('P1'); setDueDate('')
  }

  const parseTags = () => tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)

  const saveInspiration = async () => {
    const body = text.trim()
    if (!body) { toast('写一句再保存~', 'err'); return }
    await api.post('/workbench/notes', {
      title: body.split('\n')[0].slice(0, 120) || '（无标题）',
      body,
      categoryId,
      tags: parseTags(),
      date: new Date().toISOString().slice(0, 10),
    })
    toast('已存入灵感笔记 · +10 XP')
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
          <div className="nmodal" onClick={(e) => e.stopPropagation()}>
            <h3>速记 <span className="kick">灵感 / 计划 · Ctrl/⌘+N 唤起 · Esc 关闭</span></h3>
            <div className="type-pills">
              {NOTE_TYPES.map(([k, l]) => (
                <button key={k} className={`tpill-opt${type === k ? ' on' : ''}`} type="button" onClick={() => setType(k as NoteType)}>{l}</button>
              ))}
            </div>
            {type === 'inspiration' ? (
              <>
                <MarkdownEditor value={text} onChange={setText} minHeight={150} />
                <div className="grid g-2 qn-row">
                  <Dropdown
                    value={categoryId}
                    align="left"
                    options={[{ value: '', label: '无分类' }, ...cats.map((c) => ({ value: c.id, label: c.name }))]}
                    onChange={setCategoryId}
                    ariaLabel="分类"
                  />
                  <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签，逗号分隔（默认灵感）" />
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
                {saving ? '保存中…' : type === 'inspiration' ? '存入灵感笔记 · +XP' : '加入今日计划'}
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
