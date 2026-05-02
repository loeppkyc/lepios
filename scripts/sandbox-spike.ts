/**
 * Sandbox Slice 0 spike — local process.kill(-pgid) test.
 * Run: npx tsx scripts/sandbox-spike.ts
 *
 * Spawns `bash -c "sleep 60"` detached, kills the process group via
 * process.kill(-pgid, 'SIGTERM'), then verifies ESRCH within 2 seconds.
 * Reports { localResult: 'works' | 'fails', ... } to stdout.
 *
 * On Windows (non-WSL) this will fail — negative-PID kill is a POSIX
 * feature. That's an expected result to record in the spike report.
 */

import { spawn } from 'child_process'

interface SpikeResult {
  localResult: 'works' | 'fails'
  error?: string
  pid: number | null
  pgid: number | null
  killLatencyMs: number | null
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function runSpike(): Promise<void> {
  console.log('=== Sandbox Spike: process.kill(-pgid) — local run ===\n')

  const platform = process.platform
  console.log(`Platform: ${platform}`)
  console.log(`Node: ${process.version}\n`)

  let child: ReturnType<typeof spawn>

  try {
    child = spawn('bash', ['-c', 'sleep 60'], {
      detached: true,
      stdio: 'pipe',
    })
  } catch (err: unknown) {
    const result: SpikeResult = {
      localResult: 'fails',
      error: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      pid: null,
      pgid: null,
      killLatencyMs: null,
    }
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = 1
    return
  }

  if (child.pid == null) {
    const result: SpikeResult = {
      localResult: 'fails',
      error: 'child.pid is undefined after spawn',
      pid: null,
      pgid: null,
      killLatencyMs: null,
    }
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = 1
    return
  }

  const pid = child.pid
  // On Unix detached spawn, the child becomes its own process group leader:
  // pgid === pid.
  const pgid = pid

  console.log(`Spawned: PID=${pid}, PGID=${pgid}`)
  console.log('Waiting 1 second before kill...\n')

  await sleep(1000)

  const killStart = Date.now()

  try {
    process.kill(-pgid, 'SIGTERM')
  } catch (err: unknown) {
    const killLatencyMs = Date.now() - killStart
    const result: SpikeResult = {
      localResult: 'fails',
      error: `process.kill(-${pgid}, 'SIGTERM') threw: ${err instanceof Error ? err.message : String(err)}`,
      pid,
      pgid,
      killLatencyMs,
    }
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = 1
    return
  }

  // Verify dead within 2 seconds via kill(-pgid, 0) returning ESRCH.
  const verifyDeadline = Date.now() + 2000
  let dead = false
  let verifyError: string | undefined

  while (Date.now() < verifyDeadline) {
    await sleep(100)
    try {
      process.kill(-pgid, 0)
      // Process group still alive — keep polling.
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ESRCH') {
        dead = true
        break
      }
      verifyError = `kill(-${pgid}, 0) threw unexpected: ${err instanceof Error ? err.message : String(err)}`
      break
    }
  }

  const killLatencyMs = Date.now() - killStart

  if (!dead) {
    // Best-effort SIGKILL to avoid leaving a stray sleep 60.
    try {
      process.kill(-pgid, 'SIGKILL')
    } catch {
      // ignore
    }
  }

  const result: SpikeResult = dead
    ? { localResult: 'works', pid, pgid, killLatencyMs }
    : {
        localResult: 'fails',
        error: verifyError ?? `process group still alive after 2s SIGTERM`,
        pid,
        pgid,
        killLatencyMs,
      }

  console.log(JSON.stringify(result, null, 2))

  if (!dead) {
    process.exitCode = 1
  }
}

runSpike().catch((err) => {
  console.error('Unhandled spike error:', err)
  process.exitCode = 1
})
