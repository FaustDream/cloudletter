/** 分类管理：颜色语义 + 数量联动（点击开抽屉看分类下内容）+ hover 操作 + 描述/时间 */
import { useCallback, useEffect, useState } from 'react'
import { api, type Category } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { TaxonomyDrawer } from './org/TaxonomyDrawer'

/** 分类名 → 语义色（技术=蓝 / 指南=蓝图 / 随笔=绿 / 项目=橙 / 生活=绿 / 重要=红） */
const CAT_COLORS: Array<{ name: string; color: string }> = [
  { name: '技术', color: 'var(--accent)' },
  { name: '指南', color: 'var(--info)' },
  { name: '随笔', color: 'var(--ok)' },
  { name: '生活', color: 'var(--ok)' },
  { name: '项目', color: 'var(--warn)' },
  { name: '重要', color: 'var(--danger)' },
]
const FALLBACK = 'var(--info)'

function catColor(name: string): string {
  return CAT_COLORS.find((c) => c.name === name)?.color ?? FALLBACK
}

export function CategoriesPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Category | null>(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [creating, setCreating] = useState(false)
  /** 点分类卡 → 抽屉展示该分类下的文章与灵感笔记（不整页跳转） */
  const [drawer, setDrawer] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: Category[] }>('/categories')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const openCreate = () => { setEditing(null); setName(''); setDesc(''); setCreating(true) }
  const openEdit = (c: Category) => { setEditing(c); setName(c.name); setDesc(c.description ?? ''); setCreating(true) }

  const submit = async () => {
    if (!name.trim()) return
    try {
      if (editing) {
        await api.put(`/categories/${editing.id}`, { name: name.trim(), description: desc || undefined })
        toast('已更新分类')
      } else {
        await api.post('/categories', { name: name.trim(), description: desc || undefined })
        toast('已创建分类')
      }
      setCreating(false); load()
    } catch (e: any) { toast(e?.message || '操作失败', 'err') }
  }

  const remove = async (c: Category) => {
    if (!(await confirmDialog({ title: '删除分类', description: `确定删除分类「${c.name}」？删除后该分类下的文章与灵感笔记将变为未分类。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/categories/${c.id}`)
      toast('已删除'); load()
    } catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }

  return (
    <>
      {withHeader ? (
      <PageHeader
        title="分类"
        subtitle="文章与灵感笔记共用 · 点击分类查看相关内容"
        actions={<button className="btn" onClick={openCreate}><Icon name="plus" size={16} /> 新建分类</button>}
      />
      ) : (
        <div className="panel-bar">
          <div className="spacer" />
          <button className="btn slim" onClick={openCreate}><Icon name="plus" size={14} /> 新建分类</button>
        </div>
      )}

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>暂无分类</EmptyState>
      ) : (
        <div className="cat-grid">
          {items.map((c) => {
            const color = catColor(c.name)
            const pcount = c._count?.posts ?? 0
            const ncount = c._count?.notes ?? 0
            const count = pcount + ncount
            return (
              <div key={c.id} className="cat-card" title="点击查看该分类下的文章与灵感笔记" onClick={() => setDrawer(c.name)}>
                <span className="cc-dot" style={{ background: color, boxShadow: `0 0 0 4px color-mix(in srgb, ${color} 18%, transparent)` }} />
                <div className="cc-name">{c.name}</div>
                <div className="cc-count">{pcount} 篇 · {ncount} 条</div>
                <div className="cc-bar"><i style={{ width: `${Math.min(100, count * 14)}%`, background: color }} /></div>
                <div className="cc-desc">{c.description || `共 ${pcount} 篇文章 · ${ncount} 条灵感笔记`}</div>
                <div className="cc-ops" onClick={(e) => e.stopPropagation()}>
                  <button className="qop" title="编辑" onClick={() => openEdit(c)}><Icon name="pen" size={14} /></button>
                  <button className="qop danger" title={count > 0 ? '先移出该分类下的内容再删除' : '删除'} disabled={count > 0} onClick={() => remove(c)}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {creating && (
        <Modal title={editing ? '编辑分类' : '新建分类'} onClose={() => setCreating(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setCreating(false)}>取消</button>
            <button className="btn" onClick={submit}>保存</button>
          </>
        }>
          <Field label="名称"><input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="分类名称" autoFocus /></Field>
          <Field label="描述（可选）"><input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="一句话描述" /></Field>
        </Modal>
      )}
      {/* 点分类 → 内容抽屉（文章 + 灵感笔记） */}
      {drawer && <TaxonomyDrawer kind="category" name={drawer} onClose={() => setDrawer(null)} />}
    </>
  )
}