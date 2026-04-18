/**
 * Zod validation schema for the bets table.
 *
 * Enum values are LOWERCASE — matching the DB CHECK constraints:
 *   bets_result_check:   win | loss | push | void | pending
 *   bets_bet_type_check: moneyline | spread | over_under | parlay | prop | futures
 *
 * NOTE: The sprint2-port-plan.md spec used capitalized values ('Win', 'Pending',
 * 'Moneyline'). The actual DB constraints use lowercase. These schemas match the DB.
 * See docs/hallucination-log.md for pattern.
 */

import { z } from 'zod'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Exposed so route handlers and tests can reference enum members by name
export const BET_RESULT_VALUES = ['win', 'loss', 'push', 'void', 'pending'] as const
export const BET_TYPE_VALUES = [
  'moneyline',
  'spread',
  'over_under',
  'parlay',
  'prop',
  'futures',
] as const

export type BetResult = (typeof BET_RESULT_VALUES)[number]
export type BetType = (typeof BET_TYPE_VALUES)[number]

/**
 * Schema for POST /api/bets request body.
 *
 * Required: bet_date (DB NOT NULL), odds (needed for Kelly calculation).
 * person_handle is NOT accepted from the body — derived server-side from the session.
 * _source is set server-side to 'lepios'.
 */
export const BetInsertSchema = z.object({
  bet_date: z.string().regex(DATE_RE, 'Must be YYYY-MM-DD'),
  sport: z.string().min(1).optional(),
  league: z.string().min(1).optional(),
  home_team: z.string().optional(),
  away_team: z.string().optional(),
  bet_on: z.string().min(1).optional(),
  bet_type: z.enum(BET_TYPE_VALUES).optional(),
  odds: z.number().int('Odds must be an integer'),
  closing_odds: z.number().int().optional(),
  stake: z.number().positive().optional(),
  bankroll_before: z.number().positive().optional(),
  result: z.enum(BET_RESULT_VALUES).default('pending'),
  pnl: z.number().optional(),
  bankroll_after: z.number().positive().optional(),
  book: z.string().optional(),
  ai_notes: z.string().optional(),
  win_prob_pct: z.number().min(0).max(100).optional(),
})

export type BetInsert = z.infer<typeof BetInsertSchema>

/** Schema for GET /api/bets query parameters. */
export const BetQuerySchema = z.object({
  from: z.string().regex(DATE_RE, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(DATE_RE, 'to must be YYYY-MM-DD').optional(),
  result: z.enum(BET_RESULT_VALUES).optional(),
  // Cap at 200 via transform (do not reject — silently clamp per spec)
  limit: z.coerce.number().int().positive().default(50).transform((n) => Math.min(n, 200)),
})

export type BetQuery = z.infer<typeof BetQuerySchema>
