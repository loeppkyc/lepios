/**
 * CRON_SECRET auth gate for cron + harness routes.
 *
 * Fail-closed: if CRON_SECRET is not set in the environment, the route
 * returns 500 (configuration error) instead of silently allowing the
 * request. This prevents the open-endpoint pattern where a missing env var
 * leaves the route unauthenticated.
 *
 * Usage:
 *   import { requireCronSecret } from '@/lib/auth/cron-secret'
 *
 *   export async function POST(request: Request) {
 *     // auth: see lib/auth/cron-secret.ts
 *     const unauthorized = requireCronSecret(request)
 *     if (unauthorized) return unauthorized
 *     // ... handler logic
 *   }
 *
 * F22 — every route that needs cron-secret auth must call this helper.
 * Inline implementations are flagged by eslint.config.mjs
 * (no-restricted-syntax scoped to app/api/**) and by the reviewer agent.
 */

import { NextResponse } from 'next/server'

export function requireCronSecret(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
