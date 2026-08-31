/**
 * LEVEL UP 全屏特效：等级上涨时播放（光柱 + 徽章弹出 + 粒子），2.4s 自动消失。
 * 纯 DOM/CSS 实现，零依赖。
 */
import { useEffect, useMemo } from 'react'

const COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#8b5cf6', '#f4a261']

export function LevelUpOverlay({ level }: { level: number }) {
  // 一次性生成粒子参数（组件生命周期内固定）
  const particles = useMemo(
    () =>
      Array.from({ length: 42 }, (_, i) => ({
        id: i,
        x: 50 + (Math.random() - 0.5) * 70,
        delay: Math.random() * 0.35,
        dur: 1.1 + Math.random() * 1.1,
        size: 5 + Math.random() * 7,
        color: COLORS[i % COLORS.length],
        dx: (Math.random() - 0.5) * 260,
      })),
    [],
  )

  // 播放期间锁定页面滚动
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="lvup-overlay" role="presentation">
      <div className="lvup-beam" />
      <div className="lvup-core">
        <span className="lvup-title">LEVEL UP!</span>
        <span className="lvup-lv">LV {level}</span>
        <span className="lvup-sub">经验沉淀突破新等级 · 继续保持 ✨</span>
      </div>
      {particles.map((p) => (
        <i
          key={p.id}
          className="lvup-particle"
          style={{
            left: `${p.x}%`,
            top: '55%',
            width: p.size,
            height: p.size,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            ['--dx' as string]: `${p.dx}px`,
          }}
        />
      ))}
    </div>
  )
}
