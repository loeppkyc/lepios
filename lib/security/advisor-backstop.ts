import { getSecret } from './secrets'

// Closes F-L6 ("Twin never verified functional in production — found via audit,
// not monitoring") for Supabase advisor output specifically. Polls the Management
// API every digest run and surfaces only NEW actionable findings (WARN+ level,
// not in the accepted-list). Without this, Supabase's 4 AM advisor email is the
// only signal — and the persistent HIBP plan-gated WARN dilutes that signal.
//
// Spec contract: never throws. Returns one Telegram-formatted line for digest
// composition. On any failure (missing token, API down, network error) returns
// "Advisor: backstop unavailable" so digest still ships.

interface AcceptedFinding {
  cache_key: string
  reason: string
}

// Findings explicitly accepted as not-actionable. Add to this list ONLY via PR
// with a reason. Acceptance is auditable in git history. INFO-level findings
// are filtered upstream by level — they don't need entries here.
//
// Resolution checklist for new entries:
//   1. Verify the finding is genuinely not-actionable (plan-gated, intentional,
//      or compensated by a different control).
//   2. Document the reason in `docs/follow-ups/` with a revisit trigger.
//   3. Add the cache_key + one-line reason here.
const ACCEPTED_FINDINGS: ReadonlyArray<AcceptedFinding> = [
  {
    cache_key: 'auth_leaked_password_protection',
    reason:
      'Plan-gated: Supabase Pro+ required to enable HIBP. See docs/follow-ups/2026-05-06-supabase-advisor-deferred.md §3. Revisit on plan upgrade.',
  },
]

interface SupabaseLint {
  cache_key: string
  level: 'INFO' | 'WARN' | 'ERROR'
  name: string
  detail: string
}

const PROJECT_REF = 'xpanlbcjueimeofgsara'
const ADVISOR_ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/advisors/security`

async function fetchAdvisorLints(): Promise<SupabaseLint[]> {
  const token = await getSecret('SUPABASE_MANAGEMENT_TOKEN')
  const response = await fetch(ADVISOR_ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Advisor API ${response.status}`)
  }
  const json = (await response.json()) as { lints: SupabaseLint[] }
  return json.lints
}

export async function buildAdvisorBackstopLine(): Promise<string> {
  try {
    const lints = await fetchAdvisorLints()
    const acceptedKeys = new Set(ACCEPTED_FINDINGS.map((f) => f.cache_key))

    // INFO is too noisy and tends to be intentional state (RLS-on-no-policy on
    // service-role-only tables). Backstop only cares about WARN+ that isn't
    // already on the accepted list.
    const actionable = lints.filter(
      (l) => (l.level === 'WARN' || l.level === 'ERROR') && !acceptedKeys.has(l.cache_key)
    )

    if (actionable.length === 0) {
      return 'Advisor: 0 new findings ✅'
    }

    const errorCount = actionable.filter((l) => l.level === 'ERROR').length
    const warnCount = actionable.filter((l) => l.level === 'WARN').length
    const sample = actionable
      .slice(0, 3)
      .map((l) => l.cache_key)
      .join(', ')
    const icon = errorCount > 0 ? '🚨' : '⚠️'

    return `Advisor: ${errorCount} ERROR, ${warnCount} WARN ${icon} — [${sample}]`
  } catch {
    return 'Advisor: backstop unavailable'
  }
}
