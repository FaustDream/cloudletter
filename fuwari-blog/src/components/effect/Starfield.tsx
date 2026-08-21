/**
 * R3F/GLSL 星云背景（§7 展示层特效 · N7 · M2 effect-zone=display 专用）：
 * - fragment shader fbm 星云（深空底 #0a0e1a + 霓虹青/紫 + 朱砂点缀，随时间缓慢漂移）
 * - Points 星点层（additive 混合、逐星闪烁相位）
 * - 双门控（ADR-001）：仅 display 区挂载 + prefers-reduced-motion 时整体退场
 * - 性能（§12/R3）：DPR 限制 [1,1.5]、antialias 关、星点数 900、低功耗 GPU 偏好
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/* ========== 星云平面 shader ========== */

const NEBULA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const NEBULA_FRAG = /* glsl */ `
precision mediump float;
uniform float uTime;
uniform vec2 uResolution;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);
  float t = uTime * 0.02;

  // 域扭曲星云
  vec2 q = uv * 1.5 + vec2(t, -t * 0.7);
  float warp = fbm(q + t * 0.3);
  float n = fbm(q + warp * 0.8);

  vec3 cyan   = vec3(0.353, 0.820, 1.000); // 霓虹青 #5ad1ff
  vec3 purple = vec3(0.663, 0.545, 1.000); // 霓虹紫 #a98bff
  vec3 cinnabar = vec3(1.000, 0.420, 0.290); // 朱砂 #ff6b4a

  // 透明发光层：只保留光效颜色，底色全透明（不遮挡背景图片）
  vec3 col = vec3(0.0);
  col += cyan   * smoothstep(0.45, 0.90, n) * 0.30;
  col += purple * smoothstep(0.55, 1.00, fbm(q * 0.7 - t * 0.5)) * 0.24;
  col += cinnabar * smoothstep(0.75, 0.95, n) * 0.09;

  // 暗角聚焦：边缘更透明
  float vig = smoothstep(1.8, 0.4, length(uv));
  col *= mix(0.5, 1.0, vig);

  // 亮度即透明度
  float alpha = clamp(length(col) * 1.6, 0.0, 0.55) * vig;

  gl_FragColor = vec4(col, alpha);
}
`

function Nebula() {
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const { size } = useThree()

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    }),
    [],
  )

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
    uniforms.uResolution.value.set(size.width, size.height)
  })

  return (
    <mesh position={[0, 0, -5]}>
      <planeGeometry args={[Math.max(12 * (size.width / Math.max(size.height, 1)), 12), 12]} />
      <shaderMaterial
        ref={mat}
        vertexShader={NEBULA_VERT}
        fragmentShader={NEBULA_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  )
}

/* ========== 星点层 shader ========== */

const STARS_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = sin(uTime * 1.5 + aPhase) * 0.5 + 0.5;
  vAlpha = 0.3 + 0.7 * tw;
  gl_PointSize = aSize * (140.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`

const STARS_FRAG = /* glsl */ `
precision mediump float;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(c)) * vAlpha;
  gl_FragColor = vec4(0.85, 0.92, 1.0, a);
}
`

const STAR_COUNT = 900

function Stars() {
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(STAR_COUNT * 3)
    const size = new Float32Array(STAR_COUNT)
    const phase = new Float32Array(STAR_COUNT)
    for (let i = 0; i < STAR_COUNT; i++) {
      // 环绕相机的球壳分布
      const r = 3.5 + Math.random() * 4
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      pos[i * 3 + 2] = -Math.random() * 6
      size[i] = 0.6 + Math.random() * 1.8
      phase[i] = Math.random() * Math.PI * 2
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    return g
  }, [])

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <points geometry={geo} frustumCulled={false}>
      <shaderMaterial
        vertexShader={STARS_VERT}
        fragmentShader={STARS_FRAG}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

/* ========== 轨道导航（§7 / N7）：倾斜轨道环 + 沿轨卫星 + 鼠标视差 ========== */

const ORBITS = [
  { radius: 4.6, tiltX: 0.35, tiltZ: 0.12, color: '#5ad1ff', satSpeed: 0.4, satSize: 0.09 },
  { radius: 6.8, tiltX: -0.42, tiltZ: 0.28, color: '#a98bff', satSpeed: 0.26, satSize: 0.07 },
  { radius: 9.0, tiltX: 0.52, tiltZ: -0.2, color: '#ff6b4a', satSpeed: 0.16, satSize: 0.06 },
]

function Satellite({
  radius,
  speed,
  color,
  size,
}: {
  radius: number
  speed: number
  color: string
  size: number
}) {
  const ref = useRef<THREE.Mesh>(null!)
  useFrame((state) => {
    const a = state.clock.elapsedTime * speed
    ref.current.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0)
  })
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[size, 16, 16]} />
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

function OrbitRings() {
  const group = useRef<THREE.Group>(null!)

  useFrame((state) => {
    if (!group.current) return
    // 鼠标视差：整个轨道组随指针轻微旋转
    group.current.rotation.y = state.mouse.x * 0.14
    group.current.rotation.x = state.mouse.y * 0.14
  })

  return (
    <group ref={group}>
      {ORBITS.map((o, i) => (
        <group key={i} rotation={[o.tiltX, 0, o.tiltZ]}>
          <mesh>
            <torusGeometry args={[o.radius, 0.007, 8, 160]} />
            <meshBasicMaterial color={o.color} transparent opacity={0.22} />
          </mesh>
          <Satellite radius={o.radius} speed={o.satSpeed} color={o.color} size={o.satSize} />
        </group>
      ))}
    </group>
  )
}

/* ========== 相机穿行（§7 / N7）：相机沿椭圆轨道漂移 + 纵深往复，产生穿越星群感 ========== */

function CameraRig() {
  useFrame((state) => {
    const t = state.clock.elapsedTime
    // 相机在三维空间缓慢漂移：x/y 椭圆摆动 + z 纵深往复（穿越星群）
    state.camera.position.set(
      Math.cos(t * 0.04) * 0.5,
      Math.sin(t * 0.05) * 0.4,
      1 + Math.sin(t * 0.06) * 1.2,
    )
  })
  return null
}

/* ========== 入口：reduced-motion + 用户开关 双门控 ========== */

export default function Starfield() {
  const [reduced, setReduced] = useState(false)
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // 读取用户设置（背景特效单选：仅 nebula 渲染），监听实时切换
  useEffect(() => {
    const read = () => setEnabled(localStorage.getItem('bg-effect') === 'nebula')
    read()
    window.addEventListener('cloudletter:effect-change', read)
    return () => window.removeEventListener('cloudletter:effect-change', read)
  }, [])

  if (reduced || !enabled) return null

  return (
    <Canvas
      style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }}
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: false, powerPreference: 'low-power' }}
      camera={{ position: [0, 0, 1], fov: 60 }}
    >
      <CameraRig />
      <Nebula />
      <OrbitRings />
      <Stars />
    </Canvas>
  )
}
