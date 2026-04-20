// Known domains used by LepiOS modules. The event-log-consistency
// check flags any domain NOT in this list so typos, rogue writes,
// or new undeclared modules surface in the morning digest.
// Adding to this list does not grant permission — it acknowledges
// existence. If you add a new module that writes agent_events,
// add its domain here.
export const KNOWN_EVENT_DOMAINS = [
  'commerce',
  'knowledge',
  'safety',
  'orchestrator',
  'health',
  'pageprofit',
  'system',
  'ollama',
] as const

export const STUCK_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
export const SLOW_EVENT_THRESHOLD_MS = 30_000

export const CURRENT_CAPACITY_TIER = 'tier_1_laptop_ollama'
export const WEIGHTS_V1 = {
  completeness: 0.4,
  signal_quality: 0.3,
  efficiency: 0.2,
  hygiene: 0.1,
} as const
export const BASELINE_MIN_RUNS = 7
export const SCORER_VERSION = 'rule_based_v1'

const MT_TZ = 'America/Denver'

/**
 * Returns yesterday's date range in Mountain Time as UTC ISO strings.
 * Uses Intl to derive the actual MDT/MST offset — handles DST transitions
 * automatically without hardcoding offsets.
 */
export function getYesterdayRangeMT(): { start: string; end: string } {
  const now = new Date()

  // Get today's calendar date in MT ('YYYY-MM-DD' via en-CA locale)
  const todayMTStr = now.toLocaleDateString('en-CA', { timeZone: MT_TZ })
  const [ty, tm, td] = todayMTStr.split('-').map(Number)

  // Probe noon UTC to read the MT hour — derives the active offset without DST tables.
  // MDT (UTC-6): noon UTC = 6 AM MT  → noonMTHour=6,  midnight MT = UTC+6h
  // MST (UTC-7): noon UTC = 5 AM MT  → noonMTHour=5,  midnight MT = UTC+7h
  const noonUTC = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0))
  const noonMTHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: MT_TZ, hour: 'numeric', hour12: false }).format(
      noonUTC
    ),
    10
  )
  const todayMidnightUTC = new Date(Date.UTC(ty, tm - 1, td, 12 - noonMTHour, 0, 0))
  const yesterdayMidnightUTC = new Date(todayMidnightUTC.getTime() - 24 * 3_600_000)

  return {
    start: yesterdayMidnightUTC.toISOString(),
    end: todayMidnightUTC.toISOString(),
  }
}
