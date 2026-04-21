# Handoff: Feedback Loop Scoring v1

## Status
Shipped. Rule-based scorer live in production for both night_tick
and morning_digest. First real overnight run scored aggregate=75.
Tier 1 (tier_1_laptop_ollama) baseline data is accumulating.

## What shipped

| Commit | File / area |
| --- | --- |
| `b3028fe` | `supabase/migrations/0014_add_quality_scoring.sql` — task_type + quality_score columns, task_feedback table |
| `341ad3f` | `lib/orchestrator/scoring.ts` — scoreNightTick, fetchHistoricalContext, 18 tests |
| `446b8b8` | `lib/orchestrator/tick.ts` — scoreNightTick wired in, never-throws; 4 integration tests (349 total) |
| `8d9a698` | `lib/orchestrator/scoring.ts` — scoreMorningDigest, scoreEfficiencyMs shared helper, 21 new scorer tests + 4 integration tests (370 total) |
| `8d9a698` | `lib/orchestrator/digest.ts` — DigestResult type, scoring wired in, telegram_latency_ms → duration_ms aliasing |
| `8d9a698` | `lib/orchestrator/types.ts` — DigestResult interface |
| `76a9c0b` | `app/(dashboard)/autonomous/_components/QualityTrends.tsx` — top section, one card per task_type |
| `b74ce6d` | `docs/feedback-loop-scoring.md` — §4.2 signal_quality placeholder note, §7.1 one-liner |
| `e01634e` | `docs/feedback-loop-scoring.md` — §11 deferred work (thumbs, drill-down, LLM scoring, attribution) |

## Key design decisions
- 0–100 scale (not 0–5) so 20% improvements are legible
- Capacity tier is a string field, not an enum. Scores only
  compare within a tier.
- Weights v1: completeness 0.4, signal_quality 0.3, efficiency
  0.2, hygiene 0.1
- Baseline-shy: efficiency defaults to 50 until 7+ prior in-tier
  runs exist
- Signal Quality 50/70 is a placeholder pending thumbs + LLM
  scoring. Documented explicitly in §4.2.
- Scoring never throws up to the caller. Fallback to
  rule_based_v1_fallback with aggregate=null on error, event row
  still writes.

## Verified in production
- First overnight night_tick (2026-04-21 08:02 UTC): aggregate=75,
  all dimensions correct, math checks out
- Manual morning_digest invocation (12:54 UTC): aggregate=75,
  completeness=100 on sent path
- Dashboard QualityTrends renders correctly on /autonomous
- 370 tests passing, 0 TypeScript errors

## Known limitations
- Signal Quality rule is intentionally weak (see §4.2)
- No baseline for efficiency until 7 runs accrue per task_type
- Thumbs not wired (§11.1 deferred)
- LLM-based scoring not wired (§11.3 blocked on Step 6.5)
- QualityTrends dashboard has no drill-down (§11.2 deferred)

## Next session pickup
- If thumbs become urgent: §11.1 in the doc has the scope
- Otherwise: app-layer work or Step 6.5 Ollama wiring
- Deferred work triggers live in docs/feedback-loop-scoring.md §11
