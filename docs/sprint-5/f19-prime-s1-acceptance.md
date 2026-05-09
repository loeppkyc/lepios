# F19' Slice 1 — Acceptance Doc

**task_id:** d4c6e2ae-2499-43ab-8129-84d4b5280be1
**kind:** f19_prime_s1
**spec:** docs/harness/F19_PRIME_SPEC.md
**spec_section:** Slice 1 (process-efficiency friction-index demo)
**coordinator:** 2026-05-09
**approval:** Colin-explicit via task metadata Q resolutions + do_not_auto_build=false

---

## Scope

Build the F19' Optimizer + Verifier TypeScript pair targeting the `process-efficiency` friction signal,
with migration 0166 adding `metadata jsonb` to `decisions_log` and `f19_loop` to the source CHECK
constraint. Acceptance tests AT1–AT6 must pass.

## Acceptance criterion

All six acceptance tests (AT1–AT6) pass in vitest. At least one `decisions_log` row exists with
`source = 'f19_loop'` after the demo run (verified via Supabase MCP SELECT).

---

## Files expected to change

| File | Action |
|------|--------|
| `supabase/migrations/0166_decisions_log_f19_state.sql` | New — metadata column + f19_loop source value |
| `lib/harness/f19/optimizer.ts` | New — Optimizer interface + stub implementation (~120 LOC) |
| `lib/harness/f19/verifier.ts` | New — Verifier interface + real implementation (~180 LOC) |
| `tests/harness/f19/optimizer.test.ts` | New — AT1, AT2, AT4 tests |
| `tests/harness/f19/verifier.test.ts` | New — AT3 tests |
| `tests/harness/f19/persistence.test.ts` | New — AT5a, AT5b, AT5c, AT6 tests |

No changes to existing files except the migration touches `decisions_log`.

---

## Migration 0166

Claim 0166 in `.claude/migration-claims.json` before committing.

```sql
-- 0166_decisions_log_f19_state.sql
-- F19' Slice 1: add metadata jsonb column + f19_loop source value

-- Step 1: add metadata column (IF NOT EXISTS — idempotent)
ALTER TABLE decisions_log ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Step 2: extend source CHECK to include f19_loop
-- Must drop + recreate because PostgreSQL CHECK constraints cannot be altered in place
ALTER TABLE decisions_log DROP CONSTRAINT decisions_log_source_check;
ALTER TABLE decisions_log ADD CONSTRAINT decisions_log_source_check
  CHECK (source = ANY (ARRAY[
    'redline_session',
    'morning_digest_response',
    'incident_response',
    'post_mortem',
    'f19_loop'
  ]));
```

**Current constraint (verified 2026-05-09):**
`CHECK (source = ANY (ARRAY['redline_session', 'morning_digest_response', 'incident_response', 'post_mortem']))`

**No data migration needed:** existing rows all have source values that remain valid. `metadata` defaults to NULL.

---

## Q Resolutions (Colin, embedded in task metadata 2026-04-28)

| Q | Resolution |
|---|------------|
| Q1_source_enum | Option A — add `f19_loop` to `decisions_log.source` CHECK via migration 0166 |
| Q1_prime_metadata_column | Option A — add `metadata jsonb` to `decisions_log` via migration 0166 |
| Q6_confidence_score | Deferred to slice 2+ — no `confidence_score` field on `CandidatePath` in slice 1 |
| Q8_tolerance_calibration | ±5% as instrumentation for slice 1; slice 2 calibrates from ≥14 days of variance data |

---

## Interfaces (from spec §M1, M2 — implement exactly, no deviation)

### optimizer.ts exports

```ts
export interface CandidatePath {
  id: string
  target: ComponentSlug            // must match a harness_components slug
  summary: string                  // used in decisions_log.chosen_path
  expected_gain_pct: number        // optimizer's estimate — verifier NEVER trusts this
  metric_key: string               // which metric the candidate optimizes
  proposed_change: {
    kind: 'code' | 'config' | 'process' | 'schema'
    diff_summary: string
    related_files?: string[]
  }
  rationale: string                // → decisions_log.options_considered
}

export interface OptimizerInput {
  target: ComponentSlug
  min_gain_pct?: number            // default 20 — paths below this are NOT surfaced
  axis?: 'speed' | 'cost' | 'quality'  // default 'speed'
}

export interface Optimizer {
  propose(input: OptimizerInput): Promise<CandidatePath[]>
}
```

