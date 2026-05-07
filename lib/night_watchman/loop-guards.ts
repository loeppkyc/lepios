// Loop guards — the layer that decides whether a repair may run.
//
// Three caps + one killswitch:
//
//   SELF_REPAIR_HALTED          → global stop
//   NW_REPAIR_PER_SCAN_CAP      → max repairs in this scan
//   NW_REPAIR_PER_CHECK_24H_CAP → max repairs for one check_key in rolling 24h
//   NW_REPAIR_GLOBAL_24H_CAP    → max repairs across all keys in rolling 24h
//
// All four cap values come from harness_config and are read once per scan.

import { createServiceClient } from '@/lib/supabase/service'

type Db = ReturnType<typeof createServiceClient>

export interface GuardConfig {
  haltedFlag: boolean
  perScanCap: number
  perCheck24hCap: number
  global24hCap: number
}

/** Read all four config values in one query. Falls back to safe defaults. */
export async function readGuardConfig(db: Db): Promise<GuardConfig> {
  const { data } = await db
    .from('harness_config')
    .select('key, value')
    .in('key', [
      'SELF_REPAIR_HALTED',
      'NW_REPAIR_PER_SCAN_CAP',
      'NW_REPAIR_PER_CHECK_24H_CAP',
      'NW_REPAIR_GLOBAL_24H_CAP',
    ])

  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string]))

  return {
    haltedFlag: (map.get('SELF_REPAIR_HALTED') ?? 'false').toLowerCase() === 'true',
    perScanCap: parseIntSafe(map.get('NW_REPAIR_PER_SCAN_CAP'), 10),
    perCheck24hCap: parseIntSafe(map.get('NW_REPAIR_PER_CHECK_24H_CAP'), 3),
    global24hCap: parseIntSafe(map.get('NW_REPAIR_GLOBAL_24H_CAP'), 30),
  }
}

function parseIntSafe(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export interface GuardState {
  /** Repairs already performed in the current scan. */
  perScanCount: number
  /** Per-check_key counts in rolling 24h, populated lazily. */
  perCheck24hCounts: Map<string, number>
  /** Global rolling-24h count. */
  global24hCount: number
}

export function createGuardState(): GuardState {
  return {
    perScanCount: 0,
    perCheck24hCounts: new Map(),
    global24hCount: 0,
  }
}

/**
 * Read existing 24h repair counts from the DB so per-check / global caps
 * persist across scans within the same 24h window.
 */
export async function loadRollingCounts(db: Db, state: GuardState): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await db
    .from('night_watchman_check_results')
    .select('check_key, repair_outcome')
    .eq('repair_attempted', true)
    .gte('occurred_at', since)

  const rows = (data ?? []) as Array<{ check_key: string; repair_outcome: string | null }>
  for (const r of rows) {
    // Count any non-NA outcome — we want to cap retries even on failures.
    if (r.repair_outcome === 'not_applicable') continue
    state.global24hCount += 1
    state.perCheck24hCounts.set(r.check_key, (state.perCheck24hCounts.get(r.check_key) ?? 0) + 1)
  }
}

export type GuardDecision = { allow: true } | { allow: false; reason: string; halt: boolean }

export function checkGuards(
  config: GuardConfig,
  state: GuardState,
  checkKey: string
): GuardDecision {
  if (config.haltedFlag) {
    return { allow: false, reason: 'SELF_REPAIR_HALTED=true (killswitch)', halt: true }
  }
  if (state.perScanCount >= config.perScanCap) {
    return {
      allow: false,
      reason: `per-scan cap reached (${config.perScanCap}). Halting rest of scan.`,
      halt: true,
    }
  }
  if (state.global24hCount >= config.global24hCap) {
    return {
      allow: false,
      reason: `global 24h cap reached (${config.global24hCap}). Halting + alerting.`,
      halt: true,
    }
  }
  const perCheck = state.perCheck24hCounts.get(checkKey) ?? 0
  if (perCheck >= config.perCheck24hCap) {
    return {
      allow: false,
      reason: `per-check 24h cap reached for "${checkKey}" (${config.perCheck24hCap}). Escalating.`,
      halt: false,
    }
  }
  return { allow: true }
}

/** Mutate state to record a repair was attempted (regardless of outcome). */
export function recordRepairAttempt(state: GuardState, checkKey: string): void {
  state.perScanCount += 1
  state.global24hCount += 1
  state.perCheck24hCounts.set(checkKey, (state.perCheck24hCounts.get(checkKey) ?? 0) + 1)
}

/** Set SELF_REPAIR_HALTED in harness_config. Used by /api/self-repair/halt. */
export async function setHalted(db: Db, halted: boolean): Promise<void> {
  const { error } = await db
    .from('harness_config')
    .update({ value: halted ? 'true' : 'false' })
    .eq('key', 'SELF_REPAIR_HALTED')
  if (error) {
    throw new Error(`night_watchman: setHalted failed — ${error.message}`)
  }
}
