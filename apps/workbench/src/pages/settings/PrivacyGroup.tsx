import { errMsg } from '../../lib/errors'
/**
 * 设置中心 · 隐私与安全 + 数据与存储分组（从 SettingsPage 拆出）：
 * - 可见性默认值、一次性授权、活动日志（完整列表 + 日志导出/导入，挂载即拉取）
 * - 存储模式如实显示、数据导入/导出（完整迁移）、偏好缓存清理
 */
import { useEffect, useState } from 'react'
import { useToast } from '../../components/framework/Toast'
import { Dropdown } from '../../components/framework/Dropdown'
import { GrantsPanel } from '../../components/settings/GrantsPanel'
import { api } from '../../api'
import { todayYMD } from '../../lib/date'
import { exportDataBundle } from '../settingsHelpers'
import { Sec, Row, fmtTime } from './shared'

/** 活动日志行（/activity 返回结构） */
interface LogRow { id: string; action: string; object: string; result: string; detail: string; client: string; ip: string; at: string }

export const PrivacyGroup = ({ g }: { g: 'privacy' | 'data' }) => {
  const toast = useToast()

  // 隐私 / 数据
  const [vis, setVis] = useState(localStorage.getItem('cl_visibility_default') || 'private')
  const [logs, setLogs] = useState<LogRow[]>([])
  const [logLabels, setLogLabels] = useState<Record<string, string>>({})
  const [logPage, setLogPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)
  const [logAction, setLogAction] = useState('')
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const storageMode: 'server' | 'local' = 'server' // 展示用：SQLite 服务器存储 + Markdown 真相源（固定架构，无切换）

  const loadLogs = (page: number) => {
    api.get<{ items: LogRow[]; total: number; pages: number; page: number; labels: Record<string, string> }>(`/activity?page=${page}${logAction ? `&action=${logAction}` : ''}`)
      .then((r) => { setLogs(r.items); setLogTotal(r.total); setLogPage(r.page); setLogLabels(r.labels) })
      .catch(() => {})
  }

  // 挂载即加载（原 loadAll 按需拆分）
  useEffect(() => { loadLogs(1) }, [])

  /* ========== 隐私与安全 ========== */
  const exportLogs = async () => {
    setExporting(true)
    try {
      const bundle = await api.post<any>('/activity/export')
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `cloudletter-activity-log-${todayYMD()}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast('活动日志已导出（登录 / 操作 / 安全 / 重大事件）')
    } catch (e: unknown) { toast(errMsg(e, '导出失败'), 'err') } finally { setExporting(false) }
  }
  const importLogs = async (file: File) => {
    setImporting(true)
    try {
      const text = await file.text()
      const bundle = JSON.parse(text)
      const r = await api.post<{ ok: boolean; added: number }>('/activity/import', { bundle })
      toast(`活动日志导入完成（新增 ${r.added} 条，仅合并不覆盖）`)
      loadLogs(1)
    } catch (e: unknown) { toast(errMsg(e, '导入失败：请确认是云笺集活动日志文件'), 'err') } finally { setImporting(false) }
  }

  /* ========== 数据与存储（导入 / 导出） ========== */
  const exportData = async () => {
    setExporting(true)
    try {
      await exportDataBundle(toast)
    } catch (e: unknown) { toast(errMsg(e, '导出失败'), 'err') } finally { setExporting(false) }
  }
  const importData = async (file: File) => {
    setImporting(true)
    try {
      const bundle = JSON.parse(await file.text())
      const r = await api.post<{ ok: boolean; counts: Record<string, { total: number; added: number; skipped: number }> }>(
        '/workbench/data/import', { bundle, conflict: 'skip' })
      const parts = Object.entries(r.counts).map(([k, v]) => `${k} 新增 ${v.added} / 跳过 ${v.skipped}`)
      toast(`数据导入完成：${parts.join('，')}（冲突自动跳过，可重复导入不重复）`)
    } catch (e: unknown) { toast(errMsg(e, '导入失败：请确认是云笺集备份文件'), 'err') } finally { setImporting(false) }
  }
  const clearCache = () => {
    // 登录态(cl_token)、设备标识(cl_dev)、登录会话标记与导览关闭记录不清——否则导览会在用户选了「永不提示」后再次弹出
    Object.keys(localStorage).filter((k) => k.startsWith('cl_') && !['cl_token', 'cl_dev', 'cl_login_epoch', 'cl_org_tour'].includes(k)).forEach((k) => localStorage.removeItem(k))
    toast('本地偏好缓存已清理（登录态、设备标识与导览设置保留）')
  }

  return (
    <>
      {g === 'privacy' && (
        <>
          <Sec icon="eye" title="可见性默认值">
            <Row k="内容默认可见性" tip="新记录默认公开还是仅自己">
              <Dropdown value={vis} options={[{ value: 'private', label: '仅自己' }, { value: 'public', label: '公开' }]} onChange={(v) => { setVis(v); localStorage.setItem('cl_visibility_default', v) }} />
            </Row>
          </Sec>
          <Sec icon="key" title="一次性授权" tip="给访客发邮件链接，临时只读查看指定模块，到期自动失效">
            <GrantsPanel />
          </Sec>
          <Sec icon="clock" title="活动日志" tip="登录 / 登出 / 改密 / 2FA / 文章增删改 / 导入导出 / 站点配置 / API / Webhook 等重大操作全部留痕，仅追加不可删改">
            <div className="log-toolbar">
              <select value={logAction} onChange={(e) => { setLogAction(e.target.value); loadLogs(1) }}>
                <option value="">全部类型</option>
                {Object.entries(logLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <span className="dim">共 {logTotal} 条</span>
              <span className="spacer" />
              <button className="btn slim ghost" onClick={exportLogs} disabled={exporting}>{exporting ? '导出中…' : '导出日志'}</button>
              <label className="btn slim ghost file-btn" title="导入云笺集活动日志 JSON（仅合并不覆盖）">
                {importing ? '导入中…' : '导入日志'}
                <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importLogs(f); e.target.value = '' }} />
              </label>
            </div>
            <div className="log-list">
              {logs.length === 0 && <span className="dim">暂无日志</span>}
              {logs.map((l) => (
                <div key={l.id} className="log-row">
                  <span className={`pill ${l.result === 'fail' ? 'bad' : 'ok'}`}>{l.result === 'fail' ? '失败' : '成功'}</span>
                  <b>{logLabels[l.action] ?? l.action}</b>
                  <em>{l.object}</em>
                  <code>{fmtTime(l.at)}</code>
                  <i>{l.ip || '—'}</i>
                </div>
              ))}
            </div>
            <div className="log-pager">
              <button className="btn slim ghost" disabled={logPage <= 1} onClick={() => loadLogs(logPage - 1)}>上一页</button>
              <span className="dim">第 {logPage} 页</span>
              <button className="btn slim ghost" onClick={() => loadLogs(logPage + 1)}>下一页</button>
            </div>
          </Sec>
          <Sec icon="download" title="日志导出 / 导入" tip="隐私与安全仅处理「活动日志」；业务数据迁移请到「数据与存储」">
            <Row k="说明" tip="">
              <span className="dim">活动日志导出为 JSON 文件；导入仅合并追加（同 id 自动跳过），与其他业务数据互不干扰。</span>
            </Row>
          </Sec>
        </>
      )}

      {g === 'data' && (
        <>
          <Sec icon="database" title="数据存储模式" tip="如实显示当前部署与存储形态">
            <Row k="存储模式" tip="项目运行在服务器上，数据存于服务器端（SQLite + Markdown 真相源）；与第三方云同步无关">
              <span><span className="pill ok">服务器部署 · 云端存储</span>
                <code className="dim">SQLite {storageMode === 'server' ? '（服务器）' : ''} + Markdown 真相源</code></span>
            </Row>
            <Row k="同步状态" tip="无第三方云同步≠本地模式：外部登录、服务器部署、内部云存储、云同步、第三方云服务已独立定义">
              <span className="dim">当前为服务器端存储，未接入第三方云同步服务</span>
            </Row>
            <Row k="空间与配额" tip="服务器磁盘空间与配额管理入口">
              <span className="dim">配额信息由服务器运维统一管理（本机显示）</span>
            </Row>
          </Sec>
          <Sec icon="file" title="数据迁移（导入 / 导出）" tip="完整数据迁移能力：导出备份 → 导入恢复；格式校验 / 冲突跳过 / 事务回滚">
            <Row k="导出备份" tip="工作台各模块 JSON 汇总（计划 / 习惯 / 账本 / 目标 / 灵感 / 工作）">
              <button className="btn slim" onClick={exportData} disabled={exporting}>{exporting ? '导出中…' : '导出'}</button>
            </Row>
            <Row k="导入备份" tip="选择云笺集备份 JSON；冲突自动跳过（同内容不重复），任何异常整体回滚不破坏现有数据">
              <label className="btn slim file-btn" title="选择云笺集 backup JSON">
                {importing ? '导入中…' : '导入 JSON'}
                <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importData(f); e.target.value = '' }} />
              </label>
            </Row>
            <Row k="偏好缓存" tip="主题 / 默认页 / 密度等本地项（保留登录态与设备标识）">
              <button className="btn slim ghost" onClick={clearCache}>清理</button>
            </Row>
          </Sec>
        </>
      )}
    </>
  )
}