**Stub implementation (slice 1):** Always returns one hardcoded candidate —
"spawn coordinator at queue depth ≥ 2 instead of waiting for digest";
`expected_gain_pct = 50`; `metric_key = 'queue_depth'`.
This proposal exceeds any `min_gain_pct ≤ 50`; AT1 tests the <25 case by setting min_gain_pct=60.

### verifier.ts exports

```ts
export type VetoReason =
  | { kind: 'acceptance_test_failed'; test_name: string; detail: string }
  | { kind: 'metric_regression'; metric_key: string; baseline: number; candidate: number; tolerance_pct: number }
  | { kind: 'benchmark_regression'; benchmark_name: string; direction: 'up' | 'down'; pct: number }
  | { kind: 'sibling_metric_regression'; metric_key: string; baseline: number; candidate: number }
  | { kind: 'deploy_gate_blocked'; reason: string }
  | { kind: 'capability_denied'; capability: string }
  | { kind: 'unknown_target'; target: string }

export interface VerifierResult {
  ship: boolean
  vetoes: VetoReason[]
  measured_gain_pct: number | null  // re-fetched from DB, not optimizer-quoted
  decision_id: string               // decisions_log row id
}

export interface Verifier {
  gate(candidate: CandidatePath): Promise<VerifierResult>
}
```

**Critical implementation requirements:**
- Verifier re-fetches `agent_events` to compute `measured_gain_pct` — never reads `candidate.expected_gain_pct`
- Writes `decisions_log` row with `metadata.f19_status = 'proposed'` on first call
- Updates to `'accepted' | 'vetoed' | 'pending'` after measurement window checks
- Does NOT short-circuit on first veto — collects all vetoes before returning
- ±5% sibling metric tolerance (instrumentation, not policy — Q8)
- Persistence: N=3 consecutive measurement windows before `'accepted'` — see AT5

---

## Acceptance tests (ALL must pass)

### AT1 — Optimizer respects min_gain_pct floor

```
optimizer.propose({ target: 'harness:process_efficiency', min_gain_pct: 60 })
→ returns []  (stub expected_gain_pct=50 < 60)

optimizer.propose({ target: 'harness:process_efficiency', min_gain_pct: 20 })
→ returns [{ expected_gain_pct: 50, ... }]  (50 ≥ 20)
```

### AT2 — Verifier writes decisions_log row regardless of ship verdict

Vetoed candidate still produces a `decisions_log` row:
- `chosen_path` contains `'rejected: '` prefix + veto summary
- `category = 'process'`
- `source = 'f19_loop'`
- `decided_by = 'agent'`

Assert via Supabase MCP `SELECT` after call. Row count must increase by 1.

### AT3 — Verifier vetoes sibling-metric regression

Synthesize fixture candidate: improves `friction_index` by 50% but increases `pickup_latency` by 30%.
- `verifier.gate(fixture)` returns `ship: false`
- `vetoes` array contains at least one `{ kind: 'sibling_metric_regression', metric_key: 'pickup_latency' }`

Fixture is in-memory; no actual code deployed.

### AT4 — Verifier re-measures independently

Seed `agent_events` rows with known metric values representing a measurable gain.
Set `candidate.expected_gain_pct = 999`.
Call `verifier.gate(candidate)`.
Assert: `result.measured_gain_pct` comes from the seeded rows, NOT from `999`.
Measured value must be within the plausible range for the seeded data, NOT 999.

### AT5 — Persistence check (N=3 windows, no single-measurement accept)

**AT5a — All 3 windows gain → accepted**
Seed 3 synthetic `agent_events` readings (distinct window boundaries) showing gain ≥ floor.
Call verifier 3 times (once per window).
Final `decisions_log` row: `metadata.f19_status = 'accepted'`, `metadata.f19_window_count = 3`.

