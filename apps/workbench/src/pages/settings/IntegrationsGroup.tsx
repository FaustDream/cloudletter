import { errMsg } from '../../lib/errors'
/**
 * 设置中心 · 集成与链接分组（从 SettingsPage 拆出）：
 * - SMTP 状态、RSS 公开订阅地址
 * - API 凭据（创建 / 脱敏查看 / 撤销）、Webhook（事件 / 签名 / 调用日志 / 重试）、RSS 订阅
 * - 数据加载：凭据 / Webhook / 订阅挂载即拉取（原 loadAll 拆分至此）
 */
import { useEffect, useState } from 'react'
import { useToast } from '../../components/framework/Toast'
import { api } from '../../api'
import { Sec, Row, fmtTime } from './shared'

export const IntegrationsGroup = () => {
  const toast = useToast()

  // 集成
  const [creds, setCreds] = useState<Array<Record<string, unknown>>>([])
  const [newCredName, setNewCredName] = useState('')
  const [newCredScopes, setNewCredScopes] = useState<string[]>(['posts.read'])
  const [credKeyOnce, setCredKeyOnce] = useState<string | null>(null)
  const [hooks, setHooks] = useState<Array<Record<string, unknown>>>([])
  const [hookEditing, setHookEditing] = useState<Record<string, unknown> | null>(null)
  const [hookCalls, setHookCalls] = useState<Record<string, Array<Record<string, unknown>>>>({})
  const [feeds, setFeeds] = useState<Array<Record<string, unknown>>>([])
  const [feedUrl, setFeedUrl] = useState('')
  const [feedBusy, setFeedBusy] = useState(false)

  const loadCreds = () => { api.get<{ items: Array<Record<string, unknown>> }>('/integrations/api-credentials').then((r) => setCreds(r.items)).catch(() => {}) }
  const loadHooks = () => { api.get<{ items: Array<Record<string, unknown>> }>('/integrations/webhooks').then((r) => setHooks(r.items)).catch(() => {}) }
  const loadFeeds = () => { api.get<{ items: Array<Record<string, unknown>> }>('/feeds').then((r) => setFeeds(r.items)).catch(() => {}) }

  // 挂载即加载（原 loadAll 按需拆分）
  useEffect(() => {
    loadCreds()
    loadHooks()
    loadFeeds()
  }, [])

  /* ========== 集成（API 凭据 / Webhook / RSS） ========== */
  const createCred = async () => {
    if (!newCredName.trim()) { toast('请输入凭据名称', 'err'); return }
    try {
      const r = await api.post<{ key: string; name: string }>('/integrations/api-credentials', { name: newCredName, scopes: newCredScopes })
      setCredKeyOnce(`${r.name}: ${r.key}`)
      setNewCredName('')
      loadCreds()
    } catch (e: unknown) { toast(errMsg(e, '创建失败'), 'err') }
  }
  const revokeCred = async (id: string) => {
    try { await api.del(`/integrations/api-credentials/${id}`); loadCreds(); toast('凭据已撤销') }
    catch (e: unknown) { toast(errMsg(e, '撤销失败'), 'err') }
  }
  const saveHook = async (payload: Record<string, unknown>) => {
    try {
      if (hookEditing?.id) await api.put(`/integrations/webhooks/${hookEditing.id}`, payload)
      else await api.post('/integrations/webhooks', payload)
      setHookEditing(null); loadHooks(); toast('Webhook 已保存')
    } catch (e: unknown) { toast(errMsg(e, '保存失败'), 'err') }
  }
  const toggleHook = async (h: Record<string, unknown>) => {
    try { await api.put(`/integrations/webhooks/${h.id}`, { enabled: !h.enabled }); loadHooks() }
    catch (e: unknown) { toast(errMsg(e, '操作失败'), 'err') }
  }
  const deleteHook = async (id: string) => {
    try { await api.del(`/integrations/webhooks/${id}`); loadHooks(); toast('Webhook 已删除') }
    catch (e: unknown) { toast(errMsg(e, '删除失败'), 'err') }
  }
  const testHook = async (id: string) => {
    try {
      const r = await api.post<{ ok: boolean; status: number; message: string }>(`/integrations/webhooks/${id}/test`)
      toast(r.message)
      loadHooks()
    } catch (e: unknown) { toast(errMsg(e, '测试失败'), 'err') }
  }
  const showCalls = async (id: string) => {
    try {
      const r = await api.get<{ items: Array<Record<string, unknown>> }>(`/integrations/webhooks/${id}/calls`)
      setHookCalls((p) => ({ ...p, [id]: r.items }))
    } catch { /* ignore */ }
  }
  const subscribeFeed = async () => {
    if (!feedUrl.trim()) { toast('请输入订阅源 URL', 'err'); return }
    setFeedBusy(true)
    try {
      const r = await api.post<{ ok: boolean; title: string; added: number }>('/feeds/subscribe', { url: feedUrl.trim() })
      toast(`已订阅「${r.title}」（首拉 ${r.added} 条）`)
      setFeedUrl(''); loadFeeds()
    } catch (e: unknown) { toast(errMsg(e, '订阅失败'), 'err') } finally { setFeedBusy(false) }
  }
  const refreshFeed = async (id: string) => {
    try {
      const r = await api.post<{ ok: boolean; added: number }>(`/feeds/${id}/refresh`)
      toast(`订阅刷新完成（新增 ${r.added} 条）`)
      loadFeeds()
    } catch (e: unknown) { toast(errMsg(e, '刷新失败'), 'err') }
  }
  const removeFeed = async (id: string) => {
    try { await api.del(`/feeds/${id}`); loadFeeds(); toast('已取消订阅') }
    catch (e: unknown) { toast(errMsg(e, '操作失败'), 'err') }
  }

  return (
    <>
      <Sec icon="link" title="已连接服务">
        <Row k="SMTP 邮件" tip="验证码 / 解锁 / 重置邮件通道"><span className="pill ok">已配置</span></Row>
        <Row k="RSS Feed" tip="公开订阅地址，供其他博客互相关注">
          <code>{location.origin}/api/v2/rss.xml</code>
        </Row>
      </Sec>
      <Sec icon="key" title="API 凭据" tip="创建 / 查看（脱敏）/ 撤销；明文密钥仅创建时展示一次，库内只存哈希">
        <Row k="创建凭据">
          <input value={newCredName} onChange={(e) => setNewCredName(e.target.value)} placeholder="凭据名称（如 GitHub Action）" style={{ width: 200 }} />
          <select value={newCredScopes[0] ?? ''} onChange={(e) => setNewCredScopes([e.target.value])}>
            <option value="posts.read">posts.read（只读文章）</option>
            <option value="posts.write">posts.write（读写文章）</option>
            <option value="timeline.read">timeline.read（读时间线）</option>
          </select>
          <button className="btn slim" onClick={createCred}>创建</button>
        </Row>
        {credKeyOnce && (
          <div className="cred-once">
            <b>⚠ 密钥仅此一次展示：</b>
            <code>{credKeyOnce}</code>
            <button className="btn slim ghost" onClick={() => { navigator.clipboard?.writeText(credKeyOnce.split(': ')[1] ?? ''); toast('已复制') }}>复制</button>
            <button className="btn slim ghost" onClick={() => setCredKeyOnce(null)}>我知道了</button>
          </div>
        )}
        <Row k="已创建">
          {creds.length === 0 ? <span className="dim">无凭据（明文密钥不落库，创建时仅展示一次）</span> : (
            <div className="cred-list">
              {creds.map((c) => (
                <div key={String(c.id)} className={`cred-row${c.revokedAt ? ' revoked' : ''}`}>
                  <b>{String(c.name)}</b><code>{String(c.prefix)}…</code><em>{String((c.scopes as string[])?.join('、') ?? '')}</em>
                  {c.lastUsedAt ? <i>最近使用 {fmtTime(String(c.lastUsedAt))}</i> : <i>未使用</i>}
                  {!c.revokedAt && <button className="btn slim ghost danger-ghost" onClick={() => void revokeCred(String(c.id))}>撤销</button>}
                  {Boolean(c.revokedAt) && <span className="pill bad">已撤销</span>}
                </div>
              ))}
            </div>
          )}
        </Row>
      </Sec>
      <Sec icon="globe" title="Webhook" tip="事件推送（创建/发布/更新/删除文章）；HMAC 签名、调用日志、失败自动重试 2 次">
        <Row k="新建 / 编辑">
          <div className="hook-editor">
            <input value={String(hookEditing?.name ?? '')} placeholder="名称（如通知机器人）" onChange={(e) => setHookEditing((h) => ({ ...(h ?? {}), name: e.target.value }))} />
            <input value={String(hookEditing?.url ?? '')} placeholder="https://example.com/hook" onChange={(e) => setHookEditing((h) => ({ ...(h ?? {}), url: e.target.value }))} />
            <label className="hook-ev" title="事件多选">
              {['post.published', 'post.created', 'post.updated', 'post.deleted'].map((ev) => {
                const list: string[] = Array.isArray(hookEditing?.events) ? (hookEditing.events as string[]) : []
                return (
                  <label key={ev}><input type="checkbox" checked={list.includes(ev)} onChange={(e) => {
                    const next = e.target.checked ? [...list, ev] : list.filter((x) => x !== ev)
                    setHookEditing((h) => ({ ...(h ?? {}), events: next }))
                  }} />{ev}</label>
                )
              })}
            </label>
            <input value={String(hookEditing?.secret ?? '')} placeholder="签名密钥（可选，HMAC-SHA256）" onChange={(e) => setHookEditing((h) => ({ ...(h ?? {}), secret: e.target.value }))} />
            <button className="btn slim" disabled={!hookEditing?.name || !hookEditing?.url}
              onClick={() => void saveHook({ name: hookEditing?.name, url: hookEditing?.url, events: Array.isArray(hookEditing?.events) ? hookEditing.events : [], secret: hookEditing?.secret, enabled: hookEditing?.enabled ?? true })}>
              保存
            </button>
            {!!hookEditing?.id && <button className="btn slim ghost" onClick={() => setHookEditing(null)}>取消</button>}
            {!hookEditing && <button className="btn slim ghost" onClick={() => setHookEditing({ name: '', url: '', events: ['post.published'], secret: '', enabled: true })}>＋ 新建</button>}
          </div>
        </Row>
        <Row k="已配置">
          {hooks.length === 0 ? <span className="dim">暂无 Webhook（创建后发布文章将自动推送）</span> : (
            <div className="hook-list">
              {hooks.map((h) => (
                <div key={String(h.id)} className="hook-row">
                  <span className={`pill ${h.enabled ? 'ok' : ''}`}>{h.enabled ? '启用' : '停用'}</span>
                  <b>{String(h.name)}</b>
                  <code>{String(h.url)}</code>
                  <em>{String((h.events as string[])?.join('、') ?? '')}</em>
                  <i>{h.enabled ? (h.lastStatus ? `最近 HTTP ${h.lastStatus}` : '未调用') : '已停用'}</i>
                  <button className="btn slim ghost" onClick={() => { setHookEditing({ ...h, secret: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>编辑</button>
                  <button className="btn slim ghost" onClick={() => void testHook(String(h.id))}>测试</button>
                  <button className="btn slim ghost" onClick={() => void toggleHook(h)}>{h.enabled ? '停用' : '启用'}</button>
                  <button className="btn slim ghost" onClick={() => void showCalls(String(h.id))}>调用日志</button>
                  <button className="btn slim ghost danger-ghost" onClick={() => void deleteHook(String(h.id))}>删除</button>
                  {hookCalls[String(h.id)] ? (
                    <div className="hook-calls">
                      {(hookCalls[String(h.id)] as Array<{ id: string; event: string; status: number; error: string; sentAt: string }>).map((c) => (
                        <div key={c.id}><code>HTTP {c.status}</code><em>{c.event}</em><i>{fmtTime(c.sentAt)}</i>{c.error ? <b>{c.error}</b> : null}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Row>
      </Sec>
      <Sec icon="bell" title="RSS 订阅（互相关注）" tip="订阅其他伙伴博客的 RSS/Atom 源，内容发现与随缘抓取（点击刷新）">
        <Row k="添加订阅">
          <input value={feedUrl} onChange={(e) => setFeedUrl(e.target.value)} placeholder="https://example.com/rss.xml" style={{ width: 300 }} />
          <button className="btn slim" onClick={subscribeFeed} disabled={feedBusy}>{feedBusy ? '抓取中…' : '订阅'}</button>
        </Row>
        <Row k="已订阅">
          {feeds.length === 0 ? <span className="dim">暂无订阅（支持 RSS 2.0 / Atom）</span> : (
            <div className="feed-list">
              {feeds.map((f) => (
                <div key={String(f.id)} className="feed-row">
                  <b>{String(f.title)}</b>
                  <a href={String(f.url)} target="_blank" rel="noreferrer noopener">{String(f.url)}</a>
                  <em>{String(f.itemCount ?? 0)} 条内容</em>
                  <button className="btn slim ghost" onClick={() => void refreshFeed(String(f.id))}>刷新</button>
                  <button className="btn slim ghost danger-ghost" onClick={() => void removeFeed(String(f.id))}>取消订阅</button>
                </div>
              ))}
            </div>
          )}
        </Row>
      </Sec>
    </>
  )
}
