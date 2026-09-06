/**
 * 服务器实时状态面板（节点宇宙左下角）：
 * 轮询 /workbench/server-status 展示 CPU / 内存 / 网络吞吐，感知"节点宇宙是否给服务器带来压力"。
 * - 3s 轮询 + 请求失败短暂退避；卸载即清理定时器
 * - 状态条按阈值着色（CPU>70% 红、>40% 橙）
 */
import { useEffect, useRef, useState } from 'react'
import { serverStatus, logClient, type ServerStatus } from '../../api'

const fmtMB = (b: number) => (b / 1024 / 1024).toFixed(0) + ' MB'

export function ServerStatusPanel() {
  const [st, setSt] = useState<ServerStatus | null>(null)
  const [dead, setDead] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let stop = false
    let timer = 0
    const tick = async (delay: number) => {
      if (stop) return
      try {
        const s = await serverStatus()
        if (stop) return
        setSt(s)
        setDead(false)
        timer = window.setTimeout(() => tick(3000), 3000)
      } catch (e) {
        if (stop) return
        setDead(true)
        logClient('warn', 'status-panel', '服务器状态获取失败', { err: e instanceof Error ? e.message : 'network' })
        timer = window.setTimeout(() => tick(8000), 8000) // 失败退避 8s
      }
    }
    tick(0)
    timerRef.current = timer
    return () => {
      stop = true
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  const cpuTone = (v: number) => (v > 70 ? 'hot' : v > 40 ? 'warn' : '')
  const memPct = st ? st.mem.percent : 0

  return (
    <div className={`stp-panel${dead ? ' dead' : ''}`} title="服务器实时状态 · 每 3 秒刷新">
      <div className="stp-title">🖥 服务器 · {dead ? '连接中断' : '实时'}</div>
      {!st ? (
        dead ? (
          <div className="stp-row dim-row">状态获取失败，8s 后重试</div>
        ) : (
          <div className="stp-row dim-row">读取中…</div>
        )
      ) : (
        <>
          <div className="stp-row">
            <span className="stp-k">CPU</span>
            <span className={`stp-v ${cpuTone(st.cpu)}`}>{st.cpu.toFixed(1)}%</span>
            <span className={`stp-bar ${cpuTone(st.cpu)}`}><i style={{ width: `${Math.min(100, st.cpu)}%` }} /></span>
          </div>
          <div className="stp-row">
            <span className="stp-k">内存</span>
            <span className="stp-v">{fmtMB(st.mem.used)}/{fmtMB(st.mem.total)}</span>
            <span className={`stp-bar ${cpuTone(memPct)}`}><i style={{ width: `${Math.min(100, memPct)}%` }} /></span>
          </div>
          <div className="stp-row">
            <span className="stp-k">网络</span>
            {st.net ? (
              <span className="stp-v">↓ {st.net.down} · ↑ {st.net.up} KB/s</span>
            ) : (
              <span className="stp-v dim-row">不可用</span>
            )}
            <span className="stp-blank" />
          </div>
        </>
      )}
    </div>
  )
}