/**
 * 设置中心 · 关于 + 快捷键分组（从 SettingsPage 拆出）：
 * - 关于：版本 v1.0、更新记录、帮助与反馈（邮件）
 * - 快捷键：全局快捷键一览
 */
import { useState } from 'react'
import { useAuth } from '../../auth'
import { useToast } from '../../components/framework/Toast'
import { api } from '../../api'
import { Sec, Row } from './shared'

const SHORTCUTS: { keys: string; name: string }[] = [
  { keys: 'Ctrl/⌘ + N', name: '速记弹窗' },
  { keys: 'Ctrl/⌘ + ⇧ + N', name: '捕捉灵感' },
  { keys: 'Ctrl/⌘ + B', name: '侧边栏折叠 / 展开' },
  { keys: 'Ctrl/⌘ + S', name: '保存文章' },
  { keys: 'Esc', name: '关闭浮层' },
]

/* 更新记录（需求 25：版本 / 发布 / 新增 / 优化 / 修复 / 重大变更，含问题持续修复分析机制的说明） */
const Changelog = () => (
  <div className="changelog">
    <div className="cl-item current">
      <b>v1.0</b><em>2026-09-04</em>
      <ul>
        <li>✨ 新增：RSS 生成与订阅、活动日志系统、Webhook 与 API 凭据、头像上传与装饰、两步验证邮箱恢复、站点自定义中心、可扩展主题系统</li>
        <li>🔧 优化：编辑页布局（白色画布铺满 + 文档信息置顶）、侧边栏默认折叠与动画、设置页左右两栏与 Tooltip、登录设备信息改为客户端真实数据</li>
        <li>🐛 修复：编辑页选中文字导致崩溃的风险路径（抑制解析回灌反馈环 + 全局错误兜底）、存储模式错误显示、双模输入样式统一</li>
        <li>📌 重大变更：版本从 v0.x 升入 v1.0，密码规则调整为「必须包含中文与英文」</li>
      </ul>
    </div>
    <div className="cl-note">版本递增：小版本=每次更新递增；中版本=累计约定数量递增；大版本=功能/架构/能力重大升级递增。</div>
    <div className="cl-note">问题持续修复分析：同一问题多次未根治时，将记录首次发现时间、每次修复内容与为何未根治，判断是否为根因定位错误或关联模块影响，直至最终方案落地。</div>
  </div>
)

/* 反馈表单（需求 26：填写 → 邮件发送，展示状态与结果） */
const FeedbackForm = ({ defaultEmail }: { defaultEmail: string }) => {
  const toast = useToast()
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'idle' | 'sent' | 'fail'>('idle')
  const to = localStorage.getItem('cl_feedback_email') || defaultEmail
  const send = async () => {
    if (!subject.trim() || !content.trim()) { toast('请填写主题与反馈内容', 'err'); return }
    setBusy(true); setResult('idle')
    try {
      await api.post<{ ok: boolean }>('/feedback', { subject: subject.trim(), content: content.trim(), to })
      setResult('sent')
      setSubject(''); setContent('')
      toast('反馈已发送')
    } catch (e: any) {
      setResult('fail')
      toast(e?.message || '发送失败', 'err')
    } finally { setBusy(false) }
  }
  return (
    <div className="feedback">
      <label>主题<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="反馈主题" maxLength={80} /></label>
      <label>内容<textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="请描述你遇到的问题或建议…" /></label>
      <div className="fb-foot">
        <span className="dim">收件：{to}</span>
        <button className="btn slim" onClick={send} disabled={busy}>{busy ? '发送中…' : '发送反馈'}</button>
        {result === 'sent' && <span className="pill ok">已发送 ✓</span>}
        {result === 'fail' && <span className="pill bad">发送失败</span>}
      </div>
    </div>
  )
}

export const AboutGroup = ({ g }: { g: 'about' | 'shortcuts' }) => {
  const { user } = useAuth()

  return (
    <>
      {g === 'about' && (
        <>
          <Sec icon="help" title="云笺集" tip="以时间线为首页的个人创作工作台">
            <Row k="版本" tip="版本递增：小版本每次更新 +1，中版本累计小版本数后递增，大版本随重大能力升级递增">
              <span className="v-number">v1.0</span>
            </Row>
          </Sec>
          <Sec icon="book" title="更新记录" tip="每个版本的版本号 / 发布时间 / 新增 / 优化 / 修复 / 重大变更">
            <Changelog />
          </Sec>
          <Sec icon="help" title="帮助" tip="按功能模块整理的完整使用文档与常见问题">
            <div className="help-list">
              {[
                ['开始使用', '登录后进入时间线首页；左侧「⚡ 速记」或 Ctrl/⌘+N 快速记录。'],
                ['写文章', '「文章」→ 新建草稿；斜杠菜单 / 选中浮动工具栏排版；[[ 插入双链；保存自动进行。'],
                ['目标与日常', '「目标」拆解长期目标并关联计划/习惯；「日常」查看今日待办与打卡。'],
                ['记账与检索', '「记账本」记录收支；「检索」全文搜索文章与笔记。'],
                ['常见问题', '忘记密码：登录页「找回密码」发邮件重置；丢失两步验证：设置 → 账户 → 无法验证走邮箱恢复。'],
              ].map(([t, d]) => (
                <div key={t} className="help-item"><b>{t}</b><span>{d}</span></div>
              ))}
            </div>
          </Sec>
          <Sec icon="mail" title="反馈" tip="填写反馈内容后通过邮件发送（SMTP），收件邮箱为账户中配置的默认反馈接收邮箱">
            <FeedbackForm defaultEmail={user?.email ?? ''} />
          </Sec>
        </>
      )}

      {g === 'shortcuts' && (
        <Sec icon="bolt" title="全局快捷键" tip="自定义按键路径将在「快捷键」能力升级后支持">
          {SHORTCUTS.map((s) => (
            <Row key={s.name} k={s.name}><code>{s.keys}</code></Row>
          ))}
        </Sec>
      )}
    </>
  )
}
