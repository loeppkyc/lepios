// POST /api/self-repair/halt
//
// Killswitch endpoint. Sets harness_config.SELF_REPAIR_HALTED to 'true'
// (or 'false' to resume). Notifies via daily-bot.
//
// Body:
//   { halted: true,  reason: "..." }   → halt
//   { halted: false }                  → resume
//
// Auth: admin user only. Wiring this through the existing /api/telegram/webhook
// to back a `/halt` chat command lives outside this PR's scope — logged in
// notes/cross-window-suggestions.md.

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createServiceClient } from '@/lib/supabase/service'
import { setHalted } from '@/lib/night_watchman/loop-guards'
import { sendDailyBot } from '@/lib/telegram/daily-bot'
import { renderHaltNotice, renderResumeNotice } from '@/lib/telegram/templates'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const gate = await requireUser({ minRole: 'admin' })
  if (!gate.ok) return gate.response

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
      changed_by_user_id: gate.user.id,
      telegram_ok: tg.ok,
      telegram_message_id: tg.messageId ?? null,
    },
  })

  return NextResponse.json({ ok: true, halted: body.halted, telegram: tg })
}
