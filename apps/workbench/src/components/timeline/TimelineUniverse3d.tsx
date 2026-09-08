/** 视图 B：节点宇宙（Three.js，第 2 轮升级）
 *  4 连线可交互：连线/节点可点击，点击后全局降光 → 关联节点与连接线鲜明高亮（双层强调）
 *  5 详情卡移到顶部（不贴边）
 *  6 节点球：内容长度/类型/时间决定大小（限位 0.9–2.4）；类型专属表情贴球；材质辉光动态脉动
 *  7 中心人物去掉 → 换成暖色太阳（辉光 + 光晕）
 *  保留：内容气泡浮现、时间游标、专注模式、重置视角、语义图例
 *  构建块（场景/节点连线）与渲染循环/交互分离：environment.ts 与 nodes.ts 为纯构建，
 *  本组件保留生命周期、拾取交互与渲染循环驱动。
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TL_COLOR, TL_TYPES, daysAgo, filterNodes, type TimelineDay, type TimelineNode, type TimelineType } from './timeline'
import { EmptyState } from '../framework/EmptyState'
import { ServerStatusPanel } from '../framework/ServerStatusPanel'
import { logClient } from '../../api'
import { DIM, MAX_FLOAT, SKY, SPEED_STEPS, escapeHtml, type FloatBubble, type PairInfo } from './universe3d/consts'
import { createEnvironment, type UniverseEnvironment } from './universe3d/environment'
import { buildNodeWorld, type NodeWorld } from './universe3d/nodes'
import { UniverseControls } from './universe3d/UniverseControls'
import { UniverseDetailCard } from './universe3d/UniverseDetailCard'
import { UniverseLegend } from './universe3d/UniverseLegend'
import { UniverseTooltip } from './universe3d/UniverseTooltip'

export function TimelineUniverse3d({ days, filter, avatar, battle = true, onOpenGame }: {
  days: TimelineDay[]
  filter: TimelineType[]
  avatar: string
  /** 讨伐开关（设置 → 游戏）：关闭时隐藏 ⚔️ 入口 */
  battle?: boolean
  /** 游戏入口：跳回时光长河并展开讨伐卡 */
  onOpenGame?: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const speedRef = useRef(SPEED_STEPS[2])
  const [tip, setTip] = useState<{ x: number; y: number; it: TimelineNode; layer: number } | null>(null)
  const [selNode, setSelNode] = useState<TimelineNode | null>(null)
  const [selPair, setSelPair] = useState<{ kind: 'date' | 'type'; a: TimelineNode; b: TimelineNode } | null>(null)
  const [speedIdx, setSpeedIdx] = useState(2)
  const [floatOn, setFloatOn] = useState(true)
  const [focusMode, setFocusMode] = useState(false)
  const [cursor, setCursor] = useState(0)
  const floatRef = useRef(floatOn)
  const cursorRef = useRef(0)
  const winClearRef = useRef<(() => void) | null>(null)
  const camRef = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; initPos: THREE.Vector3; initTarget: THREE.Vector3 } | null>(null)
  const bubbles = useRef<Map<number, FloatBubble>>(new Map())
  const bubbleId = useRef(0)
  const cursorMax = Math.min(90, Math.max(30, days.length))

  const totalNodes = days.reduce((s, d) => s + filterNodes(d.items, filter).length, 0)

  useEffect(() => { floatRef.current = floatOn }, [floatOn])
  useEffect(() => { cursorRef.current = cursor }, [cursor])

  // 专注模式：Esc 优先退出高亮，再退专注
  useEffect(() => {
    if (!focusMode && !selNode && !selPair) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selNode || selPair) { clearSel(); return }
      if (focusMode) setFocusMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode, selNode, selPair])

  useEffect(() => {
    const boxEl = boxRef.current
    if (!boxEl || totalNodes === 0) return
    const box: HTMLDivElement = boxEl
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(SKY, 0.009)
    const camera = new THREE.PerspectiveCamera(52, box.clientWidth / box.clientHeight, 0.1, 1000)
    camera.position.set(26, 52, 60)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setClearColor(0x000000, 0)
    renderer.setSize(box.clientWidth, box.clientHeight)
    // 初始像素比上限 1.5（高 DPI 屏也别顶全档，给 GPU 留余量；极端负载下会自动降级到 1）
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    box.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.autoRotate = true
    controls.autoRotateSpeed = 0.35 * speedRef.current
    controls.minDistance = 18
    controls.maxDistance = 240
    camRef.current = { camera, controls, initPos: camera.position.clone(), initTarget: controls.target.clone() }

    scene.add(new THREE.AmbientLight(0xcfdff5, 1.15))
    const sunLight = new THREE.PointLight(0xffe0b0, 3.2, 500)
    scene.add(sunLight)

    // ══ 环境（星空 / 太阳 / 轨道 / 流星）与节点连线（构建块，纯构建） ══
    const env: UniverseEnvironment = createEnvironment(scene, reduced)
    const world: NodeWorld = buildNodeWorld(scene, days, filter, { width: box.clientWidth, height: box.clientHeight })
    const { allNodes, pairInfos, radialMat, merged, hlMat, pulse, pulseMat } = world
    // 初始即写入语义色（同日期=蓝、同类型=琥珀，与图例一致）；此前颜色缓冲全 0 → 连线渲染成纯黑
    world.paintPairs(null)

    /** 连线隔离态：设置后每帧只绘制集合内的线段（其余收敛原点不可见） */
    let isolatedPairs: Set<number> | null = null
    /** 选中聚焦：相关联节点集 + 拟合视距（每帧自动拉近到关系中心） */
    let focusNodes: Set<THREE.Mesh> | null = null
    let focusDist = 40

    const tmp = new THREE.Vector3()
    function nodePos(n: THREE.Mesh) {
      const u = n.userData
      u.theta0 += u.speed * 0.016 * speedRef.current
      u.phi0 += u.precess * 0.016 * speedRef.current
      if (u.phi0 > 1.2) { u.phi0 = 1.2; u.precess = -Math.abs(u.precess) }
      if (u.phi0 < -1.2) { u.phi0 = -1.2; u.precess = Math.abs(u.precess) }
      const a = u.theta0, p = u.phi0, r = u.orbitR
      const cp = Math.cos(p)
      return tmp.set(r * cp * Math.cos(a), r * Math.sin(p), r * cp * Math.sin(a))
    }
    function writeGeo() {
      world.writeGeo(isolatedPairs)
    }

    /**
     * 强调态（hover 轻度 / click 重度）：
     * - 降光：无关节点 opacity→(hover .25 / click .07)，无关连线→灰色
     * - 亮点：相关节点放大(2x/1.25x)+辉光，相关连线→语义亮色
     */
    function emphasize(nodes: Set<THREE.Mesh>, pairs: Set<number>, heavy: boolean) {
      const dimF = heavy ? 0.06 : 0.16
      allNodes.forEach((m) => {
        const u = m.userData
        const related = nodes.has(m)
        u.dim = related ? 0 : 1
        u.boost = related ? 1 : 0
        m.scale.setScalar(u.size * (related ? (heavy ? 2 : 1.4) : 1))
        if (!related) u.dimF = dimF
        else delete u.dimF
      })
      radialMat.opacity = heavy ? 0.04 : 0.08
      isolatedPairs = pairs
      world.paintPairs(pairs)
      // 选中关系：自动聚焦（拉近视角到关系中心）+ 高亮宽线 + 脉冲标记
      if (heavy) {
        focusNodes = nodes
        controls.autoRotate = false // 聚焦期间停止自转，避免视角跑偏
        // 由关联节点当前包围半径估算拟合视距
        let maxR = 8
        const c = new THREE.Vector3()
        nodes.forEach((m) => { c.add(m.position) })
        c.divideScalar(nodes.size)
        nodes.forEach((m) => { const d = m.position.distanceTo(c); if (d > maxR) maxR = d })
        const fov = camera.fov * Math.PI / 180
        focusDist = Math.max(20, Math.min(110, (maxR * 1.6) / Math.tan(fov / 2)))
        hlMat.opacity = 0.95
      } else {
        hlMat.opacity = 0.55
      }
    }
    function restoreEmphasis() {
      allNodes.forEach((m) => {
        const u = m.userData
        u.dim = 0; u.boost = 0
        delete u.dimF
        m.scale.setScalar(u.size)
      })
      radialMat.opacity = 0.22
      isolatedPairs = null
      focusNodes = null
      controls.autoRotate = true // 恢复自转
      hlMat.opacity = 0
      pulse.visible = false
      world.paintPairs(null)
    }
    function nodeNeighbors(m: THREE.Mesh): { nodes: Set<THREE.Mesh>; pairs: Set<number> } {
      const nodes = new Set<THREE.Mesh>([m])
      const pairs = new Set<number>()
      pairInfos.forEach((pi, i) => {
        if (pi.a === m || pi.b === m) { pairs.add(i); nodes.add(pi.a); nodes.add(pi.b) }
      })
      return { nodes, pairs }
    }

    /** 当前强调态：pinned=true 表示点击常驻高亮（hover 不再覆盖） */
    let pinned = false
    function setFocus(nodes: Set<THREE.Mesh>, pairs: Set<number>, heavy: boolean) {
      emphasize(nodes, pairs, heavy)
      pinned = heavy
    }
    function clearFocus() {
      restoreEmphasis()
      pinned = false
    }

    // ── 悬停 / 点击拾取 ──
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let hovered: THREE.Mesh | null = null
    const pointerLocal = new THREE.Vector2()
    const needsPick = { current: false }
    const onMove = (e: PointerEvent) => {
      const rc = box.getBoundingClientRect()
      ndc.x = ((e.clientX - rc.left) / rc.width) * 2 - 1
      ndc.y = -((e.clientY - rc.top) / rc.height) * 2 + 1
      pointerLocal.set(e.clientX - rc.left, e.clientY - rc.top)
      if (tipRef.current) {
        tipRef.current.style.left = `${pointerLocal.x + 14}px`
        tipRef.current.style.top = `${pointerLocal.y + 14}px`
      }
      needsPick.current = true
    }
    const onLeave = () => { needsPick.current = false; setTip(null); hovered = null }
    box.addEventListener('pointermove', onMove)
    box.addEventListener('pointerleave', onLeave)
    const pick = () => {
      ray.setFromCamera(ndc, camera)
      const hit = ray.intersectObjects(allNodes)[0]
      const next = hit ? (hit.object as THREE.Mesh) : null
      if (next !== hovered) {
        hovered = next
        if (next) {
          const u = next.userData
          setTip({ it: u.it as TimelineNode, layer: u.layer as number, x: pointerLocal.x, y: pointerLocal.y })
          if (!pinned) {
            const { nodes, pairs } = nodeNeighbors(next)
            emphasize(nodes, pairs, false) // hover 轻度强调
          }
        } else {
          setTip(null)
          if (!pinned) restoreEmphasis()
        }
      }
    }

    /** 点击：命中节点 → 强调该节点关系网；命中连线 → 强调该段与两端节点 */
    const onClick = (e: MouseEvent) => {
      const rc = box.getBoundingClientRect()
      const nx = ((e.clientX - rc.left) / rc.width) * 2 - 1
      const ny = -((e.clientY - rc.top) / rc.height) * 2 + 1
      ray.setFromCamera(new THREE.Vector2(nx, ny), camera)
      const hitNode = ray.intersectObjects(allNodes)[0]
      if (hitNode) {
        const m = hitNode.object as THREE.Mesh
        const { nodes, pairs } = nodeNeighbors(m)
        setFocus(nodes, pairs, true)
        setSelNode(m.userData.it as TimelineNode)
        setSelPair(null)
        return
      }
      const hitLine = ray.intersectObject(merged)[0]
      if (hitLine && hitLine.point) {
        const i = world.nearestPair(hitLine.point)
        if (i >= 0) {
          setSelPair({ kind: pairInfos[i].kind, a: pairInfos[i].a.userData.it, b: pairInfos[i].b.userData.it })
          setSelNode(null)
          setFocus(new Set([pairInfos[i].a, pairInfos[i].b]), new Set([i]), true)
          return
        }
      }
      // 空白处：清除强调与选中
      clearFocus()
      setSelNode(null)
      setSelPair(null)
    }
    renderer.domElement.addEventListener('click', onClick)

    function clearSel() {
      clearFocus()
      setSelNode(null)
      setSelPair(null)
      setTip(null)
    }
    winClearRef.current = clearSel

    // ── 4.1 内容气泡：DOM 直改零重渲染 ──
    const v2 = new THREE.Vector3()
    const wv = new THREE.Vector3()
    function project(mesh: THREE.Mesh) {
      wv.copy(mesh.position)
      v2.copy(wv).project(camera)
      return { x: (v2.x * 0.5 + 0.5) * box.clientWidth, y: (-v2.y * 0.5 + 0.5) * box.clientHeight, z: v2.z }
    }
    function removeBubble(entry: FloatBubble) {
      entry.el.remove(); entry.line.remove()
      bubbles.current.delete(entry.id)
    }
    function spawnBubble(now: number) {
      if (!floatRef.current || reduced || bubbles.current.size >= MAX_FLOAT) return
      const node = allNodes[Math.floor(Math.random() * allNodes.length)]
      const it = node.userData.it as TimelineNode
      const p = project(node)
      if (p.z > 1 || p.z < -1 || p.x < 20 || p.y < 20 || p.x > box.clientWidth - 20 || p.y > box.clientHeight - 120) return
      const id = ++bubbleId.current
      const el = document.createElement('div')
      el.className = 'uni3d-cbubble'
      const typeLabel = TL_TYPES.find(([k]) => k === it.t)?.[1] ?? it.t
      const rel = daysAgo(it.date) === 0 ? '今天' : `${daysAgo(it.date)} 天前`
      el.innerHTML =
        `<b>${escapeHtml(it.title)}</b>` +
        `<em>${typeLabel} · ${rel}</em>` +
        (it.sub ? `<span>${escapeHtml(it.sub.slice(0, 60))}</span>` : '')
      const line = document.createElement('div')
      line.className = 'uni3d-cbubble-line'
      box.appendChild(line)
      box.appendChild(el)
      const entry: FloatBubble = { id, node, el, line, born: now, dur: 3600 + Math.random() * 1600, paused: false }
      el.addEventListener('mouseenter', () => { entry.paused = true })
      el.addEventListener('mouseleave', () => { entry.paused = false })
      bubbles.current.set(id, entry)
    }
    function updateBubbles(now: number) {
      bubbles.current.forEach((entry) => {
        const p = project(entry.node)
        const hide = p.z > 1 || p.z < -1
        entry.line.style.display = hide ? 'none' : ''
        entry.el.style.display = hide ? 'none' : ''
        if (hide) return
        const bx = p.x + 12, by = p.y - 42
        const dx = bx - p.x, dy = by - p.y
        const len = Math.hypot(dx, dy)
        entry.line.style.width = `${len}px`
        entry.line.style.left = `${p.x}px`
        entry.line.style.top = `${p.y}px`
        entry.line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`
        entry.el.style.left = `${bx}px`
        entry.el.style.top = `${by}px`
        if (!entry.paused && now - entry.born > entry.dur) removeBubble(entry)
      })
    }

    // ── 渲染循环（含自适应降质 + 异常续帧，防"用着用着卡死"） ──
    const clock = new THREE.Clock()
    let raf = 0
    let bubbleTimer = 1500
    // 性能自适应：EMA 帧耗时评估，超阈值降质（先降像素比，再隔帧重绘）
    const frameStat = { ema: 0, count: 0, degrade: 0, lastPick: 0, frame: 0, errCount: 0 }
    const DPR_FULL = Math.min(devicePixelRatio, 1.5)
    const applyDegrade = (lv: number) => {
      frameStat.degrade = lv
      renderer.setPixelRatio(lv >= 1 ? Math.min(devicePixelRatio, 1) : DPR_FULL)
      renderer.setSize(box.clientWidth, box.clientHeight)
      logClient('warn', 'universe', lv >= 1 ? `画面过载，已降级渲染${lv >= 2 ? '（隔帧绘制）' : '（低分辨率）'}` : '负载恢复，渲染质量已回升', { degrade: lv })
    }
    const step = () => {
      try {
        const dt = clock.getDelta()
        const t = clock.getElapsedTime()
        const now = performance.now()
        // 帧耗时 EMA（覆盖 dt，含渲染耗时近似）
        frameStat.ema = frameStat.ema === 0 ? dt : frameStat.ema * 0.92 + dt * 0.08
        frameStat.frame++
        // 每 60 帧评估一次负载（EMA 太粗在慢帧后收敛）
        if (frameStat.frame % 60 === 0) {
          if (frameStat.ema > 0.05 && frameStat.degrade < 2) applyDegrade(frameStat.degrade + 1)
          else if (frameStat.ema < 0.02 && frameStat.degrade > 0) applyDegrade(frameStat.degrade - 1)
        }
        // 降质 L2：隔帧才做重型步骤（位置推进保持每帧，writeGeo/材质/渲染隔帧做，大幅降 GPU 带宽）
        const heavy = frameStat.degrade < 2 || frameStat.frame % 2 === 0
        allNodes.forEach((m) => {
          m.position.copy(nodePos(m))
          if (!heavy) return
          const u = m.userData
          const mat = m.material as THREE.MeshStandardMaterial
          mat.opacity = (u.baseOp ?? 0.95) * nodeFadeOf(u.it as TimelineNode) * (u.dim ? (u.dimF ?? 0.35) : 1)
          mat.emissiveIntensity = u.boost ? 1.7 : 0.55 + 0.4 * Math.sin(t * 1.7 + u.phase0)
          if (u.spr) u.spr.position.copy(m.position)
        })
        env.update(t, dt)
        controls.autoRotateSpeed = 0.35 * speedRef.current
        if (heavy) {
          writeGeo()
          // 选中关系：相机平滑拉近到关系中心（跟随节点移动），快速定位
          if (focusNodes && focusNodes.size) {
            const c = new THREE.Vector3()
            focusNodes.forEach((m) => { c.add(m.position) })
            c.divideScalar(focusNodes.size)
            controls.target.lerp(c, 0.09)
            const dist = camera.position.distanceTo(controls.target)
            if (dist > focusDist * 1.06) controls.dollyIn(1.04)
            else if (dist < focusDist * 0.94) controls.dollyOut(1.04)
            pulse.position.copy(c)
            pulse.scale.setScalar(2.6 + Math.sin(t * 5) * 1.1)
            pulseMat.opacity = 0.5 + 0.3 * Math.sin(t * 5)
            pulse.visible = true
          }
        }
        bubbleTimer += (dt || 0.016) * 1000
        if (bubbleTimer > 3800) { bubbleTimer = 0; spawnBubble(now) }
        updateBubbles(now)
        // 拾取节流：帧间至少间隔 60ms 才做一次 raycaster，且指针每动一次只拾取一次
        if (needsPick.current) {
          needsPick.current = false
          if (now - frameStat.lastPick > 60) { pick(); frameStat.lastPick = now }
        }
        controls.update()
        if (heavy) renderer.render(scene, camera)
      } catch (e) {
        // 单帧异常不中断循环：记日志续下一帧，连续异常则提示并退到隔帧低耗模式
        frameStat.errCount++
        if (frameStat.errCount <= 3) {
          logClient('error', 'universe', '渲染帧异常', { err: e instanceof Error ? e.message : String(e), errCount: frameStat.errCount })
        }
        if (frameStat.errCount === 5) {
          logClient('error', 'universe', '连续渲染异常，自动进入低耗模式', { errCount: frameStat.errCount })
          applyDegrade(2)
        }
      }
      raf = requestAnimationFrame(step)
    }
    if (reduced) {
      allNodes.forEach((m) => { m.position.copy(nodePos(m)) })
      writeGeo()
      renderer.render(scene, camera)
    } else {
      raf = requestAnimationFrame(step)
    }
    // 挂载日志：供服务器日志目录排查节点宇宙性能与稳定性
    logClient('info', 'universe', '节点宇宙已挂载', { nodes: allNodes.length, pairs: pairInfos.length, reduced: !!reduced })

    const ro = new ResizeObserver(() => {
      const w = box.clientWidth, h = box.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      hlMat.resolution.set(w, h)
    })
    ro.observe(box)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      bubbles.current.forEach((b) => { b.el.remove(); b.line.remove() })
      bubbles.current.clear()
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerleave', onLeave)
      renderer.domElement.removeEventListener('click', onClick)
      box.removeChild(renderer.domElement)
      world.dispose()
      env.dispose()
      scene.remove(sunLight)
      controls.dispose()
      renderer.dispose()
      camRef.current = null
      winClearRef.current = null
      logClient('info', 'universe', '节点宇宙已卸载')
      setTip(null); setSelNode(null); setSelPair(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, filter, totalNodes])

  // 供 Esc 处理器调用的清空函数（组件级引用，规避闭包生命周期差异）
  function clearSel() {
    const c = winClearRef.current
    if (c) c()
    else { setSelNode(null); setSelPair(null) }
  }

  // 转速切换（底栏回调）：同步档位 state 与场景闭包读取的 speedRef
  const onSpeed = (i: number) => { setSpeedIdx(i); speedRef.current = SPEED_STEPS[i] }
  // 重置视角（底栏回调）：回到挂载时的初始机位与目标点
  const onResetView = () => { const c = camRef.current; if (c) { c.camera.position.copy(c.initPos); c.controls.target.copy(c.initTarget); c.camera.updateProjectionMatrix() } }

  /** 时间游标：每帧按 cursorRef 折算节点淡出系数（0=全显） */
  function nodeFadeOf(it: TimelineNode): number {
    const c = cursorRef.current
    if (c === 0) return 1
    const ago = daysAgo(it.date)
    return ago <= c ? 1 : Math.max(0.05, 1 - (ago - c) / 8)
  }

  if (totalNodes === 0) {
    return <div className="uni3d empty"><EmptyState variant="hero" icon="🌌">太空空空如也 · 写点什么点亮它</EmptyState></div>
  }

  return (
    <div className={`uni3d${focusMode ? ' full' : ''}`}>
      <div ref={boxRef} className="uni3d-canvas" />
      {/* 左上：标题（返回快捷入口已按需求移除，切换世界走顶部分类导航） */}
      <div className="uni3d-mini">
        <span className="uni3d-title">{avatar}的节点宇宙 · {totalNodes} 颗节点</span>
      </div>
      {/* 右上：图例面板（避开头像区 · 可折叠 · 悬停看提示，需要时才占用画面） */}
      <UniverseLegend days={days} filter={filter} />
      {/* 底部辅助栏（纯功能控件；进入专注模式后整体隐藏） */}
      <UniverseControls
        speedIdx={speedIdx} onSpeed={onSpeed} onToggleFocus={() => setFocusMode((f) => !f)}
        onResetView={onResetView} canReset={!!camRef.current} floatOn={floatOn} onToggleFloat={() => setFloatOn((v) => !v)}
        battle={battle} onOpenGame={onOpenGame} cursor={cursor} cursorMax={cursorMax} onCursor={setCursor}
      />
      {/* 服务器实时状态（左下角）：CPU / 内存 / 网络，感知节点宇宙对服务器的负载 */}
      <ServerStatusPanel />
      {/* 专注模式浮层提示（进入后其余控件全部隐藏，仅此一条 + Esc 退出） */}
      {focusMode && <div className="uni3d-focus-hint">专注中 · Esc 退出</div>}
      {/* 悬停信息卡 */}
      {tip && <UniverseTooltip tip={tip} tipRef={tipRef} />}
      {/* 详情卡：节点 或 连接 */}
      <UniverseDetailCard selNode={selNode} selPair={selPair} onClose={clearSel} />
    </div>
  )
}