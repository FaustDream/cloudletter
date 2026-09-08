/**
 * 游戏化庆祝反馈：彩带粒子 + 鼓励语。
 * - celebrate(x, y, opts)：在指定屏幕坐标喷发一次彩带（纯 DOM/CSS，自动清理）
 * - praise()：随机鼓励语，供 toast / 完成提示使用
 */

const PARTICLE_COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#38bdf8', '#f4a261', '#ffffff']

export function praise(): string {
  const phrases = [
    '干得漂亮，又前进了一步！',
    '稳！这就是积累的力量。',
    '漂亮一击，节奏在线！',
    '今天的你也很可靠 ✨',
    '又清掉一件，离目标更近了。',
    '连续输出，状态火热 🔥',
    '小步不停，终成大事。',
    '完成的瞬间最闪亮！',
  ]
  return phrases[Math.floor(Math.random() * phrases.length)]
}

interface Particle {
  el: HTMLSpanElement
  born: number
  dur: number
}

const live = new Set<Particle>()

/** 在视口坐标 (x, y) 喷发一次彩带；n 为粒子数量 */
export function celebrate(x: number, y: number, n = 26): void {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span')
    el.className = 'celebrate-particle'
    const ang = Math.random() * Math.PI * 2
    const dist = 60 + Math.random() * 130
    const size = 5 + Math.random() * 6
    el.style.left = `${x}px`
    el.style.top = `${y}px`
    el.style.width = `${size}px`
    el.style.height = `${size}px`
    el.style.background = PARTICLE_COLORS[i % PARTICLE_COLORS.length]
    el.style.setProperty('--dx', `${Math.cos(ang) * dist}px`)
    el.style.setProperty('--dy', `${Math.sin(ang) * dist - 40}px`)
    document.body.appendChild(el)
    const p: Particle = { el, born: performance.now(), dur: 900 + Math.random() * 500 }
    live.add(p)
  }
  // 统一清扫（惰性）
  if (live.size > 0 && !celebrateSweeping) {
    celebrateSweeping = true
    requestAnimationFrame(sweep)
  }
}

let celebrateSweeping = false
function sweep(now: number): void {
  live.forEach((p) => {
    if (now - p.born > p.dur + 100) {
      p.el.remove()
      live.delete(p)
    }
  })
  if (live.size > 0) requestAnimationFrame(sweep)
  else celebrateSweeping = false
}
