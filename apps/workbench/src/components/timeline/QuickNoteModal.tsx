/** 速记居中弹窗 —— 字段收敛为 3 个（类型 + 正文 + 标签）；保存落灵感笔记（mood=类型标签）并刷新时间轴 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api'
import { useToast } from '../framework/Toast'
import { TL_TYPES } from './timeline'
import { todayYMD } from '../../lib/date'

const N_TYPE_LABEL: Record<string, string> = Object.fromEntries(TL_TYPES.map(([k, l]) => [k, l]))

export function QuickNoteModal({ avatar, onSaved }: { avatar: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState('note')
  const [text, setText] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const taRef = useRef<HTMLTextAreaElement>(null)

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
        <button className="fab" onClick={() => setOpen(true)}>⚡ 速记</button>,
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