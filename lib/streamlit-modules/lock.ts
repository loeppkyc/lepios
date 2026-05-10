/**
 * lib/streamlit-modules/lock.ts
 *
 * Lock helpers for the streamlit_modules port catalog.
 *
 * A "lock" is either:
 *   manual_owner    — a human is actively working on this module (set by name or email)
 *   in_progress_branch — an open feature branch has claimed this module
 *
 * locked_at records when the lock was applied. Any lock older than LOCK_TTL_DAYS
 * is considered stale and auto-cleared by unlockStale().
 *
 * Coordinator eligibility: pickNextModule() implements the canonical query.
 * Continuous mode calls this before inserting a port task.
 */

import { createServiceClient } from '@/lib/supabase/service'

const LOCK_TTL_DAYS = 7

export interface LockedModule {
  id: string
  path: string
  port_status: string
  manual_owner: string | null
  in_progress_branch: string | null
  locked_at: string | null
}

export interface EligibleModule {
  id: string
  path: string
  suggested_tier: number | null
  classification: string
  port_status: string
}

// ── Lock ─────────────────────────────────────────────────────────────────────

/**
 * Lock a module by path.
 * owner_or_branch starting with 'feat/' or 'harness/' → in_progress_branch.
 * Everything else → manual_owner.
 * Idempotent: calling again updates locked_at.
 */
export async function lockModule(path: string, ownerOrBranch: string): Promise<void> {
  const db = createServiceClient()
  const isBranch = /^(feat|harness|fix|chore|refactor|security)\//.test(ownerOrBranch)
  const { error } = await db
    .from('streamlit_modules')
    .update({
      manual_owner: isBranch ? null : ownerOrBranch,
      in_progress_branch: isBranch ? ownerOrBranch : null,
      locked_at: new Date().toISOString(),
    })
    .eq('path', path)
  if (error) throw new Error(`lockModule(${path}): ${error.message}`)
}

// ── Unlock ────────────────────────────────────────────────────────────────────

/** Clear all lock fields on a module by path. */
export async function unlockModule(path: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('streamlit_modules')
    .update({ manual_owner: null, in_progress_branch: null, locked_at: null })
    .eq('path', path)
  if (error) throw new Error(`unlockModule(${path}): ${error.message}`)
}

/** Clear locks older than LOCK_TTL_DAYS. Returns count of cleared rows. */
export async function unlockStale(): Promise<number> {
  const db = createServiceClient()
  const cutoff = new Date(Date.now() - LOCK_TTL_DAYS * 86_400_000).toISOString()
  const { data, error } = await db
    .from('streamlit_modules')
    .update({ manual_owner: null, in_progress_branch: null, locked_at: null })
    .lt('locked_at', cutoff)
    .not('locked_at', 'is', null)
    .select('id')
  if (error) throw new Error(`unlockStale: ${error.message}`)
  return (data ?? []).length
}

// ── List ──────────────────────────────────────────────────────────────────────

/** Return all currently locked rows (manual_owner OR in_progress_branch set). */
export async function listLocked(): Promise<LockedModule[]> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('streamlit_modules')
    .select('id, path, port_status, manual_owner, in_progress_branch, locked_at')
    .or('manual_owner.not.is.null,in_progress_branch.not.is.null')
    .order('locked_at', { ascending: false })
  if (error) throw new Error(`listLocked: ${error.message}`)
  return (data ?? []) as LockedModule[]
}

// ── Eligibility query (coordinator continuous mode) ───────────────────────────

/**
 * Pick the top pending, unlocked module for the coordinator to port next.
 * Ordered by suggested_tier DESC (higher tier = more leverage), then path ASC
 * for determinism. Hits the partial index idx_streamlit_modules_unlocked.
 *
 * Returns null when no eligible module exists.
 */
export async function pickNextModule(): Promise<EligibleModule | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('streamlit_modules')
    .select('id, path, suggested_tier, classification, port_status')
    .eq('port_status', 'pending')
    .is('manual_owner', null)
    .is('in_progress_branch', null)
    .order('suggested_tier', { ascending: false, nullsFirst: false })
    .order('path', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`pickNextModule: ${error.message}`)
  return data as EligibleModule | null
}

// ── F18 stats ─────────────────────────────────────────────────────────────────

export interface ModuleLockStats {
  locked: number
  unlocked_pending: number
  done: number
  total: number
}

/**
 * Aggregate counts for the morning digest.
 * Never throws — returns zeros on error.
 */
export async function getModuleLockStats(): Promise<ModuleLockStats> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('streamlit_modules')
      .select('port_status, manual_owner, in_progress_branch')
    if (error || !data) return { locked: 0, unlocked_pending: 0, done: 0, total: 0 }

    let locked = 0
    let unlocked_pending = 0
    let done = 0

    for (const row of data as {
      port_status: string
      manual_owner: string | null
      in_progress_branch: string | null
    }[]) {
      const isLocked = row.manual_owner !== null || row.in_progress_branch !== null
      if (isLocked) {
        locked++
      } else if (row.port_status === 'pending') {
        unlocked_pending++
      } else if (row.port_status === 'complete') {
        done++
      }
    }

    return { locked, unlocked_pending, done, total: data.length }
  } catch {
    return { locked: 0, unlocked_pending: 0, done: 0, total: 0 }
  }
}

/**
 * One-line Telegram digest for streamlit_modules lock status.
 * Format: "📦 Port catalog: N locked · M pending · K done (total T)"
 */
export async function buildModuleLockDigestLine(): Promise<string> {
  const stats = await getModuleLockStats()
  if (stats.total === 0) return 'Port catalog: no modules cataloged'
  return `📦 Port catalog: ${stats.locked} locked · ${stats.unlocked_pending} pending · ${stats.done} done (${stats.total} total)`
}
