/** 左栏：知识库文件夹树 + 文章列表（§8.1 / N11：HTML5 拖拽移动） */
import { useState } from 'react'
import type { FolderNode, PostListItem } from '../api'

type DragState = { type: 'folder' | 'post'; id: string } | null

export function FolderTree({
  folders,
  posts,
  activeFolder,
  onSelectFolder,
  activePostId,
  onSelectPost,
  onCreateFolder,
  onCreatePost,
  onMoveFolder,
  onMovePost,
  filter,
  onFilterChange,
}: {
  folders: FolderNode[]
  posts: PostListItem[]
  activeFolder: string | null
  onSelectFolder: (id: string | null) => void
  activePostId: string | null
  onSelectPost: (id: string) => void
  onCreateFolder: (name: string, parentId: string | null) => void
  onCreatePost: (type: 'blog' | 'note', folderId: string | null) => void
  onMoveFolder: (folderId: string, parentId: string | null) => void
  onMovePost: (postId: string, folderId: string | null) => void
  filter: 'all' | 'blog' | 'note' | 'trashed'
  onFilterChange: (f: 'all' | 'blog' | 'note' | 'trashed') => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [newFolderName, setNewFolderName] = useState('')
  const [addingFolder, setAddingFolder] = useState(false)
  const [dragging, setDragging] = useState<DragState>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isDescendant = (folder: FolderNode, targetId: string): boolean =>
    folder.children.some((c) => c.id === targetId || isDescendant(c, targetId))

  const onDropToFolder = (target: FolderNode) => {
    if (!dragging) return
    if (dragging.type === 'folder') {
      if (dragging.id === target.id) return
      // 禁止移动到自身子树
      const src = findFolder(folders, dragging.id)
      if (src && isDescendant(src, target.id)) return
      onMoveFolder(dragging.id, target.id)
    } else {
      onMovePost(dragging.id, target.id)
    }
    setDragging(null)
    setDropTarget(null)
  }

  const onDropToRoot = () => {
    if (!dragging) return
    if (dragging.type === 'folder') onMoveFolder(dragging.id, null)
    else onMovePost(dragging.id, null)
    setDragging(null)
    setDropTarget(null)
  }

  const renderNode = (node: FolderNode, depth: number): React.ReactNode => (
    <div key={node.id}>
      <div
        className={`tree-node ${activeFolder === node.id ? 'active' : ''} ${dropTarget === node.id ? 'drop-target' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        draggable
        onDragStart={(e) => {
          setDragging({ type: 'folder', id: node.id })
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragEnd={() => {
          setDragging(null)
          setDropTarget(null)
        }}
        onDragOver={(e) => {
          if (dragging) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget(node.id)
          }
        }}
        onDrop={() => onDropToFolder(node)}
        onClick={() => {
          onSelectFolder(node.id)
          toggle(node.id)
        }}
      >
        <span className={`tree-caret ${expanded.has(node.id) ? 'open' : ''}`}>
          {node.children.length > 0 ? '▸' : '·'}
        </span>
        <span className="tree-icon">📁</span>
        {node.name}
      </div>
      {expanded.has(node.id) && node.children.map((c) => renderNode(c, depth + 1))}
    </div>
  )

  return (
    <div className="sidebar">
      <div className="filter-tabs">
        {(['all', 'blog', 'note', 'trashed'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => onFilterChange(f)}>
            {f === 'all' ? '全部' : f === 'blog' ? '博客' : f === 'note' ? '笔记' : '回收站'}
          </button>
        ))}
      </div>

      <div className="sidebar-actions">
        <button className="btn primary" onClick={() => onCreatePost('blog', activeFolder)}>
          ＋ 新文章
        </button>
        <button className="btn" onClick={() => onCreatePost('note', activeFolder)}>
          ＋ 笔记
        </button>
        <button className="btn slim" onClick={() => setAddingFolder((v) => !v)}>
          ＋ 文件夹
        </button>
        {addingFolder && (
          <form
            className="new-folder-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (newFolderName.trim()) {
                onCreateFolder(newFolderName.trim(), activeFolder)
                setNewFolderName('')
                setAddingFolder(false)
              }
            }}
          >
            <input
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="文件夹名"
            />
          </form>
        )}
      </div>

      <div className="tree">
        <div
          className={`tree-node ${activeFolder === null ? 'active' : ''} ${dropTarget === '__root__' ? 'drop-target' : ''}`}
          style={{ paddingLeft: 12 }}
          draggable={false}
          onDragOver={(e) => {
            if (dragging) {
              e.preventDefault()
              setDropTarget('__root__')
            }
          }}
          onDrop={onDropToRoot}
          onClick={() => onSelectFolder(null)}
        >
          <span className="tree-icon">🏠</span>
          根目录
        </div>
        {folders.map((f) => renderNode(f, 0))}
      </div>

      <div className="post-list">
        {posts.length === 0 && <div className="empty">暂无内容</div>}
        {posts.map((p) => (
          <div
            key={p.id}
            className={`post-item ${activePostId === p.id ? 'active' : ''}`}
            draggable
            onDragStart={(e) => {
              setDragging({ type: 'post', id: p.id })
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              setDragging(null)
              setDropTarget(null)
            }}
            onClick={() => onSelectPost(p.id)}
          >
            <span className={`status-dot ${p.status}`} title={p.status} />
            <span className="post-title">{p.title || '（无标题）'}</span>
            <span className="post-type">{p.type === 'note' ? '笔记' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function findFolder(nodes: FolderNode[], id: string): FolderNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const r = findFolder(n.children, id)
    if (r) return r
  }
  return null
}
