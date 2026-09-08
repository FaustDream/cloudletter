/**
 * 服务器实时状态采样（节点宇宙左下角 CPU/内存/网络监控）。
 * 含跨请求长窗口与进程内 120ms 双采样兜底，TTL 缓存避免多前端轮询重复采样。
 */
import os from 'node:os'
import fs from 'node:fs'

interface NetSample { rx: number; tx: number }
interface StatusSnapshot {
  cpu: number
  mem: { used: number; total: number; percent: number }
  net: { up: number; down: number } | null
}

/** CPU 采样：tick 计数差值 / 总差值（两次采样间隔 sleep 保证分辨率） */
function sysCpuSample(): { idle: number; total: number } {
  let idle = 0, total = 0
  for (const c of os.cpus()) {
    idle += c.times.idle
    for (const t of Object.values(c.times)) total += t
  }
  return { idle, total }
}

/** 网络字节计数（Linux /proc/net/dev；非 Linux 返回 null） */
function sysNetBytes(): NetSample | null {
  try {
    const raw = fs.readFileSync('/proc/net/dev', 'utf-8')
    let rx = 0, tx = 0
    for (const line of raw.split('\n').slice(2)) {
      // 每行格式: iface: rx_bytes rx_packets×7 tx_bytes ...（rx 第1个数字，tx 第9个数字，中间恰好 7 列）
      const m = line.match(/:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/)
      if (!m) continue
      rx += Number(m[1]); tx += Number(m[2])
    }
    return { rx, tx }
  } catch {
    return null
  }
}

/** CPU 占用率：两采样点 tick 差值折算（%），总差值为 0 时按 0 处理 */
function cpuPctOf(prev: { idle: number; total: number }, cur: { idle: number; total: number }): number {
  const dTotal = cur.total - prev.total
  const dIdle = cur.idle - prev.idle
  return dTotal > 0 ? Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100)) : 0
}

/** 状态采样缓存：TTL 1.1s，避免多前端轮询时重复做耗时采样 */
let statusCache: { data: StatusSnapshot; t: number } | null = null
/** 上次采样基线：跨请求差值窗口（≈前端轮询间隔）比进程内 120ms 窗口读数更稳 */
let lastSample: { cpu: { idle: number; total: number }; net: NetSample | null; t: number } | null = null

/** 组装快照（内存口径全程一致） */
function mkSnapshot(cpu: number, net: { up: number; down: number } | null): StatusSnapshot {
  const total = os.totalmem()
  const used = total - os.freemem()
  return { cpu, mem: { used, total, percent: Math.round((used / total) * 100) }, net }
}

async function sampleSnapshot(): Promise<StatusSnapshot> {
  const now = Date.now()
  if (statusCache && now - statusCache.t < 1100) return statusCache.data

  const cpu = sysCpuSample()
  const net = sysNetBytes()
  // 距上次请求 1~30s：直接用跨请求累计差值（长窗口），CPU 与网络都无需二次采样
  const ls = lastSample
  if (ls && net && ls.net && now - ls.t >= 1000 && now - ls.t <= 30_000 && net.rx >= ls.net.rx && net.tx >= ls.net.tx) {
    const dt = (now - ls.t) / 1000
    const data = mkSnapshot(cpuPctOf(ls.cpu, cpu), { up: (net.tx - ls.net.tx) / dt / 1024, down: (net.rx - ls.net.rx) / dt / 1024 }) // KB/s
    statusCache = { data, t: now }
    lastSample = { cpu, net, t: now }
    return data
  }
  // 兜底：首采或计数器回绕时，进程内 120ms 双采样
  await new Promise((r) => setTimeout(r, 120))
  const cpu2 = sysCpuSample()
  const net2 = sysNetBytes()
  let netRate: { up: number; down: number } | null = null
  if (net && net2 && net2.rx >= net.rx && net2.tx >= net.tx) {
    netRate = { up: (net2.tx - net.tx) / 0.12 / 1024, down: (net2.rx - net.rx) / 0.12 / 1024 } // KB/s
  }
  const data = mkSnapshot(cpuPctOf(cpu, cpu2), netRate)
  statusCache = { data, t: Date.now() }
  lastSample = { cpu: cpu2, net: net2, t: Date.now() }
  return data
}

// 定时清理状态缓存（避免常驻，但上限就一个条目，仅防极端场景）
setInterval(() => { statusCache = null }, 60_000).unref?.()

/** 服务器实时状态快照（workbench /server-status） */
export async function serverStatus(): Promise<{
  cpu: number
  mem: { used: number; total: number; percent: number }
  net: { up: number; down: number } | null
  ts: number
}> {
  const snap = await sampleSnapshot()
  return {
    cpu: Math.round(snap.cpu * 10) / 10,
    mem: { used: snap.mem.used, total: snap.mem.total, percent: snap.mem.percent },
    net: snap.net ? { up: Math.round(snap.net.up), down: Math.round(snap.net.down) } : null,
    ts: Date.now(),
  }
}