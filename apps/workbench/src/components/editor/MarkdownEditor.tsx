/**
 * Markdown 编辑器统一入口（Modal/Drawer 复用）：懒加载 BlockNoteEditor 内核，
 * markdown 字符串进出，统一图片上传；加载期间渲染骨架占位，避免阻塞弹窗打开。
 */
import { Suspense, lazy } from 'react'
import { uploadImage } from '../../api'

const BlockNoteEditor = lazy(() => import('./BlockNoteEditor').then((m) => ({ default: m.BlockNoteEditor })))

function EditorSkeleton() {
  return (
    <div className="mded-skeleton" aria-busy="true">
      <div className="mded-skeleton-bar" />
      <div className="mded-skeleton-line" style={{ width: '72%' }} />
      <div className="mded-skeleton-line" style={{ width: '88%' }} />
      <div className="mded-skeleton-line" style={{ width: '54%' }} />
    </div>
  )
}

export function MarkdownEditor({ value, onChange, minHeight = 220 }: {
  value: string
  onChange: (markdown: string) => void
  minHeight?: number
}) {
  return (
    <div className="mded" style={{ ['--mded-h' as string]: `${minHeight}px` }}>
      <Suspense fallback={<EditorSkeleton />}>
        <BlockNoteEditor
          value={value}
          onChange={onChange}
          onPasteImage={async (file) => { const r = await uploadImage(file); return r?.url ?? null }}
        />
      </Suspense>
    </div>
  )
}
