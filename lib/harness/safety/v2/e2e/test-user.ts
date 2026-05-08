/**
 * lib/harness/safety/v2/e2e/test-user.ts
 *
 * Test-user session resolver for the Safety Agent E2E runner.
 *
 * The runner needs to drive auth-gated cockpit pages. Three options were
 * considered (per leverage-targets.md notes for Phase 1a):
 *   (a) Supabase service-role-created test user with cached session cookie
 *   (b) Dev-mode auth bypass via harness_config flag
 *   (c) Magic-link-on-demand for the runner
 *
 * v1 implementation: read a long-lived session cookie from harness_config
 * (key: SAFETY_E2E_SESSION_COOKIE). The cookie is provisioned externally —
 * Colin runs `node scripts/safety/seed-e2e-cookie.mjs` once, which signs in
 * a test user and stores the cookie. Sub-phase D adds the seed script.
 *
 * This module returns the cookie string or null. Callers that get null
 * can still run unauthenticated E2E checks against public surfaces (e.g.
 * marketing routes, /api/health) — the runner adapts by skipping cookie
 * injection.
 *
 * Why not auto-provision per run: serverless cron contexts can't hold a
 * password reliably, and auto-creating a user every PR adds DB churn +
 * Auth API cost. A long-lived cookie is the lowest-friction path until
 * Sprint 6+ when we can revisit.
 *
 * Spec: docs/leverage-targets.md#safety-agent-0--done (sub-module #4)
 */

import { createServiceClient } from '@/lib/supabase/service'

// F18: lib/harness/safety/v2/e2e/test-user

type DBClient = ReturnType<typeof createServiceClient>

/**
 * Fetch the seeded test-user session cookie. Returns null when the harness_config
 * row is missing or empty — caller decides whether to run unauthenticated.
 *
 * Trims trailing whitespace defensively (F-N15-adjacent: Vercel CLI on Windows
 * has been known to inject \r\n into stored env values; same risk applies to
 * any externally-provisioned credential).
 */
export async function getTestUserSessionCookie(dbClient?: DBClient): Promise<string | null> {
  const db = dbClient ?? createServiceClient()
  const { data, error } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'SAFETY_E2E_SESSION_COOKIE')
    .maybeSingle()

  if (error || !data) return null
  const cookie = (data.value as string | null)?.trim()
  return cookie && cookie.length > 0 ? cookie : null
}
