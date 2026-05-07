// POST /api/self-repair/halt
//
// Killswitch endpoint. Sets harness_config.SELF_REPAIR_HALTED to 'true'
// (or 'false' to resume). Notifies via daily-bot.
//
// Body:
//   { halted: true,  reason: "..." }   → halt
//   { halted: false }                  → resume
//
// Auth: Bearer $CRON_SECRET. The original design called for admin-user auth
// via requireUser, but that helper is on the unmerged security/lockdown
// branch (PR #104). When that lands, swap back to requireUser({minRole:'admin'}).
// Cron-secret is sufficient for the killswitch — only Colin and the harness
// have it, and the secret lives in harness_config behind admin-only RLS.
//
// Wiring this through /api/telegram/webhook to back a `/halt` chat command
// lives outside this PR's scope — see notes/cross-window-suggestions.md.

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { setHalted } from '@/lib/night_watchman/loop-guards'
import { sendDailyBot } from '@/lib/telegram/daily-bot'
import { renderHaltNotice, renderResumeNotice } from '@/lib/telegram/templates'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const body = (await request.json().catch(() => null)) as {
    halted?: boolean
    reason?: string
  } | null
  if (!body || typeof body.halted !== 'boolean') {
    return NextResponse.json(
      { error: 'body must be { halted: boolean, reason?: string }' },
      { status: 400 }
    )
  }

  const db = createServiceClient()
  await setHalted(db, body.halted)

  const text = body.halted
    ? renderHaltNotice(body.reason ?? 'manual halt via /api/self-repair/halt')
    : renderResumeNotice()
  const tg = await sendDailyBot(text)

  await db.from('agent_events').insert({
    domain: 'night_watchman',
    action: body.halted ? 'halted' : 'resumed',
    actor: 'self_repair_halt_endpoint',
    status: 'success',
    meta: {
      reason: body.reason ?? null,
      auth_method: 'cron_secret',
      telegram_ok: tg.ok,
      telegram_message_id: tg.messageId ?? null,
    },
  })

  return NextResponse.json({ ok: true, halted: body.halted, telegram: tg })
}
