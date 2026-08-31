/** 习惯打卡：今日打卡 / 连续天数 / 新增习惯 */
import { useCallback, useEffect, useState } from 'react'
import { api, type CheckinItem } from '../api'
import { Icon } from '../components/framework/Icon'
import { Modal, Field, confirmDialog } from '../components/framework/Modal'
import { useToast } from '../components/framework/Toast'
import { PageHeader } from '../components/framework/PageHeader'
import { EmptyState } from '../components/framework/EmptyState'

import { todayYMD } from '../lib/date'

function parseLog(log: string): Record<string, boolean> {
  try { return JSON.parse(log || '{}') as Record<string, boolean> } catch { return {} }
}

function computeStreak(log: string): number {
  const map = parseLog(log)
  let n = 0
  const d = new Date()
  while (true) {
    const k = todayYMD(d)
    if (map[k]) { n++; d.setDate(d.getDate() - 1) } else break
  }
  return n
}

export function CheckinPage({ withHeader = true }: { withHeader?: boolean }) {
  const [items, setItems] = useState<CheckinItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('✨')
  const toast = useToast()

  const load = useCallback(() => {
    setLoading(true)
    api.get<{ items: CheckinItem[] }>('/workbench/checkin')
      .then((r) => setItems(r.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])

  const todayDone = items.filter((i) => parseLog(i.log)[todayYMD()]).length

  const submit = async () => {
    if (!name.trim()) return
    try {
      await api.post('/workbench/checkin', { name: name.trim(), emoji })
      toast('已创建习惯')
      setName('')
      setCreating(false)
      load()
    } catch (e: any) {
      toast(e?.message || '创建失败', 'err')
    }
  }

  const toggle = async (item: CheckinItem) => {
    const log = { ...parseLog(item.log), [todayYMD()]: !parseLog(item.log)[todayYMD()] }
    try {
      await api.put(`/workbench/checkin/${item.id}`, { log: JSON.stringify(log), streak: computeStreak(JSON.stringify(log)) })
      load()
    } catch (e: any) {
      toast(e?.message || '操作失败', 'err')
    }
  }

  const remove = async (item: CheckinItem) => {
    if (!(await confirmDialog({ title: '删除习惯', description: `确定删除习惯「${item.name}」？其打卡记录将一并清空。`, type: 'danger', confirmText: '删除' }))) return
    try {
      await api.del(`/workbench/checkin/${item.id}`)
      toast('已删除')
      load()
    } catch (e: any) {
      toast(e?.message || '删除失败', 'err')
    }
  }

  return (
    <>
      <PageHeader
        title={withHeader ? '习惯打卡' : undefined}
        subtitle={withHeader ? `今日已完成 ${todayDone} / ${items.length}` : undefined}
        actions={<button className={withHeader ? 'btn' : 'btn slim'} onClick={() => { setName(''); setEmoji('✨'); setCreating(true) }}>
          <Icon name="plus" size={15} /> 新增习惯
        </button>}
      />

      {loading ? (
        <EmptyState>载入中…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState style={{ padding: '36px 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>创建习惯，开始每天打卡</div>
          <div style={{ marginBottom: 16, color: 'var(--text-tertiary)' }}>创建习惯 → 每天勾选打卡 → 培养连续记录</div>
          <button className="btn slim" onClick={() => { setName(''); setEmoji('✨'); setCreating(true) }}>
            <Icon name="plus" size={14} /> 创建第一个习惯
          </button>
        </EmptyState>
      ) : (
        <>
          {/* 近 35 天热图（按习惯聚合） */}
          {items.length > 0 && (
            <div className="ck-heat card">
              <div className="sh" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>
                <Icon name="flame" size={15} /> 近 35 天打卡热图
                <span className="dim" style={{ marginLeft: 'auto', fontWeight: 500 }}>绿块 = 有打卡记录</span>
              </div>
              <div className="heat-grid">
                {[...Array(35)].map((_, i) => {
                  const d = new Date()
                  d.setDate(d.getDate() - (34 - i))
                  const key = d.toISOString().slice(0, 10)
                  const count = items.filter((it) => parseLog(it.log)[key]).length
                  const level = count === 0 ? 0 : count >= 3 ? 3 : count >= 2 ? 2 : 1
                  return (
                    <div key={key} className={`heat-cell lv${level}`} title={`${key} · ${count} 个习惯打卡`} />
                  )
                })}
              </div>
            </div>
          )}
          <div className="ck-grid">
            {items.map((item) => {
              const done = !!parseLog(item.log)[todayYMD()]
              const streak = computeStreak(item.log)
            return (
              <div key={item.id} className={`ck-card ${done ? 'done' : ''}`} onClick={() => toggle(item)}>
                <div className="ck-ic">{item.emoji}</div>
                <div className="ck-tx">
                  <div className="ckn">{item.name}</div>
                  <div className="cks">
                    <span>连续 <b>{streak}</b> 天</span>
                    {streak >= 3 && <span className="fire">🔥</span>}
                  </div>
                </div>
                <div className="ck-st">
                  <Icon name={done ? 'check' : 'x'} size={18} />
                </div>
                <button
                  className="ck-del"
                  title="删除习惯"
                  onClick={(e) => { e.stopPropagation(); remove(item) }}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            )
          })}
          </div>
        </>
      )}

      {creating && (
        <Modal
          title="新增习惯"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setCreating(false)}>取消</button>
              <button className="btn" onClick={submit}>保存</button>
            </>
          }
        >
          <Field label="名称">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：晨跑 30 分钟" maxLength={50} autoFocus />
          </Field>
          <Field label="图标（emoji）">
            <input type="text" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} placeholder="✨" />
          </Field>
        </Modal>
      )}
    </>
  )
}