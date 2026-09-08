/**
 * 节点宇宙 · 节点与连线构建（节点球 + 类型表情 + 语义连线/辐射线/高亮线/脉冲）。
 * 构建结果以对象返回，动画与交互仍由主组件闭包驱动（mesh.userData 为数据通道）。
 */
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  DIM, HL_LINE, HL_PULSE, LAYER_OF, LINE_DATE, LINE_RADIAL, LINE_TYPE,
  ORBITS, SIZE_MAX, SIZE_MIN, SIZE_OF, TYPE_EMOJI,
  type PairInfo,
} from './consts'
import { filterNodes, TL_COLOR, type TimelineDay, type TimelineNode, type TimelineType } from '../timeline'

export interface NodeWorld {
  meshByNode: Map<TimelineNode, THREE.Mesh>
  allNodes: THREE.Mesh[]
  sprites: THREE.Sprite[]
  emojiTex: Map<TimelineType, THREE.Texture>
  disposals: Array<{ dispose: () => void }>
  /** 连线（合并几何，顶点着色） */
  merged: THREE.LineSegments
  mergedGeo: THREE.BufferGeometry
  /** 辐射线 */
  radial: THREE.LineSegments
  radialGeo: THREE.BufferGeometry
  radialMat: THREE.LineBasicMaterial
  radialNodes: THREE.Mesh[]
  /** 高亮宽线与脉冲 */
  hl: LineSegments2
  hlGeo: LineSegmentsGeometry
  hlMat: LineMaterial
  pulse: THREE.Mesh
  pulseMat: THREE.MeshBasicMaterial
  pairInfos: PairInfo[]
  pairColors: Record<'date' | 'type', THREE.Color>
  /** 每次渲染前重写连线/辐射位置（隔离态只画集合内线段；高亮宽线只在隔离态重建） */
  writeGeo: (isolatedPairs: Set<number> | null) => void
  /** 重绘连线颜色：related=null 全部语义色；否则相关亮色、其余 DIM */
  paintPairs: (related: Set<number> | null) => void
  /** 在连线（merged 几何）上拾取最近 pair，未命中返回 -1 */
  nearestPair: (p: THREE.Vector3) => number
  /** 释放节点/表情/连线/高亮/脉冲的全部 GPU 资源并移除场景对象 */
  dispose: () => void
}

interface RenderSize { width: number; height: number }

export function buildNodeWorld(scene: THREE.Scene, days: TimelineDay[], filter: TimelineType[], renderSize?: RenderSize): NodeWorld {
  // ── 节点球：大小由内容/类型/时间决定（限位 0.9–2.4）+ 类型表情贴球 ──
  const meshByNode = new Map<TimelineNode, THREE.Mesh>()
  const sphereGeo = new THREE.SphereGeometry(1, 22, 22)
  const disposals: Array<{ dispose: () => void }> = []
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

  // ── 连线：同日期前后/同类型前链（合并单对象，平面高亮线留隔离态用） ──
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
  // 限边：连线总量封顶，超出时优先裁掉"同类型"长链尾部（保留同日期与较早关系）
  const MAX_CONN = 240
  if (pairInfos.length > MAX_CONN) pairInfos = pairInfos.slice(0, MAX_CONN)
  const mergedGeo = new THREE.BufferGeometry()
  mergedGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pairInfos.length * 6), 3))
  mergedGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pairInfos.length * 6), 3))
  const merged = new THREE.LineSegments(mergedGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5 }))
  merged.renderOrder = 1
  scene.add(merged)

  // ── 辐射线：按节点规模采样绘制，避免"蜘蛛网"式视觉过载 ──
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
    resolution: new THREE.Vector2(renderSize?.width ?? 1, renderSize?.height ?? 1), // ResizeObserver 会继续同步
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

  // 初始即写入语义色（同日期=蓝、同类型=琥珀，与图例一致）；此前颜色缓冲全 0 → 连线渲染成纯黑
  const pairColors: Record<'date' | 'type', THREE.Color> = { date: new THREE.Color(LINE_DATE), type: new THREE.Color(LINE_TYPE) }

  const writeGeo = (isolatedPairs: Set<number> | null) => {
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

  const paintPairs = (related: Set<number> | null) => {
    const col = mergedGeo.attributes.color.array as Float32Array
    const hasRel = related !== null
    pairInfos.forEach((pi, i) => {
      const c = !hasRel ? pairColors[pi.kind] : related!.has(i) ? pairColors[pi.kind] : DIM
      const o = i * 6
      for (let v = 0; v < 6; v += 3) { col[o + v] = c.r; col[o + v + 1] = c.g; col[o + v + 2] = c.b }
    })
    mergedGeo.attributes.color.needsUpdate = true
  }
  paintPairs(null)

  const tmp = new THREE.Vector3()
  const nearestPair = (p: THREE.Vector3): number => {
    const ab = new THREE.Vector3()
    let best = -1
    let bd = 2.6 * 2.6 // 命中半径阈值（世界单位²）
    pairInfos.forEach((pi, i) => {
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

  const dispose = () => {
    meshByNode.forEach((m) => { scene.remove(m); m.geometry.dispose() })
    sprites.forEach((sp) => {
      scene.remove(sp)
      sp.material.dispose()
      sp.material.map?.dispose()
    })
    emojiTex.forEach((tx) => tx.dispose())
    disposals.forEach((d) => d.dispose())
    mergedGeo.dispose()
    ;(merged.material as THREE.Material).dispose()
    scene.remove(merged)
    radialGeo.dispose()
    radialMat.dispose()
    scene.remove(radial)
    hlGeo.dispose()
    hlMat.dispose()
    scene.remove(hl)
    pulse.geometry.dispose()
    pulseMat.dispose()
    scene.remove(pulse)
  }

  return {
    meshByNode, allNodes, sprites, emojiTex, disposals,
    merged, mergedGeo, radial, radialGeo, radialMat, radialNodes,
    hl, hlGeo, hlMat, pulse, pulseMat,
    pairInfos, pairColors, writeGeo, paintPairs, nearestPair, dispose,
  }
}