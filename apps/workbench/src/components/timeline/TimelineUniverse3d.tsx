/** 视图 B：节点宇宙（Three.js，第 2 轮升级）
 *  4 连线可交互：连线/节点可点击，点击后全局降光 → 关联节点与连接线鲜明高亮（双层强调）
 *  5 详情卡移到顶部（不贴边）
 *  6 节点球：内容长度/类型/时间决定大小（限位 0.9–2.4）；类型专属表情贴球；材质辉光动态脉动
 *  7 中心人物去掉 → 换成暖色太阳（辉光 + 光晕）
 *  保留：内容气泡浮现、时间游标、专注模式、重置视角、语义图例
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { TL_COLOR, TL_DESC, TL_TYPES, dayLabel, daysAgo, filterNodes, type TimelineDay, type TimelineNode, type TimelineType } from './timeline'
import { EmptyState } from '../framework/EmptyState'
import { ServerStatusPanel } from '../framework/ServerStatusPanel'
import { logClient } from '../../api'

const SKY = 0xdcebfa
/** 中心太阳（暖色） */
const SUN_COLOR = 0xffa02e
const SUN_GLOW = 0xffb35c
/** 语义关系连线配色 */
const LINE_DATE = 0x6db8ff     // 同日期 · 中性蓝
const LINE_TYPE = 0xffb066     // 同类型 · 琥珀
const LINE_RADIAL = 0x8fb9e8   // 辐射
/** 高亮（选中关系）：暖金加粗 + 两端脉冲，一眼定位 */
const HL_LINE = 0xffd76a
const HL_PULSE = 0xffe08a
const DIM = new THREE.Color(0x35415c) // 降光基调（更深，突出高亮）
const SIZE_MIN = 0.9
const SIZE_MAX = 2.4
const SPEED_STEPS = [0, 0.55, 1, 1.7]
const SPEED_LABEL = ['静止', '慢', '中', '快']
const MAX_FLOAT = 3
/** 节点类型 → 表情（调皮一点） */
const TYPE_EMOJI: Record<TimelineType, string> = {
  journal: '✍️', note: '💡', plan: '✅', checkin: '🔥', ledger: '💰', goal: '🎯',
}

const ORBITS = [26, 42, 58]
const LAYER_OF = (di: number) => (di === 0 ? 0 : di <= 6 ? 1 : 2)
const SIZE_OF = [1.7, 1.15, 0.75]

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

interface FloatBubble {
  id: number
  node: THREE.Mesh
  el: HTMLDivElement
  line: HTMLDivElement
  born: number
  dur: number
  paused: boolean
}

interface PairInfo { kind: 'date' | 'type'; a: THREE.Mesh; b: THREE.Mesh }

