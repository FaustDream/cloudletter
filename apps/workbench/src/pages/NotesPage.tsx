/** 灵感笔记：卡片网格（多风格：card 网格 / list 列表 / timeline 时间线），随手记 / 删除 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type NoteItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { todayYMD } from '../lib/date'
import { noteStyle, type NoteStyle } from '../lib/layout'

const MOODS = ['灵感', '想法', '学习', '备忘', '摘录']

export function NotesPage() {
  const [items, setItems] = useState<NoteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [mood, setMood] = useState('灵感')
  const [style, setStyle] = useState<NoteStyle>(noteStyle)
  const toast = useToast()

  // 风格偏好切换：设置页写入后同 tab 内即时生效
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'cl_note_style') setStyle(noteStyle()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: NoteItem[] }>('/workbench/notes')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const sorted = useMemo(
    () => [...items].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [items],
  )

  const submit = async () => {
    if (!title.trim()) { toast('请填写标题', 'err'); return }
    try {
      await api.post('/workbench/notes', { title: title.trim(), body, mood, date: new Date().toISOString().slice(0, 10) })
      toast('已记录')
      setTitle(''); setBody(''); setMood('灵感')
      setCreating(false)
      load()
    } catch (e: any) {
      toast(e?.message || '保存失败', 'err')
    }
  }

  const remove = async (n: NoteItem) => {
    try {
      await api.del(`/workbench/notes/${n.id}`)
      toast('已删除')
      load()
    } catch (e: any) {
      toast(e?.message || '删除失败', 'err')
    }
  }

  return (
    <>
      <PageHeader
        title="灵感笔记"
        subtitle={`共 ${items.length} 条`}
        actions={<button className="btn" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> 随手记</button>}
      />

      <div className="grid g-2 note-grid" data-style={style}>
        {loading ? (
          <EmptyState>载入中…</EmptyState>
        ) : sorted.length === 0 ? (
          <EmptyState>还没有笔记，捕捉一个灵感吧</EmptyState>
        ) : (
          sorted.map((n) => (
            <div key={n.id} className="note" data-date={n.date} data-mood={n.mood}>
              <div className="nt" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-flex', color: 'var(--text-tertiary)' }}>
                  <Icon name="book" size={16} />
                </span>
                {n.title}
              </div>
              <div className="nb">{n.body}</div>
              <div className="nm">
                <span className="chip pill-color" style={{ background: 'var(--module-4)' }}>{n.mood}</span>
                <span className="dt">{n.date}</span>
                <button className="ndel" onClick={() => remove(n)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {creating && (
        <Modal
          title="随手记"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setCreating(false)}>取消</button>
              <button className="btn" onClick={submit}>保存</button>
            </>
          }
        >
          <Field label="标题">
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="一句话标题" maxLength={80} autoFocus />
          </Field>
          <Field label="内容">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="记录此刻的想法…" />
          </Field>
          <Field label="标签">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MOODS.map((m) => (
                <button key={m} className={`seg-btn ${mood === m ? 'on' : ''}`} onClick={() => setMood(m)} type="button">{m}</button>
              ))}
            </div>
          </Field>
        </Modal>
      )}
    </>
  )
}