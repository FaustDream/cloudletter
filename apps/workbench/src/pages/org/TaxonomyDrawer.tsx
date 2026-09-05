/**
 * 分类/标签内容抽屉：在分类标签页点分类或标签后右侧滑出，
 * 混合列出该分类/标签下的文章与灵感笔记，条目直达（文章进编辑页、
 * 笔记去灵感笔记页并聚焦详情）——不再整页跳转打断当前上下文。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type NoteItem, type PostListItem } from '../../api'
import { Drawer } from '../../components/framework/Drawer'
import { EmptyState } from '../../components/framework/EmptyState'
import { Icon } from '../../components/framework/Icon'
import { collectTaxonomyItems, type TaxonomyKind } from '../../lib/taxonomy'

export function TaxonomyDrawer({ kind, name, onClose }: { kind: TaxonomyKind; name: string; onClose: () => void }) {
  const nav = useNavigate()
  const [posts, setPosts] = useState<PostListItem[] | null>(null)
  const [notes, setNotes] = useState<NoteItem[] | null>(null)

  useEffect(() => {
    let on = true
    api.get<{ items: PostListItem[] }>('/posts').then((r) => { if (on) setPosts(r.items) }).catch(() => { if (on) setPosts([]) })
    api.get<{ items: NoteItem[] }>('/workbench/notes').then((r) => { if (on) setNotes(r.items) }).catch(() => { if (on) setNotes([]) })
    return () => { on = false }
  }, [kind, name])

  const hit = posts && notes ? collectTaxonomyItems(kind, name, posts, notes) : null
  const total = hit ? hit.posts.length + hit.notes.length : 0
  const kindLabel = kind === 'category' ? '分类' : '标签'

  return (
    <Drawer width={560} title={`${kindLabel} · ${name}`} hint={`文章与灵感笔记共 ${total} 条`} onClose={onClose}>
      {!hit ? (
        <EmptyState>载入中…</EmptyState>
      ) : total === 0 ? (
        <EmptyState>该{kindLabel}下暂无内容</EmptyState>
      ) : (
        <>
          {hit.posts.length > 0 && (
            <section>
              <div className="txd-sec"><Icon name="file" size={14} /> 文章（{hit.posts.length}）</div>
              <div className="org-rel-list">
                {hit.posts.map((p) => (
                  <button key={p.id} className="org-rel-item" onClick={() => nav(`/posts/${p.id}/edit`)}>
                    <span className={`st-dot mini ${p.status}`} />
                    <span className="ori-t">{p.title || '（无标题）'}</span>
                    <em>{new Date(p.updatedAt).toLocaleDateString('zh-CN')}</em>
                  </button>
                ))}
              </div>
            </section>
          )}
          {hit.notes.length > 0 && (
            <section>
              <div className="txd-sec"><Icon name="book" size={14} /> 灵感笔记（{hit.notes.length}）</div>
              <div className="org-rel-list">
                {hit.notes.map((n) => (
                  <button key={n.id} className="org-rel-item" onClick={() => nav(`/notes?focus=${n.id}`)}>
                    <span className="st-dot mini published" />
                    <span className="ori-t">{n.title || n.body.slice(0, 40) || '（无标题）'}</span>
                    <em>{n.date}</em>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </Drawer>
  )
}
