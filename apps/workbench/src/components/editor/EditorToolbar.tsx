/**
 * 常驻通用格式工具栏（重制版）：
 * - 撤销/重做 | 标题下拉（正文/H1-H6）| 加粗/斜体/下划线/删除线 | 文字色/背景色（含默认黑/白）|
 *   引用/无序/有序/待办/折叠列表 + 列表标记样式（无序：圆点/圆/方块；有序：数字/字母/罗马）|
 *   缩进/减进 | 清除格式 | 双链/识别双链/一键排版 | 链接/图片/表格/分割线/行内代码/代码块/提示框/嵌入网页/视频
 * - 全部图标 = Lucide 风格线性 SVG（stroke 渲染，无锯齿）；按钮 onMouseDown preventDefault 保持选区
 * - 标题/颜色/链接/图片/视频等交互均用弹层（保留编辑器选区），不用 window.prompt
 * - 列表标记样式写入块的自定义 prop listStyle，经 lib/listStyles 注释桥在 markdown 真相源中持久化
 */
import { useEffect, useRef, useState } from 'react'
import type { BlockNoteEditor, PartialBlock } from '@blocknote/core'
import { autoFormatMarkdown, recognizeWikilinksInMarkdown } from '../../lib/docTransforms'
import { applyDocTransform, createWikilink, selectedEditorText } from './docActions'
import { Icon } from '../framework/Icon'
import { nextBulletStyle, nextOrderedStyle, BULLET_STYLES, ORDERED_STYLES, LIST_STYLE_LABEL, type ListStyle } from '../../lib/listStyles'

type Editor = BlockNoteEditor<any, any, any>

/** 文字色/背景色：默认值显示为「正常颜色」（文字默认黑、背景默认白），其余为拖自调色板的常用色 */
const TEXT_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'cyan', 'default'] as const
const COLOR_HEX: Record<string, string> = {
  red: '#e0483d', orange: '#e0791f', yellow: '#ddb42e', green: '#3aa052',
  blue: '#3b82d6', cyan: '#06b6d4', default: 'transparent',
}
const COLOR_DEFAULT_HEX: Record<string, string> = {
  textColor: '#16181d',
  backgroundColor: '#ffffff',
}

const HEADING_OPTIONS: Array<{ level: number; label: string }> = [
  { level: 0, label: '正文' },
  { level: 1, label: '标题 1' },
  { level: 2, label: '标题 2' },
  { level: 3, label: '标题 3' },
  { level: 4, label: '标题 4' },
  { level: 5, label: '标题 5' },
  { level: 6, label: '标题 6' },
]

const CLEARABLE_STYLES: Record<string, unknown> = {
  bold: true, italic: true, underline: true, strike: true,
  code: true, textColor: 'default', backgroundColor: 'default',
}

