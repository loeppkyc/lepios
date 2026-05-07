// GET /api/self-repair/preflight
//
// One-stop wire-up sanity check for the night-watchman v2 scanner.
// Auth: Bearer $CRON_SECRET (same as the scanner route).
//
// Returns:
//   {
//     ok: boolean,
//     scanner_route_reachable: boolean,
//     dry_run_summary: { checks_registered, would_pass, would_skip, would_fail, per_check: [...] },
//     secrets_status: { ... per-key 'set' | 'null', resolved_telegram_source: 'vault' | 'env' | 'missing' },
//     vercel_cron_registered: boolean,
//     loop_guard_state: { halted, repairs_last_24h, escalations_last_24h },
//     ready_to_fire: boolean
//   }
//
// Implementation notes:
//   - Scanner is invoked in-process via runScan({dryRun:true}); no HTTP self-call.
//     This intentionally creates a night_watchman_runs row tagged notes='dry_run'
//     so preflight invocations are auditable.
//   - vercel.json is statically imported. The check reflects the deployed bundle,
//     which is what actually controls cron firing.

import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { runScan } from '@/lib/night_watchman'
import type { CheckResult } from '@/lib/night_watchman/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SCANNER_CRON_PATH = '/api/cron/night_watchman_scan'

const SECRET_KEYS = [
  'SENTRY_API_TOKEN',
  'SENTRY_ORG_SLUG',
  'SENTRY_PROJECT_SLUG',
  'VERCEL_TOKEN',
  'VERCEL_PROJECT_ID',
  'TELEGRAM_BOT_TOKEN_VAULT_REF',
] as const

type SecretKey = (typeof SECRET_KEYS)[number]
type SetState = 'set' | 'null'
type TgSource = 'vault' | 'env' | 'missing'

interface PerCheck {
  key: string
  status: CheckResult['status']
  reason_if_skipped: string | null
}

interface PreflightResponse {
  ok: boolean
  scanner_route_reachable: boolean
  dry_run_summary: {
    checks_registered: number
    would_pass: number
    would_skip: number
    would_fail: number
    per_check: PerCheck[]
  }
  secrets_status: Record<SecretKey, SetState> & {
    resolved_telegram_source: TgSource
  }
  vercel_cron_registered: boolean
  loop_guard_state: {
    halted: boolean
    repairs_last_24h: number
    escalations_last_24h: number
  }
  ready_to_fire: boolean
  errors: string[]
}

async function readSecretsStatus(
  db: ReturnType<typeof createServiceClient>
): Promise<Record<SecretKey, SetState>> {
  const out = Object.fromEntries(SECRET_KEYS.map((k) => [k, 'null' as SetState])) as Record<
    SecretKey,
    SetState
  >
  const { data } = await db
    .from('harness_config')
    .select('key, value')
    .in('key', SECRET_KEYS as unknown as string[])
  for (const row of (data ?? []) as Array<{ key: SecretKey; value: string }>) {
    out[row.key] = row.value && row.value.length > 0 ? 'set' : 'null'
  }
  return out
}

async function resolveTelegramSource(
  db: ReturnType<typeof createServiceClient>
): Promise<TgSource> {
  // Match the daily-bot client's resolution order: Vault first, env fallback.
  try {
    const { data } = await db
      .schema('vault' as never)
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', 'telegram_bot_token_daily')
      .maybeSingle<{ decrypted_secret: string }>()
    if (data?.decrypted_secret && data.decrypted_secret.length > 0) return 'vault'
  } catch {
    // fall through
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.length > 0) return 'env'
  return 'missing'
}

