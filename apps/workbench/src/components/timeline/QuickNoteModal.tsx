/** 速记居中弹窗 —— 字段收敛为 3 个（类型 + 正文 + 标签）；保存落灵感笔记（mood=类型标签）并刷新时间轴 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api'
import { useToast } from '../framework/Toast'
import { TL_TYPES } from './timeline'
import { todayYMD } from '../../lib/date'

const N_TYPE_LABEL: Record<string, string> = Object.fromEntries(TL_TYPES.map(([k, l]) => [k, l]))

/** 速记按钮拖拽位置记忆（localStorage）；null = 默认右下角 */
const FAB_KEY = 'cl_fab_pos'
function loadFabPos(): { x: number; y: number } | null {
  try {
    const s = localStorage.getItem(FAB_KEY)
    if (s) { const p = JSON.parse(s); if (typeof p.x === 'number' && typeof p.y === 'number') return p }
  } catch { /* 忽略损坏 */ }
  return null
}

export function QuickNoteModal({ avatar, onSaved }: { avatar: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('note')
  const [text, setText] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const taRef = useRef<HTMLTextAreaElement>(null)
  // ── 速记按钮：可拖拽移动（位移 >5px 视为拖拽，不触发展开；双击复位右下） ──
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
    toast('速记按钮已复位到右下角')
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

  useEffect(() => { if (open) setTimeout(() => taRef.current?.focus(), 60) }, [open])

  const close = () => { setOpen(false); setText(''); setTags('') }

  const save = async () => {
    const body = text.trim()
    if (!body) { toast('写一句再保存~', 'err'); return }
    setSaving(true)
    try {
      const tagLine = tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean).join(',')
      await api.post('/workbench/notes', {
        title: body.slice(0, 80) || '（无标题）',
        body,
        mood: N_TYPE_LABEL[type],
        date: new Date().toISOString().slice(0, 10),
      })
      toast(`已入时间轴 · ${N_TYPE_LABEL[type]} +10 XP`)
      close()
      onSaved()
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
          title="⚡ 速记 · 按住可拖拽移动位置 · 双击复位右下角"
        >⚡ 速记</button>,
        document.body,
      )}
      {open && createPortal(
        <div className="overlay" onClick={close}>
          <div className="nmodal" onClick={(e) => e.stopPropagation()}>
            <h3>零成本速记 <span className="kick">写一句就够 · Ctrl/⌘+N 保存 · Esc 关闭</span></h3>
            <div className="type-pills">
              {TL_TYPES.map(([k, l]) => (
                <button key={k} className={`tpill-opt${type === k ? ' on' : ''}`} type="button" onClick={() => setType(k)}>{l}</button>
              ))}
            </div>
            <textarea ref={taRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="此刻想到什么…" />
            <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="标签，逗号分隔（可选）" />
            <div className="nactions">
              <button className="btn ghost" type="button" onClick={close}>取消</button>
              <button className="btn" type="button" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存到时间轴 · +XP'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

export { N_TYPE_LABEL }