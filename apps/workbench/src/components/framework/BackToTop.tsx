/**
 * 全局「回到顶部」：所有工作台页面可用。
 * - 自动识别页面高度：内容不足一屏（无可滚动）时不显示
 * - 滚动条下滑超过阈值即出现，回到顶部即隐藏，避免无用按钮常驻
 * - portal 到 body，避开 .screen 动画 transform 的包含块
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Icon } from './Icon'

const SHOW_AFTER = 320 // 滚动超过该距离才出现
const SCROLLABLE_GAP = 60 // 内容高度比视口高出该值才算可滚动

export function BackToTop() {
  const loc = useLocation()
  const [show, setShow] = useState(false)

  useEffect(() => {
    const evaluate = () => {
      const doc = document.documentElement
      const scrollable = doc.scrollHeight - window.innerHeight > SCROLLABLE_GAP
      setShow(scrollable && window.scrollY > SHOW_AFTER)
    }
    evaluate()
    window.addEventListener('scroll', evaluate, { passive: true })
    window.addEventListener('resize', evaluate)
    // 路由切换后页面高度变化，延迟再评估一次（布局/懒加载内容渲染后）
    const t = window.setTimeout(evaluate, 180)
    return () => {
      window.removeEventListener('scroll', evaluate)
      window.removeEventListener('resize', evaluate)
      window.clearTimeout(t)
    }
  }, [loc.pathname])

  return createPortal(
    <button
      type="button"
      className={`to-top${show ? ' show' : ''}`}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="回到顶部"
      title="回到顶部"
    >
      <Icon name="chevUp" size={22} />
    </button>,
    document.body,
  )
}
