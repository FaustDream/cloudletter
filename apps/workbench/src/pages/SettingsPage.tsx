/**
 * 设置中心（需求 13/16 重构版）· 壳 + 分组组件：
 * - 左右两栏：左侧分类菜单（仅名称 + 悬浮 Tooltip 说明），右侧当前设置内容
 * - 壳只负责：登录守卫、g 分组路由（useSearchParams）、左侧分组导航与各分组挂载
 * - 各分组实现见 ./settings/：AccountGroup / PrefsGroup / SiteGroup / PrivacyGroup / IntegrationsGroup / AboutGroup
 * - 账户：头像上传/装饰、资料、邮箱、密码（中英文规则）、两步验证（含邮箱安全恢复）、登录设备、退出登录（极简）
 * - 偏好：可扩展主题系统（内置套色 + 自定义主题 + 界面密度 + 全局偏好）
 * - 通知：统一通知中心（浏览器/系统/邮件/站内/重要事件 + 权限三段式反馈）
 * - 隐私与安全：可见性默认值、活动日志（完整列表 + 日志导出/导入）
 * - 数据与存储：存储模式如实显示、数据导入/导出（完整迁移）、缓存
 * - 站点设置：站点自定义中心（傻瓜式 + CSS 高级）
 * - 集成与链接：SMTP 状态、API 凭据（创建/撤销）、Webhook（事件/签名/调用日志/重试）、RSS 订阅
 * - 关于：版本 v1.0、更新记录、帮助与反馈（邮件）
 */
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { Icon } from '../components/framework/Icon'
import { PageHeader } from '../components/framework/PageHeader'
import { GROUPS, type GroupId } from './settings/shared'
import { AccountGroup } from './settings/AccountGroup'
import { PrefsGroup } from './settings/PrefsGroup'
import { SiteGroup } from './settings/SiteGroup'
import { PrivacyGroup } from './settings/PrivacyGroup'
import { IntegrationsGroup } from './settings/IntegrationsGroup'
import { AboutGroup } from './settings/AboutGroup'

export function SettingsPage() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const g = (sp.get('g') as GroupId) || 'account'
  const setG = (id: GroupId) => setSp({ g: id }, { replace: true })

  useEffect(() => { document.title = '设置 · 云笺集' }, [])

  if (!user) {
    nav('/login', { replace: true })
    return null
  }

  return (
    <div className="set-page">
      <PageHeader title="设置" subtitle="全部设置真实生效" actions={<span className="acct-email-chip"><span className="dot" /> {user.email}</span>} />

      <div className="set-layout">
        <nav className="set-nav" aria-label="设置分组">
          {GROUPS.map((grp) => (
            <button key={grp.id} className={`set-nav-item${grp.id === g ? ' on' : ''}`} onClick={() => setG(grp.id)} title={grp.desc} data-tip={grp.desc}>
              <Icon name={grp.icon} size={16} /> <span>{grp.label}</span>
            </button>
          ))}
        </nav>

        <div className="set-content">
          {g === 'account' && <AccountGroup />}
          {(g === 'prefs' || g === 'game') && <PrefsGroup g={g} />}
          {(g === 'site' || g === 'notify') && <SiteGroup g={g} />}
          {(g === 'privacy' || g === 'data') && <PrivacyGroup g={g} />}
          {g === 'integrations' && <IntegrationsGroup />}
          {(g === 'about' || g === 'shortcuts') && <AboutGroup g={g} />}
        </div>
      </div>
    </div>
  )
}
