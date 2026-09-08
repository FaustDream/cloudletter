/**
 * 一次性授权管理面板（设置 · 隐私与安全）：创建授权（邮件送达）/ 列表 / 撤销。
 * 明文链接仅在创建响应返回一次（供人工转达兜底）；列表只展示状态不展示链接。
 */
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Dropdown } from '../framework/Dropdown'
import { Icon } from '../framework/Icon'
import { useToast } from '../framework/Toast'
import { confirmDialog } from '../framework/Modal'
import { SCOPE_LABELS } from '../../lib/guestApi'

const SCOPES = ['timeline', 'posts', 'notes', 'workplan', 'plan']

interface GrantRow {
  id: string
  email: string
  label: string
  scopes: string[]
  expiresAt: string
  firstUsedAt: string | null
  revokedAt: string | null
  createdAt: string
  status: 'active' | 'expired' | 'revoked'
}

const STATUS_META: Record<GrantRow['status'], { label: string; cls: string }> = {
  active: { label: '生效中', cls: 'ok' },
  expired: { label: '已过期', cls: 'dim' },
  revoked: { label: '已撤销', cls: 'warn' },
}

export function GrantsPanel() {
  const [rows, setRows] = useState<GrantRow[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set(['timeline']))
  const [ttlKey, setTtlKey] = useState('24h')
  const [creating, setCreating] = useState(false)
  const [madeLink, setMadeLink] = useState<string | null>(null)
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: GrantRow[] }>('/grants')
      .then((r) => setRows(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const toggleScope = (s: string) => setSel((cur) => {
    const n = new Set(cur); n.has(s) ? n.delete(s) : n.add(s); return n
  })

  const create = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { toast('请填写有效的访客邮箱', 'err'); return }
    if (sel.size === 0) { toast('至少选择一个授权范围', 'err'); return }
    setCreating(true)
    setMadeLink(null)
    try {
      const r = await api.post<{ link: string }>('/grants', { email: email.trim(), scopes: [...sel], ttlKey, label: label.trim() })
      setMadeLink(r.link)
      setEmail('')
      setLabel('')
      toast('授权邮件已发送')
      load()
    } catch (e: any) {
      toast(e?.message || '创建失败', 'err')
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (g: GrantRow) => {
    if (!(await confirmDialog({ title: '撤销授权', description: `撤销对 ${g.email} 的授权？其访客会话将立即失效。`, type: 'warning', confirmText: '撤销' }))) return
    try {
      await api.del(`/grants/${g.id}`)
      toast('授权已撤销')
      load()
    } catch (e: any) { toast(e?.message || '操作失败', 'err') }
  }

  return (
    <div className="grants-panel">
      {/* 创建 */}
      <div className="grant-create">
        <div className="grid g-2">
          <div>
            <div className="dim" style={{ fontSize: 'var(--fs-sm)', marginBottom: 4 }}>访客邮箱</div>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="guest@example.com" />
          </div>
          <div>
            <div className="dim" style={{ fontSize: 'var(--fs-sm)', marginBottom: 4 }}>有效期</div>
            <Dropdown
              value={ttlKey}
              align="left"
              options={[
                { value: '1h', label: '1 小时' },
                { value: '24h', label: '24 小时' },
                { value: '3d', label: '3 天' },
                { value: '7d', label: '7 天（上限）' },
              ]}
              onChange={(v) => setTtlKey(v)}
            />
          </div>
        </div>
        <div>
          <div className="dim" style={{ fontSize: 'var(--fs-sm)', margin: '8px 0 4px' }}>授权范围（只读，模块粒度）</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SCOPES.map((s) => (
              <button key={s} type="button" className={`seg-btn ${sel.has(s) ? 'on' : ''}`} onClick={() => toggleScope(s)}>{SCOPE_LABELS[s]}</button>
            ))}
          </div>
        </div>
        <div className="grid g-2" style={{ marginTop: 8 }}>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="备注（可选，如：给编辑部的审阅）" />
          <button className="btn" onClick={create} disabled={creating}>
            <Icon name="mail" size={15} /> {creating ? '发送中…' : '创建并发送授权邮件'}
          </button>
        </div>
        {madeLink && (
          <div className="grant-link-hint">
            邮件已发出。如需人工转达，授权链接（仅此一次展示）：
            <code>{madeLink}</code>
            <button className="btn slim ghost" onClick={() => { navigator.clipboard?.writeText(madeLink); toast('链接已复制') }}>复制</button>
          </div>
        )}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="dim" style={{ padding: '10px 0' }}>载入中…</div>
      ) : rows.length === 0 ? (
        <div className="dim" style={{ padding: '10px 0' }}>还没有创建过授权</div>
      ) : (
        <div className="wb-list" style={{ marginTop: 10 }}>
          {rows.map((g) => {
            const st = STATUS_META[g.status]
            return (
              <div key={g.id} className="wb-item">
                <div className="wtx">
                  <div className="wn">{g.email}{g.label ? <span className="dim"> · {g.label}</span> : null}</div>
                  <div className="wsub">{g.scopes.map((s) => SCOPE_LABELS[s] || s).join(' / ')}</div>
                  <div className="wst">
                    创建 {g.createdAt.slice(0, 16).replace('T', ' ')} · 到期 {g.expiresAt.slice(0, 16).replace('T', ' ')}
                    {g.firstUsedAt ? ` · 首次使用 ${g.firstUsedAt.slice(0, 16).replace('T', ' ')}` : ' · 未使用'}
                  </div>
                </div>
                <span className={`pill ${st.cls}`}>{st.label}</span>
                {g.status === 'active' && (
                  <button className="wdel" title="撤销授权" onClick={() => revoke(g)}><Icon name="x" size={15} /></button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
