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

export function MarkdownEditor({ value, onChange, minHeight = 220, uncontrolled = false }: {
  value: string
  onChange: (markdown: string) => void
  minHeight?: number
  /** 非受控模式：value 仅作初值，外部值变更不回灌（随手记等一次性编辑场景） */
  uncontrolled?: boolean
}) {
  return (
    <div className="mded" style={{ ['--mded-h' as string]: `${minHeight}px` }}>
      <Suspense fallback={<EditorSkeleton />}>
        <BlockNoteEditor
          value={value}
          onChange={onChange}
          uncontrolled={uncontrolled}
          onPasteImage={async (file) => { const r = await uploadImage(file); return r?.url ?? null }}
        />
      </Suspense>
    </div>
  )
}
