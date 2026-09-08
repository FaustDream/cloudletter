/** 顶栏导出菜单：Markdown / 自包含 HTML / 打印·PDF */
import { useState } from 'react'
import { Icon } from '../framework/Icon'
import { exportHtmlFile, exportMarkdownFile, printPost } from '../../lib/exporters'

export function ExportMenu({ meta, markdown, disabled }: {
  meta: Parameters<typeof exportMarkdownFile>[0]
  markdown: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const run = (fn: () => void) => { setOpen(false); try { fn() } catch (e) { console.error(e) } }
  return (
    <div className="ed-export">
      <button className="btn slim ghost" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        <Icon name="download" size={15} /> 导出 <span className="ed-export-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="ed-export-mask" onClick={() => setOpen(false)} />
          <div className="ed-export-menu">
            <button onClick={() => run(() => exportMarkdownFile(meta, markdown))}>
              <b>Markdown</b><em>.md 原文，零转换</em>
            </button>
            <button onClick={() => run(() => exportHtmlFile(meta, markdown))}>
              <b>HTML 文件</b><em>自包含网页，可分享/存档</em>
            </button>
            <button onClick={() => run(() => printPost(meta, markdown))}>
              <b>打印 · PDF</b><em>经系统打印另存为 PDF</em>
            </button>
          </div>
        </>
      )}
    </div>
  )
}