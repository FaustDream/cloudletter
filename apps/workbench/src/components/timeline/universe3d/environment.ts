/**
 * 节点宇宙 · 环境构建（星空 / 中心太阳 / 轨道环 / 流星）：纯构建 + 自持 update/dispose。
 * 从 TimelineUniverse3d 的挂载闭包拆出，主组件只做组合与交互。
 */
import * as THREE from 'three'
import { SUN_COLOR, SUN_GLOW, ORBITS } from './consts'

export interface UniverseEnvironment {
  stars: THREE.Points
  sun: THREE.Mesh
  glow: THREE.Mesh
  halo: THREE.Mesh
  /** 每帧环境动画（太阳/辉光脉动/流星推进；reduced 模式不创建流星，update 仍可安全调用） */
  update: (t: number, dt: number) => void
  dispose: () => void
}

export function createEnvironment(scene: THREE.Scene, reduced: boolean): UniverseEnvironment {
  // ── 星空 ──
  const sg = new THREE.BufferGeometry()
  const sn = 1400
  const spos = new Float32Array(sn * 3)
  for (let i = 0; i < sn; i++) {
    const r = 170 + Math.random() * 420
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    spos[i * 3] = r * Math.sin(ph) * Math.cos(th)
    spos[i * 3 + 1] = r * Math.cos(ph)
    spos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th)
  }
  sg.setAttribute('position', new THREE.BufferAttribute(spos, 3))
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.4 }))
  scene.add(stars)

  // ── 中心太阳（去人物 + 发光暖晕） ──
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

  // ── 轨道环（三层） ──
  const ringMat = new THREE.LineDashedMaterial({ color: 0x9cc3ec, dashSize: 1.1, gapSize: 0.8, transparent: true, opacity: 0.5 })
  const rings: THREE.LineLoop[] = []
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
    rings.push(ln)
  })

  // ── 流星粒子：随机陨石拖尾划过（转动时的生命感；加色混合下颜色越黑越隐形） ──
  const METEOR_N = 7
  const meteorGeo = new THREE.BufferGeometry()
  const mPos = new Float32Array(METEOR_N * 6)
  const mCol = new Float32Array(METEOR_N * 6)
  meteorGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3))
  meteorGeo.setAttribute('color', new THREE.BufferAttribute(mCol, 3))
  const meteorMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
  const meteors = new THREE.LineSegments(meteorGeo, meteorMat)
  meteors.frustumCulled = false
  meteors.renderOrder = 2
  const METEOR_HUES = [new THREE.Color(0xbfd9ff), new THREE.Color(0xffe2b0), new THREE.Color(0xcdefff)]
  interface Meteor { p: THREE.Vector3; v: THREE.Vector3; life: number; max: number; hue: THREE.Color }
  const meteorSeeds: Meteor[] = []
  const respawnMeteor = (m: Meteor, initial: boolean) => {
    const r = 90 + Math.random() * 190
    const th = Math.random() * Math.PI * 2
    const ph = Math.acos(2 * Math.random() - 1)
    m.p.set(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th))
    m.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(34 + Math.random() * 46)
    m.max = 1.6 + Math.random() * 2.2
    m.life = initial ? Math.random() * m.max : m.max
    m.hue = METEOR_HUES[Math.floor(Math.random() * METEOR_HUES.length)]
  }
  for (let i = 0; i < METEOR_N; i++) {
    const m = { p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, hue: METEOR_HUES[0] }
    respawnMeteor(m, true)
    meteorSeeds.push(m)
  }
  if (!reduced) scene.add(meteors)
  const mTail = new THREE.Vector3()

  const update = (t: number, dt: number) => {
    sun.rotation.y += 0.01
    sun.scale.setScalar(1 + Math.sin(t * 1.5) * 0.045)
    glow.scale.setScalar(1 + Math.sin(t * 1.1) * 0.06)
    if (reduced) return
    meteorSeeds.forEach((m, i) => {
      m.life -= dt
      if (m.life <= 0) respawnMeteor(m, false)
      m.p.addScaledVector(m.v, dt)
      const k = Math.min(1, Math.max(0, 1 - m.life / m.max))
      const b = Math.sin(k * Math.PI) * 0.9
      mTail.copy(m.p).addScaledVector(m.v, -0.09)
      const o = i * 6
      mPos[o] = m.p.x; mPos[o + 1] = m.p.y; mPos[o + 2] = m.p.z
      mPos[o + 3] = mTail.x; mPos[o + 4] = mTail.y; mPos[o + 5] = mTail.z
      mCol[o] = m.hue.r * b; mCol[o + 1] = m.hue.g * b; mCol[o + 2] = m.hue.b * b
      mCol[o + 3] = 0; mCol[o + 4] = 0; mCol[o + 5] = 0
    })
    meteorGeo.attributes.position.needsUpdate = true
    meteorGeo.attributes.color.needsUpdate = true
  }

  const dispose = () => {
    sg.dispose()
    ;(stars.material as THREE.Material).dispose()
    scene.remove(stars)
    meteorGeo.dispose()
    meteorMat.dispose()
    scene.remove(meteors)
    for (const ln of rings) {
      ln.geometry.dispose()
      scene.remove(ln)
    }
    ringMat.dispose()
    scene.remove(sun, glow, halo)
    sun.geometry.dispose()
    ;(sun.material as THREE.Material).dispose()
    glow.geometry.dispose()
    ;(glow.material as THREE.Material).dispose()
    halo.geometry.dispose()
    ;(halo.material as THREE.Material).dispose()
  }

  return { stars, sun, glow, halo, update, dispose }
}