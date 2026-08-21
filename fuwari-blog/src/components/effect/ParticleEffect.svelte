<script lang="ts">
  /**
   * 统一背景粒子特效（Canvas）：樱花 / 雪花 / 萤火虫，一次只渲染一种。
   * - 由设置面板单选控制（localStorage: bg-effect = sakura | snow | firefly）
   * - 监听 cloudletter:effect-change 实时切换
   * - reduced-motion 时自动退场
   * - 叠加在背景图片之上（z-index:1），不影响背景
   */
  import { onMount } from "svelte";

  const PALETTE: Record<string, string[]> = {
    sakura: [
      "rgba(255,183,197,0.9)",
      "rgba(255,159,178,0.9)",
      "rgba(255,200,210,0.9)",
      "rgba(250,180,195,0.9)",
    ],
    snow: ["rgba(255,255,255,0.95)", "rgba(240,248,255,0.9)", "rgba(230,240,250,0.85)"],
    firefly: ["rgba(255,236,120,0.95)", "rgba(180,255,150,0.9)", "rgba(255,200,80,0.9)"],
  };

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let raf = 0;
  let width = 0;
  let height = 0;
  let active = false;
  let current: string | null = null;
  let particles: Particle[] = [];

  type Particle = {
    kind: string;
    x: number;
    y: number;
    size: number;
    vx: number;
    vy: number;
    rot: number;
    vrot: number;
    sway: number;
    swaySpeed: number;
    phase: number;
    alpha: number;
    color: string;
    drag?: boolean;
    twinkleSpeed: number;
  };

  function isReduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function getEffect(): string | null {
    const e = localStorage.getItem("bg-effect");
    return e === "sakura" || e === "snow" || e === "firefly" ? e : null;
  }

  function makeParticle(kind: string, spawnX?: number, spawnY?: number): Particle {
    const palette = PALETTE[kind] || PALETTE.sakura;
    const fromTop = spawnX === undefined;
    const isFirefly = kind === "firefly";
    return {
      kind,
      x: spawnX ?? Math.random() * width,
      y: spawnY ?? -20 - Math.random() * height * 0.4,
      size: isFirefly
        ? 1.5 + Math.random() * 2
        : 6 + Math.random() * 8,
      vx: (Math.random() - 0.5) * 0.8,
      vy: isFirefly ? -(0.1 + Math.random() * 0.3) : 0.6 + Math.random() * 1.2,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.06,
      sway: isFirefly ? 3 + Math.random() * 4 : 1.5 + Math.random() * 2,
      swaySpeed: 0.01 + Math.random() * 0.02,
      phase: Math.random() * Math.PI * 2,
      alpha: isFirefly ? 0 : 0.5 + Math.random() * 0.5,
      color: palette[Math.floor(Math.random() * palette.length)],
      drag: !fromTop,
      twinkleSpeed: 0.02 + Math.random() * 0.04,
    };
  }

  function spawn(kind: string, amount: number) {
    for (let i = 0; i < amount; i++) particles.push(makeParticle(kind));
  }

  function drawPetal(p: Particle) {
    const rot = p.rot + Math.sin(p.phase) * 0.3;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(rot);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-p.size, -p.size * 0.7, -p.size * 0.9, p.size * 0.4, 0, p.size * 1.1);
    ctx.bezierCurveTo(p.size * 0.9, p.size * 0.4, p.size, -p.size * 0.7, 0, 0);
    ctx.fill();
    ctx.restore();
  }

  function drawSnow(p: Particle) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    // 雪花：十字六角近似
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * p.size, Math.sin(a) * p.size);
    }
    ctx.lineWidth = Math.max(p.size * 0.25, 1);
    ctx.strokeStyle = p.color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, p.size * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFirefly(p: Particle) {
    // 呼吸闪烁
    const glow = 0.35 + 0.65 * Math.abs(Math.sin(p.phase * 2));
    ctx.save();
    ctx.globalAlpha = p.alpha * glow;
    // 光晕
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
    grad.addColorStop(0, p.color.replace("rgba(", "rgba(").replace(/[\d.]+\)$/, "0.8)"));
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
    ctx.fill();
    // 亮点
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(p: Particle) {
    if (!ctx) return;
    if (p.kind === "sakura") drawPetal(p);
    else if (p.kind === "snow") drawSnow(p);
    else drawFirefly(p);
  }

  function tick() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    ctx.clearRect(0, 0, width * dpr, height * dpr);
    particles.forEach((p) => {
      p.phase += p.swaySpeed;
      p.x += p.vx + Math.sin(p.phase) * p.sway * 0.08;
      p.y += p.vy;
      p.rot += p.vrot;

      if (p.drag) {
        p.vy = Math.min(p.vy, 0.5);
      }

      // 萤火虫：在视口内游走，不消失；其余越界循环或消散
      if (p.kind === "firefly") {
        if (p.y < -20) p.y = height + 20;
        if (p.y > height + 20) p.y = -20;
        if (p.x < -20) p.x = width + 20;
        if (p.x > width + 20) p.x = -20;
        if (p.alpha < 1) p.alpha = Math.min(1, p.alpha + 0.01);
      } else {
        if (p.y > height + 30 || p.x < -40 || p.x > width + 40) {
          if (!p.drag && !isReduced()) {
            Object.assign(p, makeParticle(p.kind));
          } else {
            p.alpha -= 0.02;
          }
        }
      }
      if (p.alpha <= 0) return;
      draw(p);
    });
    particles = particles.filter((p) => p.alpha > 0);
    if (active) {
      raf = requestAnimationFrame(tick);
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function onPointerMove(e: PointerEvent) {
    if (!active || current !== "sakura") return;
    const now = performance.now();
    if (now - (onPointerMove as any)._last < 30) return;
    (onPointerMove as any)._last = now;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const p = makeParticle("sakura", e.clientX, e.clientY);
      p.vx = (Math.random() - 0.5) * 2.4;
      p.vy = Math.random() * 1.4 + 0.4;
      p.drag = true;
      particles.push(p);
    }
  }

  function start() {
    if (active) return;
    const effect = getEffect();
    if (!effect || isReduced()) return;
    active = true;
    current = effect;
    resize();
    particles = [];
    const count = effect === "firefly" ? 40 : 30;
    spawn(effect, count);
    tick();
  }

  function stop() {
    active = false;
    current = null;
    cancelAnimationFrame(raf);
    if (ctx) ctx.clearRect(0, 0, width, height);
  }

  onMount(() => {
    canvas = document.getElementById("particle-canvas") as HTMLCanvasElement;
    if (!canvas) return;

    const sync = () => {
      if (isReduced()) { stop(); return; }
      const effect = getEffect();
      if (!effect) { stop(); return; }
      if (effect !== current) {
        stop();
        start();
      }
    };

    window.addEventListener("cloudletter:effect-change", sync);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerdown", (e) => onPointerMove(e as PointerEvent));

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", sync);

    sync();

    return () => {
      window.removeEventListener("cloudletter:effect-change", sync);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      mq.removeEventListener("change", sync);
      stop();
    };
  });
</script>

<canvas id="particle-canvas" aria-hidden="true"></canvas>

<style>
  canvas {
    position: fixed;
    inset: 0;
    z-index: 1;
    pointer-events: none;
  }
</style>