function readCronRegistration(): { registered: boolean; error?: string } {
  // Read vercel.json from disk at request time. On Vercel runtime, the file is
  // included in the function bundle at the project root.
  try {
    const path = join(process.cwd(), 'vercel.json')
    const raw = readFileSync(path, 'utf8')
    const config = JSON.parse(raw) as { crons?: Array<{ path: string; schedule: string }> }
    const crons = config.crons ?? []
    const registered = crons.some((c) => c.path === SCANNER_CRON_PATH)
    return { registered }
  } catch (err) {
    return {
      registered: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function readLoopGuardState(
  db: ReturnType<typeof createServiceClient>
): Promise<{ halted: boolean; repairs_last_24h: number; escalations_last_24h: number }> {
  const { data: cfg } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'SELF_REPAIR_HALTED')
    .maybeSingle<{ value: string }>()
  const halted = (cfg?.value ?? 'false').toLowerCase() === 'true'

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: repairRows } = await db
    .from('night_watchman_check_results')
    .select('repair_outcome')
    .eq('repair_attempted', true)
    .gte('occurred_at', since)
  const rows = (repairRows ?? []) as Array<{ repair_outcome: string | null }>
  const repairs_last_24h = rows.length
  const escalations_last_24h = rows.filter((r) => r.repair_outcome === 'escalated').length

  return { halted, repairs_last_24h, escalations_last_24h }
}

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const errors: string[] = []
  const db = createServiceClient()

  // ─── Scanner reachability + dry-run summary ─────────────────────────────────
  let scannerReachable = false
  const perCheck: PerCheck[] = []
  let wouldPass = 0
  let wouldSkip = 0
  let wouldFail = 0
  let checksRegistered = 0
  try {
    const report = await runScan({ scope: 'manual', triggerSource: 'manual', dryRun: true })
    scannerReachable = true
    checksRegistered = report.results.length
    for (const r of report.results) {
      if (r.status === 'ok') wouldPass += 1
      else if (r.status === 'skipped') wouldSkip += 1
      else if (r.status === 'fail') wouldFail += 1
      else if (r.status === 'warn') wouldFail += 1
      perCheck.push({
        key: r.key,
        status: r.status,
        reason_if_skipped:
          r.status === 'skipped'
            ? typeof r.evidence.reason === 'string'
              ? (r.evidence.reason as string)
              : 'no reason supplied'
            : null,
      })
    }
  } catch (err) {
    errors.push(`runScan failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  // ─── Secrets + telegram resolution ──────────────────────────────────────────
  let secretsStatus: Record<SecretKey, SetState>
  try {
    secretsStatus = await readSecretsStatus(db)
  } catch (err) {
    errors.push(`readSecretsStatus failed: ${err instanceof Error ? err.message : String(err)}`)
    secretsStatus = Object.fromEntries(SECRET_KEYS.map((k) => [k, 'null' as SetState])) as Record<
      SecretKey,
      SetState
    >
  }
  const resolvedTelegramSource = await resolveTelegramSource(db).catch(() => 'missing' as TgSource)

  // ─── Vercel cron registration ───────────────────────────────────────────────
  const cronCheck = readCronRegistration()
  if (cronCheck.error) errors.push(`vercel.json read failed: ${cronCheck.error}`)

  // ─── Loop guard state ───────────────────────────────────────────────────────
  let guardState: Awaited<ReturnType<typeof readLoopGuardState>>
  try {
    guardState = await readLoopGuardState(db)
  } catch (err) {
    errors.push(`readLoopGuardState failed: ${err instanceof Error ? err.message : String(err)}`)
    guardState = { halted: false, repairs_last_24h: 0, escalations_last_24h: 0 }
  }

  const minSecretSet = resolvedTelegramSource !== 'missing'
  const readyToFire = scannerReachable && cronCheck.registered && !guardState.halted && minSecretSet

  const response: PreflightResponse = {
    ok: errors.length === 0,
    scanner_route_reachable: scannerReachable,
    dry_run_summary: {
      checks_registered: checksRegistered,
      would_pass: wouldPass,
      would_skip: wouldSkip,
      would_fail: wouldFail,
      per_check: perCheck,
    },
    secrets_status: {
      ...secretsStatus,
      resolved_telegram_source: resolvedTelegramSource,
    },
    vercel_cron_registered: cronCheck.registered,
    loop_guard_state: guardState,
    ready_to_fire: readyToFire,
    errors,
  }

  return NextResponse.json(response)
}

export async function POST(request: Request) {
  return GET(request)
}
