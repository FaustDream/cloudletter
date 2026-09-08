/**
 * 设置中心 · 站点设置 + 通知分组（从 SettingsPage 拆出）：
 * - 站点自定义中心（需求 17：傻瓜式 + CSS 高级），站点配置挂载即拉取
 * - 通知中心（需求 18：浏览器 / 系统 / 邮件 / 站内 / 重要事件 + 权限三段式反馈）
 */
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth'
import { useToast } from '../../components/framework/Toast'
import { api } from '../../api'
import { THEME_REGISTRY } from '../../lib/theme'
import { Sec, Row } from './shared'

export const SiteGroup = ({ g }: { g: 'site' | 'notify' }) => {
  const { user } = useAuth()
  const toast = useToast()

  // 通知（需求 18）
  const [notifyState, setNotifyState] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
  const [notifyCfg, setNotifyCfg] = useState<Record<string, boolean>>(() => ({
    browser: true, system: true, mail: false, inapp: true, important: true,
  }))
  const [fbEmail, setFbEmail] = useState('') // 默认反馈接收邮箱（需求 26）

  // 站点设置（需求 17）
  const [siteCfg, setSiteCfg] = useState<Record<string, any>>({})
  const [siteLoading, setSiteLoading] = useState(true)
  const siteDraft = useRef<Record<string, any>>({})

  const loadSite = () => {
    api.get<any>('/settings')
      .then((r) => { setSiteCfg(r); siteDraft.current = JSON.parse(JSON.stringify(r)) })
      .catch(() => {})
      .finally(() => setSiteLoading(false))
  }

  // 挂载即加载（原 loadAll 按需拆分）
  useEffect(() => { loadSite() }, [])

  if (!user) return null

  /* ========== 通知（需求 18） ========== */
  const enableNotify = async () => {
    if (typeof Notification === 'undefined') { toast('当前浏览器不支持通知', 'err'); return }
    const p = await Notification.requestPermission()
    setNotifyState(p)
    if (p === 'granted') {
      new Notification('云笺集', { body: '通知已开启 ✓' })
      toast('通知权限已授权，浏览器通知可正常送达')
    } else if (p === 'denied') {
      toast('通知权限被拒绝：请在浏览器站点设置中重新开启（地址栏左侧图标 → 网站设置 → 通知 → 允许）', 'err')
    } else {
      toast('通知权限未授予')
    }
  }
  const saveNotifyCfg = (k: string, v: boolean) => {
    setNotifyCfg((prev) => { const next = { ...prev, [k]: v }; localStorage.setItem('cl_notify', JSON.stringify(next)); return next })
    toast('通知设置已保存')
  }

  /* ========== 站点自定义中心（需求 17） ========== */
  const patchSite = (path: string, value: any) => {
    siteDraft.current = { ...siteDraft.current }
    const parts = path.split('.')
    let o: any = siteDraft.current
    while (parts.length > 1) { const k = parts.shift()!; o[k] = o[k] ?? {}; o = o[k] }
    o[parts[0]] = value
  }
  const saveSite = async () => {
    try {
      await api.put('/settings', siteDraft.current)
      toast('站点设置已保存')
    } catch (e: any) { toast(e?.message || '保存失败', 'err') }
  }
  const siteVal = (path: string, fallback = '') => {
    const parts = path.split('.')
    let o: any = siteDraft.current
    for (const p of parts) { if (o?.[p] === undefined) return fallback; o = o[p] }
    return o ?? fallback
  }
  const siteGroup = () => (siteDraft.current.site && typeof siteDraft.current.site === 'object' ? siteDraft.current.site : {})
  const patchSiteGroup = (k: string, v: any) => {
    siteDraft.current = { ...siteDraft.current, site: { ...siteGroup(), [k]: v } }
  }

  return (
    <>
      {g === 'site' && (
        <>
          <Sec icon="server" title="站点自定义中心" tip="云笺集统一站点视觉与内容定制；傻瓜式配置 + CSS 高级配置共存（各有优先级与隔离）">
            <div className="site-grid">
              <label>网站名称<input value={siteVal('site.name')} onChange={(e) => patchSiteGroup('name', e.target.value)} placeholder="云笺集" /></label>
              <label>网站描述<input value={siteVal('site.description')} onChange={(e) => patchSiteGroup('description', e.target.value)} placeholder="个人创作工作台" /></label>
              <label>Logo URL<input value={siteVal('site.logo')} onChange={(e) => patchSiteGroup('logo', e.target.value)} placeholder="/logo.png 或 https://" /></label>
              <label>favicon URL<input value={siteVal('site.favicon')} onChange={(e) => patchSiteGroup('favicon', e.target.value)} placeholder="/favicon.ico" /></label>
              <label>正文字体<input value={siteVal('site.fontFamily')} onChange={(e) => patchSiteGroup('fontFamily', e.target.value)} placeholder="system-ui / serif" /></label>
              <label>主色<input type="color" value={/^#[0-9a-fA-F]{6}$/.test(siteVal('site.accent')) ? siteVal('site.accent') : THEME_REGISTRY[0].swatch[0]} onChange={(e) => patchSiteGroup('accent', e.target.value)} /></label>
            </div>
            <Row k="页面视觉" tip="卡片 / 按钮 / 间距 / 圆角 / 阴影（以 CSS 变量形式作用于全站）">
              <div className="site-grid">
                <label>圆角（px）<input value={siteVal('site.radius', '16')} onChange={(e) => patchSiteGroup('radius', e.target.value)} placeholder="16" /></label>
                <label>阴影强度<input value={siteVal('site.shadow', '0.5')} onChange={(e) => patchSiteGroup('shadow', e.target.value)} placeholder="0~1" /></label>
                <label>卡片透明度<input value={siteVal('site.cardAlpha', '1')} onChange={(e) => patchSiteGroup('cardAlpha', e.target.value)} placeholder="0~1" /></label>
                <label>背景动画<select value={siteVal('site.bgAnimation', 'off')} onChange={(e) => patchSiteGroup('bgAnimation', e.target.value)}>
                  <option value="off">关闭</option><option value="aurora">极光流动</option><option value="particles">粒子</option>
                </select></label>
              </div>
            </Row>
            <Row k="CSS 高级配置" tip="直接编写自定义 CSS（安全隔离：仅作用于当前站点的样式作用域，禁用脚本；!important 允许覆盖）">
              <textarea className="site-css" rows={8} value={siteVal('site.customCss')} onChange={(e) => patchSiteGroup('customCss', e.target.value)}
                placeholder={`/* 例：让卡片更圆 */\n.set-sec { border-radius: 20px; }`} />
            </Row>
            <div className="set-row">
              <div className="set-row-v" style={{ justifyContent: 'flex-start' }}>
                <button className="btn slim" onClick={saveSite} disabled={siteLoading}>{siteLoading ? '载入中…' : '保存站点设置'}</button>
              </div>
            </div>
          </Sec>
        </>
      )}

      {g === 'notify' && (
        <>
          <Sec icon="bell" title="通知中心" tip="全站统一通知管理：浏览器 / 系统 / 邮件 / 站内 / 重要事件">
            <Row k="浏览器通知权限" tip={notifyState === 'granted' ? '已授权，通知可正常送达' : notifyState === 'denied' ? '已被浏览器禁止：点击地址栏左侧站点图标 → 网站设置 → 通知 → 允许' : '尚未授权，点击开启'}>
              {notifyState === 'granted'
                ? <><span className="pill ok">已授权</span><button className="btn slim ghost" onClick={() => new Notification('云笺集', { body: '测试通知 ✓' })}>发送测试通知</button></>
                : notifyState === 'denied'
                  ? <><span className="pill bad">已被浏览器禁止</span><span className="dim">打开浏览器站点设置重新开启</span><button className="btn slim ghost" onClick={async () => { const p = await Notification.requestPermission(); setNotifyState(p) }}>重新尝试授权</button></>
                  : <button className="btn slim" onClick={enableNotify}>开启浏览器通知</button>}
            </Row>
            <Row k="通知场景">
              <div className="nt-grid">
                {[
                  ['browser', '浏览器通知', '任务完成、讨伐掉落等桌面推送'],
                  ['system', '系统通知', '操作系统级提醒（需先授权浏览器）'],
                  ['mail', '邮件通知', '重要事件邮件（需配置 SMTP）'],
                  ['inapp', '站内通知', '应用内消息气泡'],
                  ['important', '重要事件', '安全事件、版本升级等'],
                ].map(([k, label, tip]) => (
                  <label key={k} className="nt-item" title={tip}>
                    <input type="checkbox" checked={notifyCfg[k]} onChange={(e) => saveNotifyCfg(k, e.target.checked)} />
                    <b>{label}</b><em>{tip}</em>
                  </label>
                ))}
              </div>
            </Row>
            <Row k="默认反馈接收邮箱" tip="「关于 → 反馈」通过邮件发送时使用的收件邮箱；默认取当前登录邮箱">
              <input type="email" value={fbEmail || user.email} onChange={(e) => setFbEmail(e.target.value)} placeholder="feedback@example.com" style={{ width: 240 }} />
              <button className="btn slim ghost" onClick={() => { localStorage.setItem('cl_feedback_email', fbEmail || user.email); toast('默认反馈接收邮箱已保存') }}>保存</button>
            </Row>
          </Sec>
        </>
      )}
    </>
  )
}
