/**
 * 异步构建服务（§6.3 / §14）：
 * - POST 触发 → {buildId, status:'queued'}，任务在 PROJECT_DIR 执行 BUILD_CMD
 * - 状态轮询 GET /api/v2/build/:id → {status:'queued|running|success|failed', log}
 * - 构建失败保留上一版产物（Astro 先写 dist，失败时不会覆盖已发布目录；§14）
 * - 串行队列：同一时间只跑一个构建
 */
import { exec } from 'node:child_process'
import { audit } from './audit'
import { projectDir } from './sync'

export interface BuildJob {
  id: string
  status: 'queued' | 'running' | 'success' | 'failed'
  log: string
  startedAt?: string
  finishedAt?: string
}

const jobs = new Map<string, BuildJob>()
// 🟡S2 修复：Map 上限（LRU 淘汰），避免内存无限增长
const MAX_JOBS = 100
let jobSeq = 0
let running = false
const queue: string[] = []

function makeId(): string {
  jobSeq++
  return `b${Date.now().toString(36)}-${jobSeq}`
}

/** 淘汰最旧的 job（Map 按插入序迭代，删除最先插入的即可） */
function evictOldest(): void {
  while (jobs.size >= MAX_JOBS) {
    const oldest = jobs.keys().next()
    if (oldest.done) break
    jobs.delete(oldest.value)
    jobOwners.delete(oldest.value)
    const qi = queue.indexOf(oldest.value)
    if (qi >= 0) queue.splice(qi, 1)
  }
}

export function triggerBuild(userId: string | null, reason: string): BuildJob {
  evictOldest()
  const id = makeId()
  const job: BuildJob = { id, status: 'queued', log: `reason: ${reason}\n` }
  jobs.set(id, job)
  jobOwners.set(id, userId)
  queue.push(id)
  processQueue()
  return job
}

const jobOwners = new Map<string, string | null>()

export function getBuild(id: string): BuildJob | null {
  return jobs.get(id) ?? null
}

function processQueue(): void {
  if (running || queue.length === 0) return
  const id = queue.shift()!
  const job = jobs.get(id)
  if (!job) return processQueue()
  running = true
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  runOnce(id, job)
}

// 💭N3 魔法数字提取：Windows 瞬时失败退出码（0xC0000142 / 0xC000013A），自动重试一次
const WINDOWS_TRANSIENT_EXIT_CODES = [3221225794, 3221225786] as const

/** Windows 下偶发 0xC0000142（DLL 初始化失败）等瞬时进程生成错误：自动重试一次 */
function runOnce(id: string, job: BuildJob, attempt = 0): void {
  const dir = projectDir()
  const cmd = process.env.BUILD_CMD || 'pnpm build'
  const child = exec(cmd, {
    cwd: dir,
    timeout: 10 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
  child.stdin?.end()

  if (child.stdout) child.stdout.on('data', (d) => (job.log += d.toString()))
  if (child.stderr) child.stderr.on('data', (d) => (job.log += d.toString()))
  child.on('error', (err) => {
    job.log += `\n[spawn error] ${err.message}`
  })

  child.on('close', (code) => {
    const transient = code !== null && (WINDOWS_TRANSIENT_EXIT_CODES as readonly number[]).includes(code) && attempt === 0
    if (transient) {
      job.log += `\n[exit ${code}] 瞬时失败，自动重试…`
      runOnce(id, job, attempt + 1)
      return
    }
    job.status = code === 0 ? 'success' : 'failed'
    job.finishedAt = new Date().toISOString()
    job.log += `\n[exit ${code}]`
    running = false
    void audit(jobOwners.get(id) ?? null, 'build', { buildId: id, status: job.status, exitCode: code })
    processQueue()
  })
}
