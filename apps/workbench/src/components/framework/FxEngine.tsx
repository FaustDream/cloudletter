/**
 * 框架层 · 动效引擎（FxEngine）
 * 分层控制：L1 背景光带(Canvas) / L2 网格扫描(CSS) / L3 粒子网络(Canvas) / L4 鼠标光晕(DOM)
 * 性能：单 rAF 循环、DPR 限制 [1,1.5]、标签页隐藏暂停、prefers-reduced-motion 时退场。
 */
import { useEffect, useRef } from 'react'

interface FxState {
  reduced: boolean
  run: boolean
  raf: number
  last: number
  W: number
  H: number
  mouse: { x: number; y: number; on: boolean }
}

export function FxEngine() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const state: FxState = { reduced, run: false, raf: 0, last: 0, W: 0, H: 0, mouse: { x: -999, y: -999, on: false } }

    /* ---- L1 背景光带 ----- */
    const c1 = document.createElement('canvas')
    c1.className = 'fx-bg'
    root.appendChild(c1)
    const ctx1 = c1.getContext('2d')!

    /* ---- L2 网格扫描线（CSS 动效，effect 内创建以规避 StrictMode 首屏丢失） ---- */
    const scan = document.createElement('div')
    scan.className = 'scan-line'
    root.appendChild(scan)

    /* ---- L3 粒子网络 ---- */
    const c2 = document.createElement('canvas')
    c2.className = 'fx-particles'
    root.appendChild(c2)
    const ctx2 = c2.getContext('2d')!

    /* ---- canvas 尺寸 ---- */
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const size2d = (cv: HTMLCanvasElement) => {
      state.W = window.innerWidth
      state.H = window.innerHeight
      cv.width = state.W * dpr
      cv.height = state.H * dpr
      cv.style.width = state.W + 'px'
      cv.style.height = state.H + 'px'
    }
    size2d(c1); size2d(c2)

    /* ---- L1 数据：光带 + 数据流 ---- */
    const bands = [
      { x: .15, y: .3, r: 520, c: '120,200,255', a: .05, s: .0008, w: 0 },
      { x: .8, y: .65, r: 460, c: '160,140,255', a: .045, s: -.0006, w: 1.2 },
      { x: .55, y: .15, r: 360, c: '110,255,215', a: .04, s: .0005, w: 2.1 },
    ].map((b) => ({ ...b, r: Math.max(state.W, state.H) * (b.r / 560) }))
    const flows = Array.from({ length: 14 }, (_, i) => ({
      x: Math.random() * state.W, y: Math.random() * state.H,
      vy: .18 + Math.random() * .6, len: 30 + Math.random() * 70,
      c: Math.random() < .5 ? '140,200,255' : '170,150,255',
      a: .12 + Math.random() * .22, ph: Math.random() * Math.PI * 2,
    }))

    /* ---- L3 粒子 ---- */
    const PALETTE = ['255,255,255', '185,225,255', '150,210,255', '165,190,255', '200,180,255', '140,255,230']
    const n = Math.min(64, Math.floor((state.W * state.H) / 26000) + 26)
    const pts = Array.from({ length: n }, (_, i) => {
      const big = Math.random() < .14
      return {
        x: Math.random() * state.W, y: Math.random() * state.H,
        vx: (Math.random() - .5) * .22, vy: (Math.random() - .5) * .22,
        r: big ? 2.2 + Math.random() * 1.6 : .7 + Math.random() * 1.3,
        baseA: big ? .5 + Math.random() * .3 : .28 + Math.random() * .35,
        ph: Math.random() * Math.PI * 2, pw: .005 + Math.random() * .02,
        c: PALETTE[i % PALETTE.length], glow: big,
      }
    })
    const LINE_DIST = 130, MOUSE_R = 170

    /* ---- L4 鼠标光晕 ---- */
    const glow = document.createElement('div')
    glow.className = 'cursor-glow'
    root.appendChild(glow)

    /* ---- 主循环 ---- */
    const tick = (t: number) => {
      if (!state.run) return
      const now = t
      const dt = Math.min((now - state.last) / 1000 || .016, .05)
      state.last = now
      const tb = now / 1000
      const mx = state.mouse.x, my = state.mouse.y, mOn = state.mouse.on

      // L1 背景光带
      ctx1.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx1.clearRect(0, 0, state.W, state.H)
      for (const b of bands) {
        const bx = state.W * b.x + Math.sin(tb * b.s * 200 + b.w) * 40
        const by = state.H * b.y + Math.cos(tb * b.s * 200 + b.w) * 30
        const aa = b.a * (0.75 + 0.25 * Math.sin(tb * .5 + b.w))
        const g = ctx1.createRadialGradient(bx, by, 0, bx, by, b.r)
        g.addColorStop(0, `rgba(${b.c},${aa})`)
        g.addColorStop(1, `rgba(${b.c},0)`)
        ctx1.fillStyle = g
        ctx1.fillRect(0, 0, state.W, state.H)
      }
      ctx1.lineWidth = 1
      for (const f of flows) {
        f.y += f.vy; f.ph += .012
        if (f.y > state.H) { f.y = -f.len; f.x = Math.random() * state.W }
        const aa = f.a * (0.6 + 0.4 * Math.sin(f.ph * 2))
        ctx1.strokeStyle = `rgba(${f.c},${aa})`
        ctx1.beginPath(); ctx1.moveTo(f.x, f.y); ctx1.lineTo(f.x, f.y + f.len); ctx1.stroke()
        ctx1.fillStyle = `rgba(${f.c},${aa * 1.4})`
        ctx1.beginPath(); ctx1.arc(f.x, f.y, 1.4, 0, Math.PI * 2); ctx1.fill()
      }

      // L3 粒子网络
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx2.clearRect(0, 0, state.W, state.H)
      ctx2.lineWidth = 1
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        for (let j = i + 1; j < pts.length; j++) {
          const q = pts[j]
          const dx = p.x - q.x, dy = p.y - q.y
          const d2 = dx * dx + dy * dy
          if (d2 < LINE_DIST * LINE_DIST) {
            const d = Math.sqrt(d2)
            const aa = (1 - d / LINE_DIST) * .16
            ctx2.strokeStyle = `rgba(150,200,255,${aa.toFixed(3)})`
            ctx2.beginPath(); ctx2.moveTo(p.x, p.y); ctx2.lineTo(q.x, q.y); ctx2.stroke()
          }
        }
      }
      for (const p of pts) {
        if (mOn) {
          const dx = mx - p.x, dy = my - p.y
          const d2 = dx * dx + dy * dy
          if (d2 < MOUSE_R * MOUSE_R && d2 > 1) {
            const d = Math.sqrt(d2)
            const f = (1 - d / MOUSE_R)
            p.vx += dx / d * f * .10
            p.vy += dy / d * f * .10
            p.vx += Math.cos(tb * 2 + p.ph) * f * .02
            p.vy += Math.sin(tb * 2 + p.ph) * f * .02
          }
        }
        const sp = Math.hypot(p.vx, p.vy)
        if (sp > .9) { p.vx = p.vx / sp * .9; p.vy = p.vy / sp * .9 }
        p.x += p.vx; p.y += p.vy; p.ph += p.pw
        if (p.x < -20) p.x = state.W + 20; if (p.x > state.W + 20) p.x = -20
        if (p.y < -20) p.y = state.H + 20; if (p.y > state.H + 20) p.y = -20
        const a = p.baseA * (0.62 + 0.38 * Math.sin(p.ph * 1.6 + p.ph * .22))
        if (p.glow) {
          const g = ctx2.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4.5)
          g.addColorStop(0, `rgba(${p.c},${(a * .22).toFixed(3)})`)
          g.addColorStop(1, `rgba(${p.c},0)`)
          ctx2.fillStyle = g
          ctx2.beginPath(); ctx2.arc(p.x, p.y, p.r * 4.5, 0, Math.PI * 2); ctx2.fill()
        }
        ctx2.fillStyle = `rgba(${p.c},${a.toFixed(3)})`
        ctx2.beginPath(); ctx2.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx2.fill()
      }
      if (mOn) {
        const pa = 0.35 + 0.2 * Math.sin(tb * 3)
        ctx2.strokeStyle = `rgba(150,210,255,${(pa * .5).toFixed(3)})`
        ctx2.beginPath(); ctx2.arc(mx, my, 26 + Math.sin(tb * 2.4) * 4, 0, Math.PI * 2); ctx2.stroke()
        ctx2.fillStyle = `rgba(190,225,255,${pa.toFixed(3)})`
        ctx2.beginPath(); ctx2.arc(mx, my, 1.6, 0, Math.PI * 2); ctx2.fill()
      }

      // L4 鼠标光晕跟随
      glow.style.transform = `translate3d(${mx}px,${my}px,0)`
      state.raf = requestAnimationFrame(tick)
    }

    const onResize = () => { size2d(c1); size2d(c2); }
    const onMove = (e: MouseEvent) => {
      state.mouse.x = e.clientX; state.mouse.y = e.clientY; state.mouse.on = true
      glow.classList.add('show')
    }
    const onLeave = () => { state.mouse.on = false; glow.classList.remove('show') }
    const onVis = () => {
      if (document.hidden) { state.run = false; cancelAnimationFrame(state.raf) }
      else if (!state.run) { state.run = true; state.last = performance.now(); state.raf = requestAnimationFrame(tick) }
    }

    window.addEventListener('resize', onResize)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseleave', onLeave)
    document.addEventListener('visibilitychange', onVis)

    state.run = true
    state.last = performance.now()
    state.raf = requestAnimationFrame(tick)

    return () => {
      state.run = false
      cancelAnimationFrame(state.raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('visibilitychange', onVis)
      root.innerHTML = ''
    }
  }, [])

  return <div ref={rootRef} aria-hidden="true" />
}