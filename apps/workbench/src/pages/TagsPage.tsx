/** 标签管理：使用频次视觉编码 + 分档 + 未使用标签一键清理 + 点击开抽屉看关联内容（文章+灵感笔记共用） */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Tag } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'
import { TaxonomyDrawer } from './org/TaxonomyDrawer'

export function TagsPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [unusedOpen, setUnusedOpen] = useState(false)
  /** 点标签 → 抽屉展示该标签下的文章与灵感笔记（不整页跳转） */
  const [drawer, setDrawer] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: Tag[] }>('/tags')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const totalOf = (t: Tag) => (t._count?.posts ?? 0) + (t._count?.notes ?? 0)
  const max = useMemo(() => Math.max(1, ...items.map(totalOf)), [items])
  const used = useMemo(() => items.filter((t) => totalOf(t) > 0), [items])
  const unused = useMemo(() => items.filter((t) => totalOf(t) === 0), [items])

  const submit = async () => {
    if (!name.trim()) return
    try {
      await api.post('/tags', { name: name.trim() })
      toast('已创建标签'); setName(''); setCreating(false); load()
    } catch (e: any) { toast(e?.message || '创建失败', 'err') }
  }

  const remove = async (t: Tag) => {
    if (!(await confirmDialog({ title: '删除标签', description: `确定删除标签「${t.name}」？文章上的该标签将被移除。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/tags/${t.id}`)
      toast('已删除'); load()
    } catch (e: any) { toast(e?.message || '删除失败', 'err') }
  }

  const cleanAllUnused = async () => {
    if (!(await confirmDialog({ title: '清理未使用标签', description: `确定删除 ${unused.length} 个未使用标签？此操作不可恢复。`, type: 'danger', confirmText: '清理' }))) return
    for (const t of unused) await api.del(`/tags/${t.id}`).catch(() => {})
    toast(`已清理 ${unused.length} 个`);
    setUnusedOpen(false); load()
  }

  const sizeOf = (count: number) => {
    const r = count / max
    return 12.5 + r * 5
  }

  return (
    <>
      <PageHeader
        title={withHeader ? '标签' : undefined}
        subtitle={withHeader ? '文章与灵感笔记共用 · 点击标签查看关联内容' : undefined}
        actions={<>
          {unused.length > 0 && (
            <button className="btn ghost slim" style={{ marginRight: 10 }} onClick={() => setUnusedOpen(true)}>
              <Icon name="trash" size={14} /> 未使用标签（{unused.length}）
            </button>
          )}
          <button className={withHeader ? 'btn' : 'btn slim'} onClick={() => { setName(''); setCreating(true) }}><Icon name="plus" size={14} /> 新建标签</button>
        </>}
      />

      {/* 使用频次分档 */}
      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : used.length === 0 ? (
        <EmptyState>暂无标签</EmptyState>
      ) : (
        <>
          <div className="tag-cloud">
            {used.map((t) => {
              const count = totalOf(t)
              return (
                <span key={t.id} className="tagpile" style={{ fontSize: sizeOf(count) }}
                  title="点击查看该标签下的文章与灵感笔记"
                  onClick={() => setDrawer(t.name)}>
                  # {t.name}
                  <span className="tcount">· {count}</span>
                  <span className="tagpiledel" onClick={(e) => { e.stopPropagation(); remove(t) }}>
                    <Icon name="x" size={12} />
                  </span>
                </span>
              )
            })}
          </div>
          <div className="tag-legend">
            <span>低频</span><i className="tl-line" /><span>高频</span>
          </div>
        </>
      )}

      {creating && (
        <Modal title="新建标签" onClose={() => setCreating(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setCreating(false)}>取消</button>
            <button className="btn" onClick={submit}>保存</button>
          </>
        }>
          <Field label="名称"><input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="标签名称" autoFocus /></Field>
        </Modal>
      )}

      {/* 未使用标签清理 */}
      {unusedOpen && unused.length > 0 && (
        <Modal title={`未使用标签（${unused.length}）`} onClose={() => setUnusedOpen(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setUnusedOpen(false)}>取消</button>
            <button className="btn danger" onClick={cleanAllUnused}>全部清理</button>
          </>
        }>
          <div className="tag-cloud">
            {unused.map((t) => (
              <span key={t.id} className="tagpile" style={{ opacity: .65 }}># {t.name}</span>
            ))}
          </div>
          <p className="dim" style={{ fontSize: 12.5, marginTop: 14 }}>未被任何文章或灵感笔记使用的标签不会在博客中展示，可一键清理。</p>
        </Modal>
      )}

      {/* 点标签 → 内容抽屉（文章 + 灵感笔记） */}
      {drawer && <TaxonomyDrawer kind="tag" name={drawer} onClose={() => setDrawer(null)} />}
    </>
  )
}