/**
 * Belt-and-suspenders: every route.ts under app/api/** must use one of the
 * approved auth gates, or be on the explicit exempt allowlist below.
 *
 * Adding a new API route without an auth gate fails CI. To opt out, add the
 * relative path to EXEMPT_ROUTES with a one-line justification.
 *
 * Approved gates:
 *   - requireUser(...)          (lib/auth/require-user.ts)
 *   - requireCronSecret(request) (lib/auth/cron-secret.ts)
 *   - verifyWebhookSecret(...)   (telegram webhook only)
 *   - createServiceClient        (server-to-server with own check, e.g. signed webhooks)
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const APP_API = join(process.cwd(), 'app', 'api')

// Routes that are intentionally unauthenticated. Every entry needs a reason.
const EXEMPT_ROUTES: ReadonlyArray<{ path: string; reason: string }> = [
  { path: 'health/route.ts', reason: 'Public liveness endpoint for monitoring' },
]

// Strong gates — single regex match is sufficient. Domain-specific wrappers
// (requireDietUser, requireHealthUser) delegate to requireUser internally;
// they're recognized here so their consumers don't need to inline auth.getUser()
// just to satisfy this test. If a new wrapper is added, register it here AND
// confirm in code review that it ultimately calls requireUser().
const STRONG_GATE_PATTERNS = [
  /requireUser\s*\(/,
  /requireCronSecret\s*\(/,
  /verifyWebhookSecret\s*\(/,
  /requireDietUser\s*\(/,
  /requireHealthUser\s*\(/,
] as const

// Weaker pattern: an inline supabase.auth.getUser() session check followed by
// an Unauthorized/401 response. Legitimate because RLS (migration 0139) now
// gates data by role; this check just confirms a session exists. Both halves
// must be present in the same file.
const INLINE_GETUSER = /auth\.getUser\s*\(\s*\)/
const INLINE_UNAUTHORIZED = /(status:\s*401|['"]Unauthorized['"])/

function findRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      findRouteFiles(full, out)
    } else if (entry === 'route.ts' || entry === 'route.tsx') {
      out.push(full)
    }
  }
  return out
}

describe('every API route has an auth gate', () => {
  const files = findRouteFiles(APP_API)
  const exemptSet = new Set(EXEMPT_ROUTES.map((e) => e.path.replace(/\\/g, '/')))

  for (const file of files) {
    const rel = relative(APP_API, file).replace(/\\/g, '/')

    if (exemptSet.has(rel)) {
      it.skip(`${rel} (exempt)`, () => {})
      continue
    }

    it(`${rel} calls an approved auth gate`, () => {
      const src = readFileSync(file, 'utf8')
      const strong = STRONG_GATE_PATTERNS.some((p) => p.test(src))
      const inline = INLINE_GETUSER.test(src) && INLINE_UNAUTHORIZED.test(src)
      expect(
        strong || inline,
        `${rel} must call requireUser/requireCronSecret/verifyWebhookSecret OR have inline auth.getUser() + 401 response`
      ).toBe(true)
    })
  }
})
