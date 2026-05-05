/**
 * Architecture invariant (F-N5):
 *   Every file under app/api/** that imports createServiceClient must also
 *   gate via auth.getUser() (user-facing) OR requireCronSecret() (cron-style).
 *
 *   createServiceClient bypasses RLS, and the root middleware excludes /api/*
 *   from auth redirects. Without an explicit gate in the route, the endpoint
 *   is publicly callable and can read/write privileged data.
 *
 *   This test scans the route tree at vitest time. A failure here means a new
 *   route shipped with a security gap of the F-N5 class.
 *
 * If a route legitimately must be public (e.g., webhook with its own signature
 * verification), add it to ALLOWED_PUBLIC with a reason and a sibling check
 * that the route-specific signature verification IS present.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const API_ROOT = join(ROOT, 'app', 'api')

// Routes whose own auth model is not user.auth or cron-secret. Each entry
// must declare WHY and what verification IS present in the file.
// Format: { path: string (POSIX, relative to app/api/), reason: string, requireToken: string }
//   requireToken: a string that must appear in the file body proving the
//                 alternate auth/verification path is wired.
const ALLOWED_PUBLIC: Array<{ path: string; reason: string; requireToken: string }> = [
  {
    path: 'telegram/webhook/route.ts',
    reason: "Telegram webhook — verifies signature via Telegram's secret_token header",
    requireToken: 'x-telegram-bot-api-secret-token',
  },
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (entry === 'route.ts') out.push(p)
  }
  return out
}

interface RouteScan {
  path: string // posix, relative to app/api/
  importsServiceClient: boolean
  hasAuthGetUser: boolean
  hasCronSecret: boolean
}

function scan(absPath: string): RouteScan {
  const body = readFileSync(absPath, 'utf8')
  return {
    path: relative(API_ROOT, absPath).replace(/\\/g, '/'),
    importsServiceClient: /from\s+['"]@\/lib\/supabase\/service['"]/.test(body),
    hasAuthGetUser: /\.auth\.getUser\s*\(/.test(body),
    hasCronSecret: /requireCronSecret\s*\(/.test(body),
  }
}

describe('app/api/** — auth coverage invariant (F-N5)', () => {
  const routes = walk(API_ROOT).map(scan)

  it('every service_role route has either auth.getUser() or requireCronSecret()', () => {
    const violations: string[] = []
    for (const r of routes) {
      if (!r.importsServiceClient) continue
      if (r.hasAuthGetUser || r.hasCronSecret) continue
      const allow = ALLOWED_PUBLIC.find((a) => a.path === r.path)
      if (allow) continue
      violations.push(r.path)
    }
    if (violations.length > 0) {
      throw new Error(
        `Routes use createServiceClient (RLS bypass) without an auth gate:\n` +
          violations.map((v) => `  - ${v}`).join('\n') +
          `\n\nAdd auth.getUser() (user-facing) or requireCronSecret() (cron). ` +
          `If the route must be public, add it to ALLOWED_PUBLIC in this test ` +
          `with a reason and a verification token. (F-N5)`
      )
    }
    expect(violations).toEqual([])
  })

  it('every ALLOWED_PUBLIC entry still has its required verification token', () => {
    const broken: Array<{ entry: (typeof ALLOWED_PUBLIC)[number]; reason: string }> = []
    for (const allow of ALLOWED_PUBLIC) {
      const abs = join(API_ROOT, allow.path)
      let body: string
      try {
        body = readFileSync(abs, 'utf8')
      } catch {
        broken.push({ entry: allow, reason: 'file no longer exists' })
        continue
      }
      if (!body.includes(allow.requireToken)) {
        broken.push({
          entry: allow,
          reason: `requireToken '${allow.requireToken}' not found in file`,
        })
      }
    }
    if (broken.length > 0) {
      throw new Error(
        `ALLOWED_PUBLIC entries are stale:\n` +
          broken.map((b) => `  - ${b.entry.path}: ${b.reason}`).join('\n') +
          `\nEither restore the verification token or remove the entry from ALLOWED_PUBLIC.`
      )
    }
    expect(broken).toEqual([])
  })

  it('finds at least one route to scan (sanity check on the walker)', () => {
    expect(routes.length).toBeGreaterThan(10)
  })
})
