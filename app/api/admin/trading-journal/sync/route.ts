/**
 * POST /api/admin/trading-journal/sync
 *
 * Reads the "📈 Trading Journal" Google Sheets tab and backfills
 * trading_sessions with one row per unique (session_date, ticker) pair.
 *
 * Auth: Bearer $CRON_SECRET  (F22 — requireCronSecret)
 *
 * Returns: { synced: N, skipped: M, errors: string[] }
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { readOsSheet, parseDollar } from '@/lib/sheets/client'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── Sheet constants ────────────────────────────────────────────────────────────

const SHEET_TAB = '📈 Trading Journal'
// Row 11 (0-indexed = 10) is the header row; data begins at row 12 (index 11)
const HEADER_ROW_INDEX = 10
const DATA_START_INDEX = 11

// Header column positions (resolved dynamically against actual header row)
interface ColIndex {
  date: number
  paperReal: number
  daySwing: number
  direction: number
  ticker: number
  priceIn: number
  stopLoss: number
  takeProfit: number
  stoppedOut: number
  dateOut: number
  priceOut: number
  comments: number
  mood: number
  pointsPL: number
  dollarPL: number
}

function resolveColumns(headers: string[]): ColIndex {
  const find = (label: string) => {
    const idx = headers.findIndex(
      (h) => (h ?? '').trim().toLowerCase() === label.toLowerCase()
    )
    return idx >= 0 ? idx : -1
  }

  return {
    date: find('Date'),
    paperReal: find('Paper/Real'),
    daySwing: find('Day/Swing'),
    direction: find('Direction'),
    ticker: find('Ticker'),
    priceIn: find('Price In'),
    stopLoss: find('Stop Loss'),
    takeProfit: find('Take Profit'),
    stoppedOut: find('Stopped Out'),
    dateOut: find('Date Out'),
    priceOut: find('Price Out'),
    comments: find('Comments'),
    mood: find('Mood'),
    pointsPL: find('Points P/L'),
    dollarPL: find('$ P/L'),
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Parse "11 pts", "12.75 pts", "-5 pts", "11", "" → number */
function parsePoints(val: string | undefined): number {
  if (!val || val.trim() === '') return 0
  const cleaned = val.trim().replace(/\s*pts\.?/i, '').trim()
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

/** Parse date strings: "2025-09-04", "9/4/2025", "Sep 4, 2025" → "YYYY-MM-DD" */
function parseDate(val: string | undefined): string | null {
  if (!val || val.trim() === '') return null
  const s = val.trim()

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // MM/DD/YYYY or M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const [, mm, dd, yyyy] = mdy
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }

  // Try Date constructor as last resort
  const d = new Date(s)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }

  return null
}

