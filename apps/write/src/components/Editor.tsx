/**
 * 编辑器：源码模式一等公民（ADR-003）。
 * CodeMirror6 编辑 §5 Markdown 原文；工具栏插入富块模板；
 * 粘贴自动识别（§5.3 R5）、`[[` 双链补全（§5.2.4）、聚焦模式（§8.1）。
 */
import { useMemo, useRef } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { detectPasted } from '../lib/paste-detect'
import type { PostListItem } from '../api'

export interface InsertAction {
  label: string
  hint: string
  template: string
}

export const INSERT_ACTIONS: InsertAction[] = [
  {
    label: '/api 接口块',
    hint: '结构化接口文档卡片',
    template: '\n```api\nmethod: GET\npath: /api/v1/example\nsummary: 接口说明\nparams:\n  - name: id\n    in: path\n    type: string\n    required: true\n    desc: 参数说明\nresponses:\n  - status: 200\n    desc: 成功\n    body: |\n      { "ok": true }\n```\n',
  },
  {
    label: '/params 参数表',
    hint: '独立参数表',
    template: '\n```params\n- name: page\n  type: number\n  required: false\n  default: "1"\n  desc: 页码\n```\n',
  },
  {
    label: '/tip 提示框',
    hint: 'note/tip/warning/danger',
    template: '\n:::tip\n提示内容\n:::\n',
  },
  {
    label: '/code 代码块',
    hint: '标题 + 行高亮',
    template: '\n```ts title="example.ts" {2}\nconst x = 1\nconst y = 2 // 高亮行\n```\n',
  },
  {
    label: '/link 双链',
    hint: '[[目标|显示]]',
    template: '[[笔记标题|显示文字]]',
  },
  { label: '/h2 二级标题', hint: '## 标题', template: '\n## ' },
  { label: '/table 表格', hint: 'Markdown 表格', template: '\n| 列A | 列B |\n| --- | --- |\n|  |  |\n' },
]

/** `[[` 双链补全 + 斜杠菜单（合并到单个 autocompletion 扩展，避免 override 冲突，§5.2.4 / §8.1） */
function completions(getTitles: () => string[]): Extension {
  return autocompletion({
    override: [
      // `[[` 双链补全：候选 = 现有文章标题
      (context: CompletionContext) => {
        const before = context.matchBefore(/\[\[[^\]\n|]*$/)
        if (!before && !context.explicit) return null
        const from = before ? before.from + 2 : context.pos
        const typed = before ? before.text.slice(2) : ''
        const titles = getTitles()
          .filter((t) => t.toLowerCase().includes(typed.toLowerCase()))
          .slice(0, 12)
        return {
          from,
          options: titles.map((t) => ({
            label: t,
            apply: `${t}]]`,
            type: 'text',
          })),
          validFor: /^[^\]\n|]*$/,
        }
      },
      // 斜杠菜单：输入 / 弹出 INSERT_ACTIONS 命令
      (context: CompletionContext) => {
        const before = context.matchBefore(/\/[a-z0-9]*$/)
        if (!before) return null
        const typed = before.text.slice(1).toLowerCase()
        const matches = INSERT_ACTIONS.filter((a) => {
          const cmd = a.label.split(' ')[0].slice(1).toLowerCase()
          return cmd.startsWith(typed)
        })
        if (!matches.length) return null
        return {
          from: before.from,
          options: matches.map((a) => ({
            label: a.label,
            detail: a.hint,
            apply: a.template.replace(/^\n/, ''),
          })),
          validFor: /^\/[a-z0-9]*$/,
        }
      },
    ],
  })
}

/** 粘贴自动识别（§5.3 R5）：命中启发式时改写为结构化块 */
function pasteDetection(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const text = event.clipboardData?.getData('text/plain')
      if (!text) return false
      const converted = detectPasted(text)
      if (converted === null) return false
      event.preventDefault()
      view.dispatch(
        view.state.replaceSelection(converted),
        { scrollIntoView: true },
      )
      return true
    },
  })
}

export function Editor({
  value,
  onChange,
  getLinkTargets,
  focusMode,
}: {
  value: string
  onChange: (v: string) => void
  /** 双链补全候选（现有文章标题） */
  getLinkTargets: () => string[]
  focusMode: boolean
}) {
  // 🟡W1 修复：useMemo([]) 会冻结首次渲染的 getLinkTargets，导致新增/改名标题
  // 永远不会出现在 `[[` 补全里。用 ref 持有最新回调，扩展本身保持稳定。
  const getLinkTargetsRef = useRef(getLinkTargets)
  getLinkTargetsRef.current = getLinkTargets

  const extensions = useMemo<Extension[]>(
    () => [
      markdown({ base: markdownLanguage }),
      completions(() => getLinkTargetsRef.current()),
      pasteDetection(),
    ],
    // 扩展依赖均为稳定引用（模块级函数），无需随 getLinkTargets 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <div className={`editor ${focusMode ? 'focus-mode' : ''}`}>
      <Toolbar onInsert={(tpl) => onChange(value + tpl)} />
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        height="100%"
        theme="dark"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          foldGutter: true,
        }}
      />
    </div>
  )
}

function Toolbar({ onInsert }: { onInsert: (tpl: string) => void }) {
  return (
    <div className="toolbar">
      {INSERT_ACTIONS.map((a) => (
        <button key={a.label} className="tool-btn" title={a.hint} onClick={() => onInsert(a.template)}>
          {a.label}
        </button>
      ))}
    </div>
  )
}