**AT5b — 2 gain + 1 regression → pending or vetoed (NOT accepted)**
Windows 1-2 show gain; window 3 shows regression within tolerance.
Call verifier 3 times.
Final `decisions_log` row: `metadata.f19_status` is `'pending'` (if regression ≤ ±5%) or `'vetoed'`
(if regression > ±5%). NEVER `'accepted'`.

**AT5c — Window 1 gain + windows 2-3 regression → vetoed**
Window 1 shows gain; windows 2-3 show regression.
Call verifier 3 times.
Final row: `metadata.f19_status = 'vetoed'`, `vetoes` includes `metric_regression` entry.

### AT6 — decisions_log row provenance

Row written by a full optimizer → verifier cycle:
- `decided_by = 'agent'`
- `source = 'f19_loop'`

---

## Check-Before-Build findings

| Item | Status |
|------|--------|
| `lib/harness/f19/` directory | Does not exist — greenfield |
| `decisions_log` table | Live (migration 0044 applied) |
| `decisions_log.metadata` column | Does not exist — migration 0166 adds it |
| `decisions_log.source` CHECK | Lacks `f19_loop` — migration 0166 adds it |
| `agent_events` table | Live |
| `lib/harness/process-efficiency.ts` | Live (shipped 2026-04-26), 4 signals, benchmarks inline |
| Migration 0166 | Unclaimed (next_available = 166 per migration-claims.json) |

---

## External deps tested

None — this chunk is in-process TypeScript + Supabase only. No external API surface.
`decisions_log` and `agent_events` confirmed live above.

---

## Grounding checkpoint

After builder completes, Colin runs:

```sql
SELECT id, source, chosen_path, metadata->>'f19_status' AS f19_status, decided_by
FROM decisions_log
WHERE source = 'f19_loop'
ORDER BY decided_at DESC LIMIT 5;
```

Expected: ≥ 1 row with `source='f19_loop'`, `decided_by='agent'`,
`f19_status IN ('proposed', 'vetoed', 'accepted', 'pending')`.

Secondary check — confirm migration landed:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'decisions_log' AND column_name = 'metadata';
```
Expected: 1 row.

---

## Kill signals

- Any test requiring a running Next.js server to pass (wrong scope — must be pure vitest)
- Verifier reading `candidate.expected_gain_pct` instead of re-fetching (invalidates AT4)
- `decisions_log` rows created without `source = 'f19_loop'` or without `metadata` jsonb
- Optimizer calling Verifier on its own output (AD2 violation)

---

## Cached-principle decisions

- **Greenfield TypeScript module pattern**: matches coordinator-env, stall-alert, drain-403 — additive files + additive migration, all reversible. Principle 2 (scope split), Principle 3 (data model clarity).
- **`do_not_auto_build: false` + Q resolutions in task metadata = Colin's explicit approval** (path a, not cache-match path b). No additional escalation needed before builder delegation.
- **Migration 0166 number**: derived from `next-migration-number.mjs` cross-check (next_available=166 per claims file). Coordinator-level reservation happens at acceptance doc time; builder claims it in the same commit as the migration file.

---

## Open questions

None remaining — all spec open questions resolved via task metadata Q resolutions.

---

## Out of scope

- `lib/harness/f19/loop.ts` — slice 2
- Confidence score on `CandidatePath` — slice 2+ (Q6 deferred)
- `/stochastic-consensus` integration — slice 3+
- UI surfacing — no new UI in slice 1
- Cross-component optimization — slice 4+
- Tolerance calibration beyond ±5% instrumentation — slice 2
- Optimizer ML / pattern recognition — slice 4+

---

## F17/F18 justification (CLAUDE.md §3 rules 7-8)

**F17 — Behavioral ingestion:** F19' reads `agent_events` and `decisions_log`, which feed the
behavioral ingestion corpus. Every proposal → veto decision logged with structured reasoning becomes
a Twin-retrievable artifact. Contributes to the "what we tried that didn't work" signal corpus.

**F18 — Measurement + benchmark:**
- Metric: `agent_events` row count where `action = 'f19_proposal_gated'`, grouped by `ship` verdict
- Benchmark: ≥0 accepted proposals per 30-day window (slice 1 is instrumentation only — calibration in slice 2)
- Surfacing: `decisions_log WHERE source='f19_loop'` queryable by Twin ("have we tried batching X before?")