/** Normalize direction to 'long' | 'short' */
function parseDirection(val: string | undefined): 'long' | 'short' {
  const s = (val ?? '').trim().toLowerCase()
  if (s === 'short') return 'short'
  return 'long'
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request): Promise<NextResponse> {
  // F22 — cron-secret auth
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  // ── 1. Read sheet ──────────────────────────────────────────────────────────
  let raw: string[][]
  try {
    raw = await readOsSheet(SHEET_TAB, 200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Sheets read failed: ${msg}` }, { status: 502 })
  }

  if (raw.length <= HEADER_ROW_INDEX) {
    return NextResponse.json({ error: 'Sheet is empty or header row not found' }, { status: 422 })
  }

  const headers = raw[HEADER_ROW_INDEX]
  const cols = resolveColumns(headers)

  if (cols.date === -1 || cols.dollarPL === -1) {
    return NextResponse.json(
      {
        error: 'Could not resolve required columns (Date, $ P/L) in header row',
        headers,
      },
      { status: 422 }
    )
  }

  // ── 2. Parse trade rows ────────────────────────────────────────────────────
  interface ParsedTrade {
    session_date: string
    ticker: string
    direction: 'long' | 'short'
    price_in: number
    price_out: number | null
    points_pl: number
    dollar_pl: number
    comments: string
    mood: string
    paper_or_real: string
    horizon: string
  }

  const trades: ParsedTrade[] = []
  const parseErrors: string[] = []

  for (let i = DATA_START_INDEX; i < raw.length; i++) {
    const row = raw[i]
    if (!row || row.length === 0) continue

    const rawDate = row[cols.date]
    const session_date = parseDate(rawDate)

    // Skip rows without a parseable date (title rows, blank rows, etc.)
    if (!session_date) continue

    const rawDollar = cols.dollarPL >= 0 ? row[cols.dollarPL] : ''
    const dollar_pl = parseDollar(rawDollar)

    const rawTicker = cols.ticker >= 0 ? (row[cols.ticker] ?? '').trim() : 'MES'
    const ticker = rawTicker || 'MES'

    let priceOut: number | null = null
    if (cols.priceOut >= 0 && row[cols.priceOut]) {
      const p = parseFloat((row[cols.priceOut] ?? '').replace(/[^0-9.-]/g, ''))
      if (!isNaN(p)) priceOut = p
    }

    let priceIn = 0
    if (cols.priceIn >= 0 && row[cols.priceIn]) {
      const p = parseFloat((row[cols.priceIn] ?? '').replace(/[^0-9.-]/g, ''))
      if (!isNaN(p)) priceIn = p
    }

    trades.push({
      session_date,
      ticker,
      direction: parseDirection(cols.direction >= 0 ? row[cols.direction] : undefined),
      price_in: priceIn,
      price_out: priceOut,
      points_pl: parsePoints(cols.pointsPL >= 0 ? row[cols.pointsPL] : undefined),
      dollar_pl,
      comments: (cols.comments >= 0 ? row[cols.comments] ?? '' : '').trim(),
      mood: (cols.mood >= 0 ? row[cols.mood] ?? '' : '').trim(),
      paper_or_real: (cols.paperReal >= 0 ? row[cols.paperReal] ?? '' : '').trim(),
      horizon: (cols.daySwing >= 0 ? row[cols.daySwing] ?? '' : '').trim(),
    })
  }

  if (trades.length === 0) {
    return NextResponse.json({ synced: 0, skipped: 0, errors: parseErrors })
  }

  // ── 3. Group by (session_date, ticker) ────────────────────────────────────
  const sessionMap = new Map<
    string,
    { date: string; ticker: string; tradeList: ParsedTrade[] }
  >()

  for (const t of trades) {
    const key = `${t.session_date}::${t.ticker}`
    if (!sessionMap.has(key)) {
      sessionMap.set(key, { date: t.session_date, ticker: t.ticker, tradeList: [] })
    }
    sessionMap.get(key)!.tradeList.push(t)
  }

  // ── 4. Build upsert rows ───────────────────────────────────────────────────
  interface SessionUpsert {
    session_date: string
    ticker: string
    strategy_name: string
    outcome: 'green' | 'red' | 'scratch'
    net_pnl: number
    summary: string
    key_lesson: string | null
    trades_json: object[]
    tags: string[]
  }

  const upsertRows: SessionUpsert[] = []

  for (const { date, ticker, tradeList } of sessionMap.values()) {
    const netPnl = Math.round(tradeList.reduce((sum, t) => sum + t.dollar_pl, 0) * 100) / 100
    const totalPts = Math.round(tradeList.reduce((sum, t) => sum + t.points_pl, 0) * 100) / 100
    const outcome: 'green' | 'red' | 'scratch' =
      netPnl > 0 ? 'green' : netPnl < 0 ? 'red' : 'scratch'

    const comments = tradeList
      .map((t) => t.comments)
      .filter(Boolean)
    const key_lesson = comments.length > 0 ? comments.join(' | ') : null

    // Determine tags from paper_or_real
    const allPaper = tradeList.every((t) =>
      t.paper_or_real.toLowerCase().includes('paper')
    )
    const allReal = tradeList.every(
      (t) => !t.paper_or_real.toLowerCase().includes('paper') && t.paper_or_real !== ''
    )
    const tags = allPaper ? ['paper_trade'] : allReal ? ['real'] : ['mixed']

    const trades_json = tradeList.map((t) => ({
      direction: t.direction,
      price_in: t.price_in,
      price_out: t.price_out,
      points_pl: t.points_pl,
      dollar_pl: t.dollar_pl,
      comments: t.comments || null,
      mood: t.mood || null,
      paper_or_real: t.paper_or_real,
      horizon: t.horizon,
    }))

    upsertRows.push({
      session_date: date,
      ticker,
      strategy_name: '',
      outcome,
      net_pnl: netPnl,
      summary: `${tradeList.length} trade${tradeList.length !== 1 ? 's' : ''} | ${totalPts > 0 ? '+' : ''}${totalPts} pts | ${outcome}`,
      key_lesson,
      trades_json,
      tags,
    })
  }

  // ── 5. Upsert to Supabase ──────────────────────────────────────────────────
  const db = createServiceClient()
  let synced = 0
  let skipped = 0
  const upsertErrors: string[] = []

  // Batch in chunks of 50
  const BATCH = 50
  for (let i = 0; i < upsertRows.length; i += BATCH) {
    const chunk = upsertRows.slice(i, i + BATCH)

    const { error } = await db
      .from('trading_sessions')
      .upsert(chunk, { onConflict: 'session_date,ticker', ignoreDuplicates: true })

    if (error) {
      upsertErrors.push(`batch[${i}–${i + chunk.length - 1}]: ${error.message}`)
      skipped += chunk.length
    } else {
      synced += chunk.length
    }
  }

  return NextResponse.json({
    synced,
    skipped,
    errors: [...parseErrors, ...upsertErrors],
    total_trades_parsed: trades.length,
    sessions_found: upsertRows.length,
  })
}