export function EditorToolbar({ editor, titles, currentTitle, onImageUpload, notify }: {
  editor: Editor
  titles?: string[]
  currentTitle?: string
  onImageUpload?: (file: File) => Promise<string | null>
  notify?: (message: string, kind?: 'ok' | 'err') => void
}) {
  const [, setTick] = useState(0)
  const [headingOpen, setHeadingOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [bulletStyleOpen, setBulletStyleOpen] = useState(false)
  const [orderStyleOpen, setOrderStyleOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkDraft, setLinkDraft] = useState('')
  const [imgOpen, setImgOpen] = useState(false)
  const [imgUrlDraft, setImgUrlDraft] = useState('')
  const [vidOpen, setVidOpen] = useState(false)
  const [vidUrlDraft, setVidUrlDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    const offSel = editor.onSelectionChange(bump)
    editor.onEditorContentChange(bump)
    return offSel
  }, [editor])

  const cursor = editor.getTextCursorPosition()
  const block = cursor.block
  const styles = editor.getActiveStyles()
  const listStyle = block?.props?.listStyle as string | undefined

  const setHeading = (n: number) => {
    if (n === 0) editor.updateBlock(block, { type: 'paragraph' })
    else if (block.type === 'heading' && block.props.level === n) editor.updateBlock(block, { type: 'paragraph' })
    else editor.updateBlock(block, { type: 'heading', props: { level: n } })
    setHeadingOpen(false)
  }

  const LIST_TYPES = ['quote', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'codeBlock', 'callout', 'embed'] as const
  const toggleBlockType = (type: (typeof LIST_TYPES)[number]) => {
    editor.updateBlock(block, { type: block.type === type ? 'paragraph' : type })
  }

  const setListStyle = (kind: 'bullet' | 'ordered', next?: ListStyle) => {
    const cur = listStyle as ListStyle | undefined
    const target = next ?? (kind === 'bullet' ? nextBulletStyle(cur) : nextOrderedStyle(cur))
    const t = kind === 'bullet' ? 'bulletListItem' : 'numberedListItem'
    // 当前块若不是目标列表则先转换，再落样式
    editor.updateBlock(block, block.type === t ? { props: { listStyle: target } } : { type: t, props: { listStyle: target } })
    setBulletStyleOpen(false)
    setOrderStyleOpen(false)
  }

  const clearFormat = () => {
    editor.removeStyles(CLEARABLE_STYLES as never)
    if (['heading', 'quote', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggleListItem', 'codeBlock', 'callout'].includes(block.type)) {
      editor.updateBlock(block, { type: 'paragraph' })
    }
  }

  const selectedText = (): string => {
    const text = selectedEditorText()
    if (!text) notify?.('请先选中要处理的文字', 'err')
    return text
  }

  const applyTransform = async (label: string, fn: (md: string) => { md: string; count: number }) => {
    const n = await applyDocTransform(editor, fn)
    notify?.(n < 0 ? `${label}：没有需要处理的内容` : `${label}：已处理 ${n} 处（Ctrl+Z 可撤销）`)
  }

  const insertAfter = (partial: PartialBlock<any>) => {
    editor.insertBlocks([partial], block, 'after')
  }

  const commitLink = () => {
    const url = linkDraft.trim()
    if (!url) return
    editor.createLink(url)
    setLinkOpen(false)
    setLinkDraft('')
  }

  const uploadAndInsert = async (file: File, kind: 'image' | 'video') => {
    if (!onImageUpload) return
    const url = await onImageUpload(file)
    if (url) {
      if (kind === 'image') insertAfter({ type: 'image', props: { url } } as never)
      else insertAfter({ type: 'video', props: { url } } as never)
      notify?.(kind === 'image' ? '图片已插入' : '视频已插入，可直接播放')
    } else {
      notify?.(kind === 'image' ? '图片上传失败' : '视频上传失败', 'err')
    }
  }

  const btn = (key: string, title: string, active: boolean, onClick: () => void, icon: string, disabled?: boolean) => (
    <button
      key={key}
      type="button"
      className={`ed-tb-btn${active ? ' on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {icon === 'B' || icon === 'I' || icon === 'U' || icon === 'S'
        ? <b className={icon === 'B' ? 'tb-b' : icon === 'I' ? 'tb-i' : icon === 'U' ? 'tb-u' : 'tb-s'}>{icon}</b>
        : <Icon name={icon} size={17} />}
    </button>
  )

  /** 弹层容器：触发按钮 + 遮罩 + 浮层（全局样式 .ed-tb-popwrap/.ed-tb-pop） */

  const colorRow = (field: 'textColor' | 'backgroundColor', label: string) => (
    <div className="ed-tb-color-row">
      <span>{label}</span>
      {TEXT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`ed-tb-swatch${styles[field] === c ? ' on' : ''}`}
          style={{ background: c === 'default' ? COLOR_DEFAULT_HEX[field] : COLOR_HEX[c] }}
          title={c === 'default' ? `${label}·默认（正常颜色）` : `${label}·${c}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.toggleStyles({ [field]: c })}
        />
      ))}
    </div>
  )

  const currentHeading = block.type === 'heading' ? Number(block.props.level) || 1 : 0

  return (
    <div className="ed-toolbar" role="toolbar" aria-label="格式工具栏">
      {btn('undo', '撤销（Ctrl+Z）', false, () => editor.undo(), 'undo')}
      {btn('redo', '重做（Ctrl+Shift+Z）', false, () => editor.redo(), 'redo')}
      <i className="ed-tb-sep" />

      {/* 标题下拉：正文 / 标题1-6 */}
      <div className={`ed-tb-popwrap${headingOpen ? ' open' : ''}`}>
        {btn('heading', '标题级别（正文 / 标题1-6）', block.type === 'heading', () => setHeadingOpen((v) => !v), 'heading')}
        <span className="ed-tb-hd-label">{HEADING_OPTIONS[currentHeading]?.label ?? '正文'}</span>
        {headingOpen && (
          <>
            <div className="ed-tb-color-mask" onClick={() => setHeadingOpen(false)} />
            <div className="ed-tb-pop ed-tb-hd-menu" onMouseDown={(e) => e.preventDefault()}>
              {HEADING_OPTIONS.map((o) => (
                <button
                  key={o.level}
                  type="button"
                  className={`ed-tb-hd-item${currentHeading === o.level ? ' on' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setHeading(o.level)}
                >
                  {o.level === 0 ? <Icon name="paragraph" size={15} /> : <Icon name="heading" size={15} />}
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <i className="ed-tb-sep" />

      {/* 基础格式：加粗/斜体/下划线/删除线 */}
      {btn('bold', '加粗', Boolean(styles.bold), () => editor.toggleStyles({ bold: true }), 'B')}
      {btn('italic', '斜体', Boolean(styles.italic), () => editor.toggleStyles({ italic: true }), 'I')}
      {btn('underline', '下划线', Boolean(styles.underline), () => editor.toggleStyles({ underline: true }), 'U')}
      {btn('strike', '删除线', Boolean(styles.strike), () => editor.toggleStyles({ strike: true }), 'S')}

      {/* 文字色/背景色（含默认正常颜色） */}
      <div className={`ed-tb-popwrap${colorOpen ? ' open' : ''}`}>
        {btn('color', '文字颜色 / 背景色', colorOpen, () => setColorOpen((v) => !v), 'palette')}
        {colorOpen && (
          <>
            <div className="ed-tb-color-mask" onClick={() => setColorOpen(false)} />
            <div className="ed-tb-pop">
              {colorRow('textColor', '文字')}
              {colorRow('backgroundColor', '背景')}
            </div>
          </>
        )}
      </div>
      <i className="ed-tb-sep" />

      {/* 块类型：引用/无序/有序/待办/折叠 */}
      {btn('quote', '引用块', block.type === 'quote', () => toggleBlockType('quote'), 'quote')}
      {btn('bullet', '无序列表', block.type === 'bulletListItem', () => toggleBlockType('bulletListItem'), 'list')}
      {btn('numbered', '有序列表', block.type === 'numberedListItem', () => toggleBlockType('numberedListItem'), 'listOrdered')}
      {btn('check', '待办列表', block.type === 'checkListItem', () => toggleBlockType('checkListItem'), 'listChecks')}
      {btn('toggle', '折叠列表（可展开/收起）', block.type === 'toggleListItem', () => toggleBlockType('toggleListItem'), 'listToggle')}

      {/* 列表标记样式：无序 / 有序 */}
      <div className={`ed-tb-popwrap${bulletStyleOpen ? ' open' : ''}`}>
        {btn('bullsty', '无序列表标记样式', bulletStyleOpen, () => { setOrderStyleOpen(false); setBulletStyleOpen((v) => !v) }, 'list')}
        {bulletStyleOpen && (
          <>
            <div className="ed-tb-color-mask" onClick={() => setBulletStyleOpen(false)} />
            <div className="ed-tb-pop">
              {BULLET_STYLES.map((s) => (
                <button key={s} type="button" className={`ed-tb-hd-item${listStyle === s ? ' on' : ''}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => setListStyle('bullet', s)}>
                  <span className="ed-tb-listmark" data-marker={s} />{LIST_STYLE_LABEL[s]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className={`ed-tb-popwrap${orderStyleOpen ? ' open' : ''}`}>
        {btn('ordsty', '有序列表标记样式', orderStyleOpen, () => { setBulletStyleOpen(false); setOrderStyleOpen((v) => !v) }, 'listOrdered')}
        {orderStyleOpen && (
          <>
            <div className="ed-tb-color-mask" onClick={() => setOrderStyleOpen(false)} />
            <div className="ed-tb-pop">
              {ORDERED_STYLES.map((s) => (
                <button key={s} type="button" className={`ed-tb-hd-item${listStyle === s ? ' on' : ''}`}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => setListStyle('ordered', s)}>
                  <span className="ed-tb-omark" data-marker={s} />{LIST_STYLE_LABEL[s]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 缩进 / 减进 */}
      {btn('indent', '向右缩进', false, () => editor.nestBlock(), 'indent', !editor.canNestBlock())}
      {btn('outdent', '向左减进', false, () => editor.unnestBlock(), 'outdent', !editor.canUnnestBlock())}

      {/* 清除格式 */}
      {btn('clearfmt', '清除选中文字格式', false, clearFormat, 'eraser')}
      <i className="ed-tb-sep" />

      {/* 双链 / 识别双链 / 一键排版 */}
      {btn('wikilink', '双链：选中文字→包裹；未选中→插入 [[ 并唤起文章补全', false, () => {
        const r = createWikilink(editor)
        notify?.(r === 'wrapped' ? '已转为双链' : '已插入 [[ ：输入标题过滤，或从补全列表点选文章')
      }, 'link')}
      {btn('recognize', '识别双链：把正文里出现的其他文章标题自动包成 [[ ]]', false, () => {
        void applyTransform('识别双链', (md) => recognizeWikilinksInMarkdown(md, titles ?? [], { exclude: currentTitle }))
      }, 'wand')}
      {btn('autoformat', '一键排版：把「第一章 / 一、 / 1、」等序号行转为标题，自动生成大纲', false, () => {
        void applyTransform('一键排版', autoFormatMarkdown)
      }, 'spark')}
      <i className="ed-tb-sep" />

      {/* 链接（弹层输入，替代 window.prompt） */}
      <div className={`ed-tb-popwrap${linkOpen ? ' open' : ''}`}>
        {btn('link', '插入链接（先选中文字）', linkOpen, () => { setLinkDraft(''); setLinkOpen((v) => !v) }, 'link')}
        {linkOpen && (
          <>
            <div className="ed-tb-color-mask" onClick={() => setLinkOpen(false)} />
            <div className="ed-tb-pop ed-tb-input-pop">
              <input
                autoFocus value={linkDraft} placeholder="https://…"
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { commitLink(); e.preventDefault() } if (e.key === 'Escape') setLinkOpen(false) }}
              />
              <button className="ed-tb-pop-btn" onClick={commitLink}>确定</button>
            </div>
          </>
        )}
      </div>

      {/* 图片（上传 / 从链接插入） */}
      <div className={`ed-tb-popwrap${imgOpen ? ' open' : ''}`}>
        {btn('image', '插入图片（本地上传，或粘贴图片链接）', imgOpen, () => { setImgUrlDraft(''); setImgOpen((v) => !v) }, 'image')}
        {imgOpen && (
          <>
            <div className="ed-tb-color-mask" onClick={() => setImgOpen(false)} />
            <div className="ed-tb-pop ed-tb-input-pop">
              <button className="ed-tb-wide" onMouseDown={(e) => e.preventDefault()} onClick={() => { fileRef.current?.click(); setImgOpen(false) }}>
                <Icon name="download" size={15} /> 本地上传图片
              </button>
              <div className="ed-tb-input-line">
                <input value={imgUrlDraft} placeholder="粘贴图片链接（URL）…" onChange={(e) => setImgUrlDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const u = imgUrlDraft.trim(); if (u) { insertAfter({ type: 'image', props: { url: u } } as never); setImgOpen(false) } e.preventDefault() } }} />
                <button className="ed-tb-pop-btn" disabled={!imgUrlDraft.trim()} onClick={() => { const u = imgUrlDraft.trim(); if (u) { insertAfter({ type: 'image', props: { url: u } } as never); setImgOpen(false) } }}>插入</button>
              </div>
            </div>
          </>
        )}
      </div>

      {btn('table', '插入表格', false, () => insertAfter({
        type: 'table',
        content: { type: 'tableContent', rows: [{ cells: ['', ''] }, { cells: ['', ''] }] },
      } as never), 'table')}
      {btn('divider', '插入分割线', false, () => insertAfter({ type: 'divider' } as never), 'divider')}

      {/* 行内代码 + 代码块（挨在一起） */}
      {btn('code', '行内代码', Boolean(styles.code), () => editor.toggleStyles({ code: true }), 'code')}
      {btn('codeblock', '代码块', block.type === 'codeBlock', () => toggleBlockType('codeBlock'), 'codeblock')}

      {btn('callout', '提示框', block.type === 'callout', () => toggleBlockType('callout'), 'callout')}
      {btn('embed', '嵌入网页（视频/网页链接卡）', block.type === 'embed', () => toggleBlockType('embed'), 'globe')}

      {/* 视频（本地上传 / 在线视频链接） */}
      <div className={`ed-tb-popwrap${vidOpen ? ' open' : ''}`}>
        {btn('video', '插入视频（本地上传或在线链接，可直接播放）', block.type === 'embed', () => { setVidUrlDraft(''); setVidOpen((v) => !v) }, 'video')}
        {vidOpen && (
          <>
            <div className="ed-tb-color-mask" onClick={() => setVidOpen(false)} />
            <div className="ed-tb-pop ed-tb-input-pop">
              <button className="ed-tb-wide" onMouseDown={(e) => e.preventDefault()} onClick={() => { videoRef.current?.click(); setVidOpen(false) }}>
                <Icon name="download" size={15} /> 本地上传视频
              </button>
              <div className="ed-tb-input-line">
                <input value={vidUrlDraft} placeholder="粘贴在线视频链接（B站/YouTube/优酷…）" onChange={(e) => setVidUrlDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { const u = vidUrlDraft.trim(); if (u) { editor.updateBlock(block, { type: 'embed', props: { url: u } } as never); setVidOpen(false) } e.preventDefault() } }} />
                <button className="ed-tb-pop-btn" disabled={!vidUrlDraft.trim()} onClick={() => { const u = vidUrlDraft.trim(); if (u) { editor.updateBlock(block, { type: 'embed', props: { url: u } } as never); setVidOpen(false) } }}>嵌入</button>
              </div>
            </div>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void uploadAndInsert(f, 'image')
        }}
      />
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void uploadAndInsert(f, 'video')
        }}
      />
    </div>
  )
}