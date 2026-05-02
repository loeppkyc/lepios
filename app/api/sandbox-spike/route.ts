/**
 * Sandbox Slice 0 spike — Vercel runtime process.kill(-pgid) test.
 *
 * POST /api/sandbox-spike  (Bearer CRON_SECRET required)
 *
 * Spawns `bash -c "sleep 60"` detached inside a Vercel function, kills the
 * process group via process.kill(-pgid, 'SIGTERM'), verifies ESRCH within
 * 2 seconds, and returns the verdict + latency.
 *
 * This route exists ONLY for the Slice 0 spike. It is gated behind CRON_SECRET
 * (F22) and must be removed before Slice 1 opens. Guarded by the env flag
 * SANDBOX_SPIKE_ENABLED=1 as a second safety layer.
 *
 * Logs to agent_events with action='sandbox_spike.result'.
 */

import crypto from 'crypto'
import { spawn } from 'child_process'
import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

interface SpikePayload {
  result: 'works' | 'fails' | 'partial'
  error?: string
  pid: number | null
  pgid: number | null
  killLatencyMs: number
  processStillAlive: boolean
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function logToAgentEvents(payload: SpikePayload): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      id: crypto.randomUUID(),
      domain: 'sandbox_spike',
      action: 'sandbox_spike.result',
      actor: 'spike',
      status: payload.result === 'works' ? 'ok' : 'fail',
      payload,
    })
  } catch {
    // best-effort — never let logging break the spike response
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts (F22)
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  if (process.env.SANDBOX_SPIKE_ENABLED?.trim() !== '1') {
    return NextResponse.json(
      { error: 'Spike disabled. Set SANDBOX_SPIKE_ENABLED=1 to enable.' },
      { status: 410 }
    )
  }

  let pid = 0
  let pgid = 0

  try {
    const child = spawn('bash', ['-c', 'sleep 60'], {
      detached: true,
      stdio: 'pipe',
    })

    if (child.pid == null) {
      throw new Error('child.pid is undefined after spawn')
    }

    // On Unix detached spawn, pgid === pid (child is its own process group leader).
    pid = child.pid
    pgid = child.pid
  } catch (err: unknown) {
    const payload: SpikePayload = {
      result: 'fails',
      error: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      pid: 0,
      pgid: 0,
      killLatencyMs: 0,
      processStillAlive: false,
    }
    await logToAgentEvents(payload)
    return NextResponse.json({ runtime: 'vercel', ...payload })
  }

  await sleep(500)

  const killStart = Date.now()

  try {
    process.kill(-pgid, 'SIGTERM')
  } catch (err: unknown) {
    const killLatencyMs = Date.now() - killStart
    const payload: SpikePayload = {
      result: 'fails',
      error: `process.kill(-${pgid}, 'SIGTERM') threw: ${err instanceof Error ? err.message : String(err)}`,
      pid,
      pgid,
      killLatencyMs,
      processStillAlive: true,
    }
    await logToAgentEvents(payload)
    return NextResponse.json({ runtime: 'vercel', ...payload })
  }

  // Verify dead within 2 seconds via kill(-pgid, 0) returning ESRCH.
  const verifyDeadline = Date.now() + 2000
  let dead = false

  while (Date.now() < verifyDeadline) {
    await sleep(100)
    try {
      process.kill(-pgid, 0)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
        dead = true
        break
      }
    }
  }

  if (!dead) {
    // Escalate to SIGKILL to avoid leaving stray procs in the Vercel sandbox.
    try {
      process.kill(-pgid, 'SIGKILL')
    } catch {
      // ignore
    }
  }

  const killLatencyMs = Date.now() - killStart

  const payload: SpikePayload = dead
    ? { result: 'works', pid, pgid, killLatencyMs, processStillAlive: false }
    : {
        result: 'partial',
        error: 'process group still alive after SIGTERM + 2s; SIGKILL attempted',
        pid,
        pgid,
        killLatencyMs,
        processStillAlive: true,
      }

  await logToAgentEvents(payload)

  return NextResponse.json({ runtime: 'vercel', ...payload })
}
