/** 快速动作（全局）：写文章 / 捕捉灵感 / 记一笔 —— 右侧抽屉，保存不关闭，Cmd/Ctrl+Shift+N 唤起灵感 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Category } from '../../api'
import { Drawer } from './Drawer'
import { Field } from './Modal'
import { useToast } from './Toast'
import { Icon } from './Icon'
import { todayYMD } from '../../lib/date'
import { Dropdown } from './Dropdown'

type Action = 'post' | 'note' | 'ledger' | null

const CATS_FALLBACK = [
  { name: '餐饮' }, { name: '交通' }, { name: '购物' }, { name: '居住' }, { name: '娱乐' },
  { name: '学习' }, { name: '健康' }, { name: '工作' }, { name: '理财' }, { name: '其他' },
]

const QuickCtx = createContext<{ open: (a: Exclude<Action, null>) => void } | null>(null)

export function useQuickActions() {
  const ctx = useContext(QuickCtx)
  if (!ctx) throw new Error('useQuickActions 必须在 <QuickActionsProvider> 内使用')
  return ctx
}

export function QuickActionsProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Action>(null)
  const [cats, setCats] = useState<Category[]>([])
  const toast = useToast()
  const nav = useNavigate()

  const [pTitle, setPTitle] = useState('')
  const [pBody, setPBody] = useState('')
  const [pCat, setPCat] = useState('')
  const [pTags, setPTags] = useState('')
  const [nTitle, setNTitle] = useState('')
  const [nBody, setNBody] = useState('')
  const [nMood, setNMood] = useState('灵感')
  const [lKind, setLKind] = useState<'income' | 'expense'>('expense')
  const [lCat, setLCat] = useState('餐饮')
  const [lAmount, setLAmount] = useState('')
  const [lNote, setLNote] = useState('')
  const [saving, setSaving] = useState(false)

  const loadCats = useCallback(() => {
    api.get<{ items: Category[] }>('/categories').then((r) => setCats(r.items)).catch(() => {})
  }, [])

  const open = useCallback((a: Exclude<Action, null>) => { loadCats(); setActive(a) }, [loadCats])
  const close = useCallback(() => setActive(null), [])

  // 全局快捷键：⌘/Ctrl + Shift + N 唤起灵感捕捉（任何页面）
  // 注：总览页（/）由居中速记弹窗接管 ⌘N / ⌘⇧N，避免两处同时弹出
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
        if (window.location.pathname === '/') return
        e.preventDefault()
        open('note')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const savePost = async (publish: boolean) => {
    if (!pTitle.trim()) { toast('先给文章起个标题', 'err'); return }
    setSaving(true)
    try {
      const names = pTags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
      const cat = cats.find((c) => c.name === pCat)
      await api.post('/posts', {
        title: pTitle.trim(),
        rawMarkdown: pBody,
        summary: pBody.slice(0, 120),
        categoryId: cat?.id ?? undefined,
        tags: names,
        status: publish ? 'published' : 'draft',
      })
      toast(publish ? '已发布（文章页可见）' : '已保存为草稿')
      if (!publish) { setPTitle(''); setPBody(''); setPTags('') }
      if (publish) close()
    } catch (e: any) { toast(e?.message || '保存失败', 'err') } finally { setSaving(false) }
  }

  const saveNote = async () => {
    if (!nTitle.trim() && !nBody.trim()) { toast('写点什么再保存', 'err'); return }
    setSaving(true)
    try {
      await api.post('/workbench/notes', { title: nTitle.trim() || '（无标题）', body: nBody, mood: nMood, date: new Date().toISOString().slice(0, 10) })
      toast('灵感已捕捉')
      setNTitle(''); setNBody('')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') } finally { setSaving(false) }
  }

  const saveLedger = async () => {
    const amt = Number(lAmount)
    if (!amt || amt <= 0) { toast('请输入有效金额', 'err'); return }
    setSaving(true)
    try {
      await api.post('/workbench/ledger', { kind: lKind, cat: lCat, amount: amt, note: lNote.trim(), date: new Date().toISOString().slice(0, 10) })
      toast('已记账')
      setLAmount(''); setLNote('')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') } finally { setSaving(false) }
  }

  return (
    <QuickCtx.Provider value={{ open }}>
      {children}

      {active === 'post' && (
        <Drawer
          title={<><Icon name="pen" size={16} /> 快速写文章</>}
          onClose={close} width={560} hint="草稿与发布均进入「文章」列表"
          footer={
            <>
              <button
                className="btn ghost"
                title="把当前内容存为草稿并进入全屏编辑"
                onClick={async () => {
                  try {
                    const names = pTags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
                    const cat = cats.find((c) => c.name === pCat)
                    const r = await api.post<{ id: string }>('/posts', {
                      title: pTitle.trim() || '无标题',
                      rawMarkdown: pBody,
                      summary: pBody.slice(0, 120),
                      categoryId: cat?.id ?? undefined,
                      tags: names,
                      status: 'draft',
                    })
                    close()
                    nav(`/posts/${r.id}/edit`)
                  } catch (e: any) { toast(e?.message || '创建草稿失败', 'err') }
                }}
              >
                <Icon name="arrow" size={15} /> 展开编辑
              </button>
              <div className="spacer" />
              <button className="btn ghost" onClick={() => savePost(false)} disabled={saving}>{saving ? '保存中…' : '保存草稿'}</button>
              <button className="btn" onClick={() => savePost(true)} disabled={saving}>{saving ? '发布中…' : '发布'}</button>
            </>
          }
        >
          <Field label="标题"><input type="text" value={pTitle} onChange={(e) => setPTitle(e.target.value)} placeholder="文章标题" maxLength={200} autoFocus /></Field>
          <Field label="正文（Markdown）"><textarea value={pBody} onChange={(e) => setPBody(e.target.value)} placeholder="开始写作…" style={{ minHeight: 220 }} /></Field>
          <div className="grid g-2">
            <Field label="分类">
              <Dropdown
              value={pCat}
              align="left"
              options={(cats.length ? cats : CATS_FALLBACK).map((c) => ({ value: c.name, label: c.name }))}
              onChange={(v) => setPCat(v)}
            />
            </Field>
            <Field label="标签"><input type="text" value={pTags} onChange={(e) => setPTags(e.target.value)} placeholder="技术, 随笔" /></Field>
          </div>
          <p className="drawer-note dim">保存草稿后抽屉保持打开，可连续创作。</p>
        </Drawer>
      )}

      {active === 'note' && (
        <Drawer
          title={<><Icon name="book" size={16} /> 捕捉灵感 <span className="kbd-hint" style={{ marginLeft: 'auto' }}><kbd>⌘/Ctrl ⇧ N</kbd></span></>}
          onClose={close} width={480} hint="灵感 → 文章草稿 / 今日计划"
          footer={
            <>
              <button className="btn ghost" onClick={() => { close(); window.location.hash = '#/goals-home?tab=plan' }}>转为今日计划</button>
              <div className="spacer" />
              <button className="btn" onClick={saveNote} disabled={saving}>{saving ? '保存中…' : '保存灵感'}</button>
            </>
          }
        >
          <Field label="标题"><input type="text" value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="一句话标题" maxLength={80} autoFocus /></Field>
          <Field label="内容"><textarea value={nBody} onChange={(e) => setNBody(e.target.value)} placeholder="记录此刻的想法…" style={{ minHeight: 200 }} /></Field>
          <Field label="标签">
            <div className="seg">
              {['灵感', '想法', '学习', '备忘', '摘录'].map((m) => (
                <button key={m} className={`seg-btn ${nMood === m ? 'on' : ''}`} onClick={() => setNMood(m)} type="button">{m}</button>
              ))}
            </div>
          </Field>
          <p className="drawer-note dim">保存后抽屉保持打开，可连续捕捉。</p>
        </Drawer>
      )}

      {active === 'ledger' && (
        <Drawer
          title={<><Icon name="wallet" size={16} /> 记一笔</>}
          onClose={close} width={440}
          footer={
            <>
              <div className="spacer" />
              <button className="btn" onClick={saveLedger} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
            </>
          }
        >
          <div className="seg" style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <button className={`seg-btn ${lKind === 'expense' ? 'on' : ''}`} onClick={() => setLKind('expense')}>支出</button>
            <button className={`seg-btn ${lKind === 'income' ? 'on' : ''}`} onClick={() => setLKind('income')}>收入</button>
          </div>
          <Field label="金额"><input type="number" min={0} step={0.01} value={lAmount} onChange={(e) => setLAmount(e.target.value)} placeholder="0.00" autoFocus /></Field>
          <Field label="分类">
            <Dropdown
              value={lCat}
              align="left"
              options={(cats.length ? cats : CATS_FALLBACK).map((c) => ({ value: c.name, label: c.name }))}
              onChange={(v) => setLCat(v)}
            />
          </Field>
          <Field label="备注（可选）"><input type="text" value={lNote} onChange={(e) => setLNote(e.target.value)} placeholder="用途说明" maxLength={100} /></Field>
          <p className="drawer-note dim">保存后抽屉保持打开，可连续记账。</p>
        </Drawer>
      )}
    </QuickCtx.Provider>
  )
}