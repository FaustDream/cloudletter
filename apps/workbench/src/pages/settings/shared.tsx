/**
 * 设置中心 · 分组共享物料（从 SettingsPage 拆出）：
 * - GroupId / GROUPS：左侧分组导航定义（由 SettingsPage 壳渲染）
 * - Sec / Row：分组内容通用小节与 Tooltip 化行
 * - fmtTime：登录设备 / 活动日志 / Webhook 调用记录等通用时间格式化
 */
import type { ReactNode } from 'react'
import { Icon } from '../../components/framework/Icon'

export type GroupId = 'account' | 'prefs' | 'game' | 'site' | 'notify' | 'privacy' | 'shortcuts' | 'data' | 'integrations' | 'about'

export const GROUPS: { id: GroupId; label: string; icon: string; desc: string }[] = [
  { id: 'account', label: '账户', icon: 'user', desc: '头像、资料、邮箱、密码与两步验证、登录设备' },
  { id: 'prefs', label: '偏好', icon: 'setting', desc: '主题系统、密度、默认入口、布局风格' },
  { id: 'game', label: '游戏', icon: 'flame', desc: '讨伐、经验升级（实验性功能，默认关闭）' },
  { id: 'site', label: '站点设置', icon: 'server', desc: '站名 Logo favicon 字体 主色 背景 布局 动画 自定义 CSS' },
  { id: 'notify', label: '通知', icon: 'bell', desc: '浏览器 / 系统 / 邮件 / 站内通知开关与权限' },
  { id: 'privacy', label: '隐私与安全', icon: 'shield', desc: '可见性、活动日志、日志导出与导入' },
  { id: 'shortcuts', label: '快捷键', icon: 'bolt', desc: '全局快捷键一览' },
  { id: 'data', label: '数据与存储', icon: 'database', desc: '存储模式、空间与配额、数据导入导出' },
  { id: 'integrations', label: '集成与链接', icon: 'link', desc: 'SMTP、API 凭据、Webhook、RSS 订阅' },
  { id: 'about', label: '关于', icon: 'help', desc: '版本、更新记录、帮助与反馈' },
]

/** Tooltip 化行：标签悬浮显示说明（需求 13） */
export const Row = ({ k, tip, children }: { k: string; tip?: string; children: ReactNode }) => (
  <div className="set-row">
    <div className="set-row-k" data-tip={tip}>
      <b>{k}</b>
    </div>
    <div className="set-row-v">{children}</div>
  </div>
)

export const Sec = ({ icon, title, tip, children }: { icon: string; title: string; tip?: string; children: ReactNode }) => (
  <section className="set-sec">
    <div className="set-sec-h"><Icon name={icon} size={15} /><span data-tip={tip}>{title}</span></div>
    <div className="set-sec-body">{children}</div>
  </section>
)

/** 统一时间展示：登录设备 / 活动日志 / Webhook 调用记录等 */
export const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '—')
