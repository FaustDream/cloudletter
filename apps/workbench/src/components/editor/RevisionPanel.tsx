/** 版本快照对比（自 write 应用并入）：列出版本 → 查看差异 → 恢复 */
import { useEffect, useState } from 'react'
import { api, type RevMeta, type RevDetail } from '../../api'

export function RevisionPanel({
  postId,
  currentMarkdown,
  onRestored,
  onClose,
}: {
  postId: string
  currentMarkdown: string
  onRestored: (markdown: string) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<RevMeta[]>([])
  const [selected, setSelected] = useState<RevDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<{ items: RevMeta[] }>(`/posts/${postId}/revisions`)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [postId])

  const open = async (version: number) => {
    setBusy(true)
    setError('')
    try {
      const r = await api.get<RevDetail>(`/posts/${postId}/revisions/${version}`)
      setSelected(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await api.post(`/posts/${postId}/revisions/${selected.version}/restore`)
      onRestored(selected.content)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const diff = selected ? lineDiff(selected.content, currentMarkdown) : []

  return (
    <div className="rev-mask" onClick={onClose}>
      <div className="rev-dialog" onClick={(e) => e.stopPropagation()}>
        <header className="rev-head">
          <span className="rev-title">版本历史</span>
          <button className="btn slim" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="rev-body">
          <div className="rev-list">
            {items.length === 0 && <div className="rev-empty">暂无历史版本</div>}
            {items.map((r) => (
              <button
                key={r.id}
                className={`rev-item ${selected?.version === r.version ? 'active' : ''}`}
                onClick={() => open(r.version)}
              >
                <span className="rev-version">v{r.version}</span>
                <span className={`rev-kind ${r.kind === 'manual' ? 'manual' : 'auto'}`}>
                  {r.kind === 'manual' ? '手动' : '自动'}
                </span>
                <span className="rev-time">{new Date(r.createdAt).toLocaleString()}</span>
              </button>
            ))}
          </div>
          <div className="rev-diff">
            {busy && <div className="rev-empty">载入中…</div>}
            {error && <div className="rev-error">{error}</div>}
            {selected && !busy && (
              <>
                <div className="rev-diff-legend">
                  <span className="leg-add">＋ 新增（相对当前）</span>
                  <span className="leg-del">－ 删除（相对当前）</span>
                </div>
                <pre className="rev-diff-code">
                  {diff.map((d, i) => (
                    <div key={i} className={`diff-line ${d.type}`}>
                      <span className="diff-sign">{d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' '}</span>
                      {d.text || ' '}
                    </div>
                  ))}
                </pre>
              </>
            )}
          </div>
        </div>
        <footer className="rev-foot">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button className="btn warn" disabled={!selected || busy} onClick={restore}>
            恢复此版本
          </button>
        </footer>
      </div>
    </div>
  )
}

/* ========== 行级 diff（LCS） ========== */

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string }

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  // LCS 长度表
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  // 回溯生成 diff（old 视角：del 表示 old 有而 new 无；add 表示 new 有而 old 无）
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}
