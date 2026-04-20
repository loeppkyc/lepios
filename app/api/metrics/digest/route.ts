/**
 * Daily Digest — GET /api/metrics/digest
 *
 * CRON_SECRET protected (same pattern as /api/knowledge/nightly).
 * Runs daily at 07:00 MDT / 13:00 UTC via Vercel Cron.
 *
 * Generates a compact text summary (<500 chars) of yesterday's agent health
 * and sends it to Telegram if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set.
 * Always returns JSON so the Cron invocation has a logged response.
 */

import { NextResponse } from 'next/server'
import { getAutonomousRunSummary, getTopErrorTypes, getKnowledgeHealth, getDailySuccessRate } from '@/lib/metrics/rollups'
import { logEvent } from '@/lib/knowledge/client'

const CRON_SECRET = process.env.CRON_SECRET

// ── Telegram send ─────────────────────────────────────────────────────────────

async function sendTelegram(message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return false

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ── Digest builder ────────────────────────────────────────────────────────────

async function buildDigest(): Promise<{ message: string; data: Record<string, unknown> }> {
  const today = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Edmonton', // MST/MDT
    month: 'short',
    day: 'numeric',
  })

  const [summary1, summary7, topErrors, knowledge, rates30] = await Promise.all([
    getAutonomousRunSummary(1),
    getAutonomousRunSummary(7),
    getTopErrorTypes(1, 3),
    getKnowledgeHealth(),
    getDailySuccessRate(7),
  ])

  // Yesterday = first day in the 1-day summary
  const yesterday = rates30[rates30.length - 2] ?? null
  const yRate = yesterday?.rate ?? summary1.successRate
  const delta = yRate - summary7.successRate

  // Build top errors string
  const errorStr =
    topErrors.length === 0
      ? 'none'
      : topErrors.map((e) => `${e.error_type} ×${e.count}`).join(', ')

  // Safety flags (yesterday blocking)
  const safetyStr =
    summary1.blockingSafetyRuns > 0
      ? `${summary1.blockingSafetyRuns} BLOCKING`
      : summary1.safetyFlagsTotal > 0
        ? `0 blocking, ${summary1.safetyFlagsTotal} total`
        : 'clean'

  const deltaStr = delta >= 0 ? `+${delta}%` : `${delta}%`

  // Keep under 500 chars
  const lines = [
    `LepiOS — ${today}`,
    `Yesterday: ${yRate}% success (${summary1.totalEvents} events)`,
    `vs 7-day avg: ${summary7.successRate}% (${deltaStr})`,
    `Errors: ${errorStr}`,
    `Safety: ${safetyStr}`,
    `Knowledge: ${knowledge.total} entries, conf ${knowledge.avgConfidence.toFixed(2)}, ${knowledge.usedLast7Days} used`,
  ]

  const message = lines.join('\n')

  return {
    message,
    data: {
      yRate,
      delta,
      totalEvents: summary1.totalEvents,
      topErrors,
      safetyFlagsTotal: summary1.safetyFlagsTotal,
      blockingSafetyRuns: summary1.blockingSafetyRuns,
      knowledgeTotal: knowledge.total,
      knowledgeAvgConfidence: knowledge.avgConfidence,
    },
  }
}

// ── Route handlers ────────────────────────────────────────────────────────────

async function handler(request: Request) {
  if (CRON_SECRET) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startMs = Date.now()
  const { message, data } = await buildDigest()

  const telegramSent = await sendTelegram(message)

  const duration = Date.now() - startMs

  void logEvent('system', 'metrics.digest', {
    actor: 'cron',
    status: 'success',
    outputSummary: `digest sent: ${telegramSent ? 'telegram' : 'log-only'} (${message.length} chars)`,
    durationMs: duration,
    meta: { ...data, telegram_sent: telegramSent, char_count: message.length },
  })

  return NextResponse.json({
    ok: true,
    telegram_sent: telegramSent,
    char_count: message.length,
    message,
    ...data,
  })
}

export async function GET(request: Request) {
  return handler(request)
}

export async function POST(request: Request) {
  return handler(request)
}