export function TimelineUniverse3d({ days, filter, avatar, onBack, onOpenGame }: {
  days: TimelineDay[]
  filter: TimelineType | 'all'
  avatar: string
  onBack?: () => void
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
  const [legendOpen, setLegendOpen] = useState(true)
  const [cursor, setCursor] = useState(0)
  const floatRef = useRef(floatOn)
  const cursorRef = useRef(0)
  const winClearRef = useRef<(() => void) | null>(null)
  const camRef = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; initPos: THREE.Vector3; initTarget: THREE.Vector3 } | null>(null)
  const bubbles = useRef<Map<number, FloatBubble>>(new Map())
  const bubbleId = useRef(0)
  const cursorMax = Math.min(90, Math.max(30, days.length))

  const totalNodes = days.reduce((s, d) => s + filterNodes(d.items, filter).length, 0)
  /** 各类型节点计数（图例徽标） */
  const typeCounts = useMemo(() => {
    const m = {} as Record<TimelineType, number>
    for (const d of days) for (const it of filterNodes(d.items, filter)) m[it.t] = (m[it.t] ?? 0) + 1
    return m
  }, [days, filter])

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

    // 星空
    const sg = new THREE.BufferGeometry()
    const sn = 1400, spos = new Float32Array(sn * 3)
    for (let i = 0; i < sn; i++) {
      const r = 170 + Math.random() * 420
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1)
      spos[i * 3] = r * Math.sin(ph) * Math.cos(th)
      spos[i * 3 + 1] = r * Math.cos(ph)
      spos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th)
    }
    sg.setAttribute('position', new THREE.BufferAttribute(spos, 3))
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.4 }))
    scene.add(stars)

    // ── 7 中心太阳（去掉人物 + 发光暖晕） ──
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(4.8, 48, 48),
      new THREE.MeshStandardMaterial({ color: SUN_COLOR, emissive: 0xffc23f, emissiveIntensity: 1.4, roughness: 0.4 }),
    )
    scene.add(sun)
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(8.4, 32, 32),
      new THREE.MeshBasicMaterial({ color: SUN_GLOW, transparent: true, opacity: 0.16 }),
    )
    scene.add(glow)
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(13, 13.4, 96),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }),
    )
    halo.rotation.x = Math.PI / 2
    scene.add(halo)

    // 轨道环
    const ringMat = new THREE.LineDashedMaterial({ color: 0x9cc3ec, dashSize: 1.1, gapSize: 0.8, transparent: true, opacity: 0.5 })
    ORBITS.forEach((r, i) => {
      const g = new THREE.BufferGeometry()
      const pts: number[] = []
      for (let k = 0; k <= 128; k++) {
        const a = (k / 128) * Math.PI * 2
        pts.push(Math.cos(a) * r, 0, Math.sin(a) * r)
      }
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
      const ln = new THREE.LineLoop(g, ringMat)
      ln.rotation.x = [0, 0.42, -0.42][i]
      ln.computeLineDistances()
      scene.add(ln)
    })

    // ── 6 节点：大小由内容/类型/时间决定（限位 0.9–2.4）+ 类型表情贴球 ──
    const meshByNode = new Map<TimelineNode, THREE.Mesh>()
    const sphereGeo = new THREE.SphereGeometry(1, 22, 22)
    const disposals: { dispose: () => void }[] = []
    // 类型表情纹理（共享，每种一张）
    const emojiTex = new Map<TimelineType, THREE.Texture>()
    const sprites: THREE.Sprite[] = []
    for (const [k, e] of Object.entries(TYPE_EMOJI)) {
      const cv = document.createElement('canvas')
      cv.width = 128; cv.height = 128
      const cx = cv.getContext('2d')!
      cx.font = '74px system-ui, "Segoe UI Emoji", "PingFang SC", sans-serif'
      cx.textAlign = 'center'; cx.textBaseline = 'middle'
      cx.fillText(e, 64, 66)
      emojiTex.set(k as TimelineType, new THREE.CanvasTexture(cv))
    }
    let di = 0
    for (const d of days) {
      const list = filterNodes(d.items, filter)
      list.forEach((it) => {
        const layer = LAYER_OF(di)
        const orbitR = ORBITS[layer] + (Math.random() - 0.5) * 2.6
        const phi0 = (Math.random() - 0.5) * 2.4
        const theta0 = Math.random() * Math.PI * 2
        const speed = (0.16 + Math.random() * 0.1) * (layer === 2 ? 0.66 : layer === 1 ? 0.85 : 1)
        const precess = (Math.random() - 0.5) * 0.004
        // 大小：内容权重（标题/摘要长度）叠层半径系数，并限位
        const len = it.title.length + (it.sub?.length ?? 0)
        const content = Math.min(1.4, Math.max(0.8, 0.8 + len * 0.014))
        const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, SIZE_OF[layer] * content))
        const baseOp = 0.95 // 远层淡化改为浅层微降，整体更亮更炫
        const mat = new THREE.MeshStandardMaterial({
          color: TL_COLOR[it.t], emissive: TL_COLOR[it.t], emissiveIntensity: 0.6,
          roughness: 0.42, metalness: 0.05, transparent: true, opacity: baseOp,
        })
        const mesh = new THREE.Mesh(sphereGeo, mat)
        mesh.scale.setScalar(size)
        // 表情贴球
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTex.get(it.t), transparent: true, depthWrite: false }))
        spr.scale.setScalar(size * 2.7)
        spr.renderOrder = 3
        scene.add(spr)
        sprites.push(spr)
        mesh.userData = { it, layer, orbitR, theta0, phi0, speed, precess, size, baseOp, dim: 0, boost: 0, phase0: Math.random() * 7, spr }
        scene.add(mesh)
        meshByNode.set(it, mesh)
        disposals.push(mat)
      })
      di++
    }
    const allNodes = [...meshByNode.values()]

    // ── 连线：合并成单对象（逐顶点着色，供高亮重绘）+ 辐射线 ──
    const datePairs: [THREE.Mesh, THREE.Mesh][] = []
    const typePairs: [THREE.Mesh, THREE.Mesh][] = []
    const lastByType = new Map<TimelineType, THREE.Mesh>()
    for (const d of days) {
      const list = filterNodes(d.items, filter).map((it) => meshByNode.get(it)!).filter(Boolean)
      for (let j = 1; j < list.length; j++) datePairs.push([list[j - 1], list[j]])
      list.forEach((m) => {
        const t = (m.userData.it as TimelineNode).t
        const prev = lastByType.get(t)
        if (prev) typePairs.push([prev, m])
        lastByType.set(t, m)
      })
    }
    let pairInfos: PairInfo[] = [
      ...datePairs.map(([a, b]) => ({ kind: 'date' as const, a, b })),
      ...typePairs.map(([a, b]) => ({ kind: 'type' as const, a, b })),
    ]
    // ── 限边：连线总量封顶，超出时优先裁掉“同类型”长链尾部（保留同日期与较早关系） ──
    const MAX_CONN = 240
    if (pairInfos.length > MAX_CONN) pairInfos = pairInfos.slice(0, MAX_CONN)
    const mergedGeo = new THREE.BufferGeometry()
    mergedGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pairInfos.length * 6), 3))
    mergedGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pairInfos.length * 6), 3))
    // 柔和玻璃风：连线半透明，不再以接近不透明的纯黑压满画面
    const merged = new THREE.LineSegments(mergedGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }))
    merged.renderOrder = 1
    scene.add(merged)
    // 辐射线：按节点规模采样绘制，避免“蜘蛛网”式视觉过载
    const radialNodes = allNodes.length > 60 ? allNodes.filter((_, i) => i % 2 === 0) : allNodes
    const radialGeo = new THREE.BufferGeometry()
    radialGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(radialNodes.length * 6), 3))
    const radialMat = new THREE.LineBasicMaterial({ color: LINE_RADIAL, transparent: true, opacity: 0.22 })
    const radial = new THREE.LineSegments(radialGeo, radialMat)
    radial.renderOrder = 1
    scene.add(radial)
    // ── 高亮加粗连线（LineSegments2 宽线）：选中关系时以暖金粗线 + 叠加发光描边 ──
    const hlGeo = new LineSegmentsGeometry()
    const hlMat = new LineMaterial({
      color: HL_LINE,
      linewidth: 4.5,
      resolution: new THREE.Vector2(box.clientWidth, box.clientHeight),
      transparent: true,
      opacity: 0,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
    const hl = new LineSegments2(hlGeo, hlMat)
    hl.renderOrder = 8
    hl.visible = false
    scene.add(hl)
    // 选中关系两端/中心的脉冲标记
    const pulseMat = new THREE.MeshBasicMaterial({ color: HL_PULSE, transparent: true, opacity: 0, depthWrite: false })
    const pulse = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 20), pulseMat)
    pulse.renderOrder = 9
    pulse.visible = false
    scene.add(pulse)
    const PAIR_COLOR: Record<'date' | 'type', THREE.Color> = { date: new THREE.Color(LINE_DATE), type: new THREE.Color(LINE_TYPE) }
    // 初始即写入语义色（同日期=蓝、同类型=琥珀，与图例一致）；此前颜色缓冲全 0 → 连线渲染成纯黑
    paintPairs(null)

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
      const pt = mergedGeo.attributes.position.array as Float32Array
      let k = 0
      pairInfos.forEach((pi, i) => {
        if (isolatedPairs && !isolatedPairs.has(i)) {
          // 隔离态：无关线段收敛原点（零长度=不可见），只保留关联连接
          pt[k++] = 0; pt[k++] = 0; pt[k++] = 0
          pt[k++] = 0; pt[k++] = 0; pt[k++] = 0
          return
        }
        pt[k++] = pi.a.position.x; pt[k++] = pi.a.position.y; pt[k++] = pi.a.position.z
        pt[k++] = pi.b.position.x; pt[k++] = pi.b.position.y; pt[k++] = pi.b.position.z
      })
      mergedGeo.attributes.position.needsUpdate = true
      const rt = radialGeo.attributes.position.array as Float32Array
      let r2 = 0
      radialNodes.forEach((m) => {
        rt[r2++] = 0; rt[r2++] = 0; rt[r2++] = 0
        rt[r2++] = m.position.x; rt[r2++] = m.position.y; rt[r2++] = m.position.z
      })
      radialGeo.attributes.position.needsUpdate = true
      // 高亮宽线：只在隔离态时重建（非隔离态直接隐藏，不再每帧分配空数组）
      if (isolatedPairs) {
        const hlArr: number[] = []
        isolatedPairs.forEach((i) => {
          const pi = pairInfos[i]
          if (!pi) return
          hlArr.push(pi.a.position.x, pi.a.position.y, pi.a.position.z)
          hlArr.push(pi.b.position.x, pi.b.position.y, pi.b.position.z)
        })
        hlGeo.setPositions(hlArr)
        hl.visible = hlArr.length > 0
      } else if (hl.visible) {
        hl.visible = false
      }
    }

    /** 重绘连线颜色：相关 pair 用语义亮色，其余统一降光 */
    function paintPairs(related: Set<number> | null) {
      const col = mergedGeo.attributes.color.array as Float32Array
      const hasRel = related !== null
      pairInfos.forEach((pi, i) => {
        const c = !hasRel ? PAIR_COLOR[pi.kind] : related!.has(i) ? PAIR_COLOR[pi.kind] : DIM
        const o = i * 6
        for (let v = 0; v < 6; v += 3) { col[o + v] = c.r; col[o + v + 1] = c.g; col[o + v + 2] = c.b }
      })
      mergedGeo.attributes.color.needsUpdate = true
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
      paintPairs(pairs)
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
      paintPairs(null)
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
    const onClick = (e: PointerEvent) => {
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
        const i = nearestPair(hitLine.point, pairInfos)
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

    function nearestPair(p: THREE.Vector3, infos: PairInfo[]): number {
      const ab = new THREE.Vector3()
      let best = -1, bd = 2.6 * 2.6 // 命中半径阈值（世界单位²）
      infos.forEach((pi, i) => {
        ab.subVectors(pi.b.position, pi.a.position)
        const len2 = ab.lengthSq()
        if (len2 === 0) return
        let t = p.clone().sub(pi.a.position).dot(ab) / len2
        t = Math.max(0, Math.min(1, t))
        const q = pi.a.position.clone().addScaledVector(ab, t)
        const d = p.distanceToSquared(q)
        if (d < bd) { bd = d; best = i }
      })
      return best
    }

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
        sun.rotation.y += 0.01
        sun.scale.setScalar(1 + Math.sin(t * 1.5) * 0.045)
        glow.scale.setScalar(1 + Math.sin(t * 1.1) * 0.06)
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
      meshByNode.forEach((m) => { scene.remove(m); m.geometry.dispose() })
      sprites.forEach((sp) => {
        scene.remove(sp)
        sp.material.dispose()
        sp.material.map?.dispose()
      })
      emojiTex.forEach((tx) => tx.dispose())
      disposals.forEach((d) => d.dispose())
      sg.dispose(); (stars.material as THREE.Material).dispose()
      mergedGeo.dispose(); merged.material.dispose(); scene.remove(merged)
      radialGeo.dispose(); radialMat.dispose(); scene.remove(radial)
      hlGeo.dispose(); hlMat.dispose(); scene.remove(hl)
      pulse.geometry.dispose(); pulseMat.dispose(); scene.remove(pulse)
      scene.remove(sun, glow, halo, stars)
      sun.geometry.dispose(); (sun.material as THREE.Material).dispose()
      glow.geometry.dispose(); (glow.material as THREE.Material).dispose()
      halo.geometry.dispose(); (halo.material as THREE.Material).dispose()
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
      {/* 左上：标题 + 返回 */}
      <div className="uni3d-mini">
        <button className="uni3d-back" onClick={onBack} title="返回时光长河">← 时光长河</button>
        <span className="uni3d-title">{avatar}的节点宇宙 · {totalNodes} 颗节点</span>
      </div>
      {/* 右上：图例面板（避开头像区 · 可折叠 · 悬停看提示，需要时才占用画面） */}
      <div className={`uni3d-lg${legendOpen ? ' open' : ''}`}>
        <button className="uni3d-lg-toggle" onClick={() => setLegendOpen((o) => !o)} title={legendOpen ? '收起图例' : '展开图例'}>
          <span className="uni3d-lg-pin" />图例<span className="uni3d-lg-caret">▾</span>
        </button>
        {legendOpen && (
          <div className="uni3d-lg-body">
            <div className="lg-group">
              <div className="lg-cap">类型 · 悬浮节点看详情</div>
              <div className="lg-types">
                {TL_TYPES.map(([k, l]) => (
                  <span className="uni3d-legend-item" key={k} title={`${l} · ${typeCounts[k] ?? 0} 颗 · 点击节点高亮同类型关系`}>
                    <i style={{ background: TL_COLOR[k] }} />{l}
                    <em>{typeCounts[k] ?? 0}</em>
                  </span>
                ))}
              </div>
            </div>
            <div className="lg-group">
              <div className="lg-cap">关系连线 · 点击可选中</div>
              <div className="lg-rels">
                <span className="rl-item" title="同一天的节点自动相连"><i style={{ background: '#6db8ff' }} />同日期</span>
                <span className="rl-item" title="同一类型的节点自动串联"><i style={{ background: '#ffb066' }} />同类型</span>
                <span className="rl-item" title="节点到中心的辐射参考线"><i style={{ background: '#8fb9e8' }} />辐射</span>
                <span className="rl-item hot" title="选中后：暖金加粗 + 相机自动聚焦"><i style={{ background: '#ffd76a' }} />选中</span>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* 底部辅助栏（纯功能控件；进入专注模式后整体隐藏） */}
      <div className="uni3d-bar">
        <span className="ub-label">转速</span>
        {SPEED_LABEL.map((l, i) => (
          <button key={l} className={`ub-btn${speedIdx === i ? ' on' : ''}`} onClick={() => { setSpeedIdx(i); speedRef.current = SPEED_STEPS[i] }}>{l}</button>
        ))}
        <button className="ub-btn" onClick={() => setFocusMode((f) => !f)}>专注模式</button>
        <button className="ub-btn" onClick={() => { const c = camRef.current; if (c) { c.camera.position.copy(c.initPos); c.controls.target.copy(c.initTarget); c.camera.updateProjectionMatrix() } }} disabled={!camRef.current} title="回到初始视角">重置视角</button>
        <button className={`ub-btn${floatOn ? ' on' : ''}`} onClick={() => setFloatOn((v) => !v)}>内容浮现 {floatOn ? '开' : '关'}</button>
        <button className="ub-btn game" onClick={() => onOpenGame?.()} title="游戏·讨伐：回到时光长河并展开讨伐卡">⚔️ 讨伐</button>
        <span className="ub-div" />
        <span className="ub-label">时间游标</span>
        <span className="ub-cursor">
          <input type="range" min={0} max={cursorMax} value={cursor}
            onChange={(e) => setCursor(Number(e.target.value))} aria-label="时间游标" />
          <em>{cursor === 0 ? '全部' : `近 ${cursor} 天`}</em>
        </span>
      </div>
      {/* 服务器实时状态（左下角）：CPU / 内存 / 网络，感知节点宇宙对服务器的负载 */}
      <ServerStatusPanel />
      {/* 专注模式浮层提示（进入后其余控件全部隐藏，仅此一条 + Esc 退出） */}
      {focusMode && <div className="uni3d-focus-hint">专注中 · Esc 退出</div>}
      {/* 悬停信息卡 */}
      {tip && (
        <div ref={tipRef} className="uni3d-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <div className="t-type">{TL_TYPES.find(([k]) => k === tip.it.t)?.[1]} · 第 {tip.layer + 1} 层轨道 · {daysAgo(tip.it.date) === 0 ? '今天' : `${daysAgo(tip.it.date)} 天前`}</div>
          <div className="t-title">{tip.it.title}</div>
          <div className="t-meta">{dayLabel(tip.it.date).d}{tip.it.xp ? ` · +${tip.it.xp} XP` : ''}{tip.it.gold ? ` · +${tip.it.gold} 金币` : ''}</div>
        </div>
      )}
      {/* 详情卡：节点 或 连接 */}
      {(selNode || selPair) && (
        <div className="uni3d-card" onClick={clearSel}>
          {selNode ? (
            <>
              <div className="uh"><span className="udot" style={{ background: TL_COLOR[selNode.t] }} />{TYPE_EMOJI[selNode.t]} {selNode.title}</div>
              <div className="us">{selNode.sub || TL_DESC[selNode.t]}</div>
              <div className="um">{dayLabel(selNode.date).d} · {TL_TYPES.find(([k]) => k === selNode.t)?.[1]}{selNode.xp ? ` · +${selNode.xp} XP` : ''}{selNode.gold ? ` · +${selNode.gold} 金币` : ''} · Esc 取消高亮</div>
            </>
          ) : selPair && (
            <>
              <div className="uh"><span className="udot" style={{ background: selPair.kind === 'date' ? '#6db8ff' : '#ffb066' }} />{selPair.kind === 'date' ? '同日期连接' : '同类型连接'}</div>
              <div className="us">{selPair.a.title} ⇄ {selPair.b.title}</div>
              <div className="um">{dayLabel(selPair.a.date).d} ↔ {dayLabel(selPair.b.date).d} · Esc 取消高亮</div>
            </>
          )}
        </div>
      )}
    </div>
  )
}