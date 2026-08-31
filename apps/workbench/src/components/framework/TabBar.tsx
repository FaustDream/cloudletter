/**
 * 通用选项卡栏（TabBar）：多个页面复用的「胶囊 Tab」骨架。
 * tabs 传 { key, label, icon? }，由 key 判活跃，onChange 回调切换。
 */
import { Icon } from './Icon'

export function TabBar<T extends string>({ tabs, active, onChange, className }: {
  tabs: Array<{ key: T; label: string; icon?: string }>
  active: T
  onChange: (k: T) => void
  className?: string
}) {
  return (
    <div className={className ? `tabbar ${className}` : 'tabbar'} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          className={active === t.key ? 'on' : ''}
          onClick={() => onChange(t.key)}
        >
          {t.icon && <Icon name={t.icon} size={13} />}
          {t.label}
        </button>
      ))}
    </div>
  )
}