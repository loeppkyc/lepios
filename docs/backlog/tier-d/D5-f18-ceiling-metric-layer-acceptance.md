# Acceptance Doc — D5: F18 Ceiling Metric Layer (Morning Digest Integration)

**task_id:** 726ee202-95ca-4650-87ed-26375e11bcb7  
**chunk:** D5  
**tier:** D (backlog)  
**status:** AWAITING_COLIN_APPROVAL  
**prepared:** 2026-05-16  
**prepared_by:** coordinator (run_id: 82acdf4a-6cfb-44b9-b93e-fe498b471deb)

---

## Scope

**One sentence:** Add `buildCeilingMetricLines()` to `lib/harness/ceiling-metrics.ts` that reads `improvement_log` trend data, detects flat/declining deltas per component/metric, and surfaces ceiling cause + lift cost in the morning digest; and add `improvement_log` writes to `buildProcessEfficiencyLines()` for all four process signals so trend data accumulates.

**Acceptance criterion:** After deploy, Colin triggers or waits for the next morning digest — the digest message includes a "Ceiling signals:" section. If no flat/declining trends are detected yet (first run or early runs), the section reads "Ceiling signals: none yet (need ≥5 readings per signal)". After ≥5 digest runs have accumulated `improvement_log` data for the harness signals, flat or declining trends appear with cause + lift cost text.

---

## Out of scope

- UI changes to `/harness/ceiling` — that page already exists (f18-ceiling chunk, migration 0206)
- Automated sync of `current_value` in `module_ceiling_metrics` — manual maintenance in v1
- F17 path-engine signal for ceiling lift decisions — follow-up chunk
- Trend detection for non-harness components (arb-engine, amazon, etc.) in this chunk — CEILING_HEURISTICS covers harness signals only in v1; extensible via constant

---

## Files expected to change

| File | Change |
|------|--------|
| `lib/harness/ceiling-metrics.ts` | **New file.** `buildCeilingMetricLines()` + `CEILING_HEURISTICS` constant |
| `lib/harness/process-efficiency.ts` | Add `improvement_log` INSERT for 4 signals after computing each value |
| `lib/orchestrator/digest.ts` | Import + call `buildCeilingMetricLines()`, append to morning digest |
| `tests/harness/ceiling-metrics.test.ts` | **New file.** Unit tests for trend detection logic |

No schema changes, no migrations.

---

## Check-Before-Build findings

| Area | What exists | Decision |
|------|-------------|----------|
| `improvement_log` table | Exists. Schema: id, recorded_at, component, metric, unit, value, is_baseline, build_ref, notes, meta | Use as-is — no migration needed |
| `module_ceiling_metrics` | 3 seeded rows (vercel-cron/money, ollama-embed/hardware, twin/time) | Read-only reference; ceiling-metrics.ts uses a separate CEILING_HEURISTICS constant for the 4 process signals |
| `lib/harness/process-efficiency.ts` | 4 signals computed: queue_throughput_pct, pickup_latency_p50_min, queue_depth, friction_index | Add improvement_log writes here after signal computation |
| `lib/orchestrator/digest.ts` | Pattern established: 30+ `build*Line()` functions appended sequentially | Add `buildCeilingMetricLines()` import + append block after process efficiency section |
| `arb-engine` writes to improvement_log | Uses `{component: 'arb-engine', metric: 'scan_latency_ms', unit: 'ms'}` | Follow same pattern; use `component: 'harness'` for all 4 process signals |

---

## Design decisions (resolved without Twin — Twin unreachable in coordinator sandbox)

### 1. CEILING_HEURISTICS as TS constant (not DB query)

`buildCeilingMetricLines()` must not add a DB round-trip to the morning digest beyond the `improvement_log` read it already needs. A hardcoded `CEILING_HEURISTICS` constant in `ceiling-metrics.ts` keeps the function fast. The `module_ceiling_metrics` table is for the `/harness/ceiling` dashboard; the CEILING_HEURISTICS constant mirrors the same data for the 4 process signals in digest form.

### 2. improvement_log write names for the 4 process signals

| Signal | component | metric | unit |
|--------|-----------|--------|------|
| Queue throughput | `harness` | `queue_throughput_pct` | `pct` |
| Pickup latency p50 | `harness` | `pickup_latency_p50_min` | `min` |
| Queue depth | `harness` | `queue_depth` | `count` |
| Friction index | `harness` | `friction_index` | `count` |

### 3. Trend detection algorithm

Window: last **5** readings per `{component, metric}` pair (or all readings if < 5 exist, minimum 3 to compute any delta).

**Flat signal:** absolute delta between first and last reading in window < 5% of max reading value **AND** no single step delta > 10% of max.

**Declining signal:** the last 3 readings each decrease by any amount (monotonically declining tail).

**Ceiling triggered:** flat OR declining signal detected. Emit one digest line per triggered signal.

**Not enough data:** < 3 readings → skip that signal silently. < 5 → compute trend on what exists, note "(N readings)".

### 4. CEILING_HEURISTICS constant (draft)

```ts
const CEILING_HEURISTICS: Record<string, {
  cause: string
  category: 'money' | 'hardware' | 'time'
  lift_cost: string
  lift_gain_pct: number
}> = {
  'harness:queue_throughput_pct': {
    cause: 'Coordinator quota: limited daily invocations at current Claude API tier',
    category: 'money',
    lift_cost: 'Upgrade API tier or batch tasks per coordinator session',
    lift_gain_pct: 50,
  },
  'harness:pickup_latency_p50_min': {
    cause: 'Vercel Hobby plan: hourly cron (24×/day max)',
    category: 'money',
    lift_cost: '~$20/month Vercel Pro → sub-minute cron (288×/day)',
    lift_gain_pct: 1100,
  },
  'harness:queue_depth': {
    cause: 'Task creation rate exceeds harness processing capacity',
    category: 'time',
    lift_cost: 'Increase cron frequency (needs Vercel Pro) or batch more per session',
    lift_gain_pct: 100,
  },
  'harness:friction_index': {
    cause: 'Spec quality: coordinator acceptance doc ambiguity increases grounding blocks',
    category: 'time',
    lift_cost: 'Improve study phase coverage + Twin Q&A corpus density',
    lift_gain_pct: 80,
  },
}
```

### 5. Morning digest output format

When ceiling signals detected:
```
Ceiling signals (F19):
• harness:pickup_latency_p50_min — flat 5 readings | cause: Vercel Hobby hourly cron | lift: ~$20/mo Vercel Pro (+1100%)
• harness:friction_index — declining 3 readings | cause: Spec quality: acceptance doc ambiguity | lift: Improve Twin Q&A (+80%)
```

When no signals:
```
Ceiling signals (F19): none detected (5 readings each)
```

When insufficient data:
```
Ceiling signals (F19): accumulating data (need ≥3 readings per signal)
```

---

## improvement_log write spec (for buildProcessEfficiencyLines)

After computing each signal value, builder inserts into `improvement_log`. This insert must be **fire-and-forget** (non-throwing — wrapped in try/catch, failure does not break the digest line). Insert only when the value is non-null.

```ts
// Inside buildProcessEfficiencyLines(), after computing each signal:
await db.from('improvement_log').insert({
  component: 'harness',
  metric: 'queue_throughput_pct',   // or pickup_latency_p50_min / queue_depth / friction_index
  unit: 'pct',                        // or 'min' / 'count' / 'count'
  value: <computed_value>,
  is_baseline: false,
  build_ref: null,
  notes: null,
  meta: { source: 'morning_digest', signal_24h: true }
})
```

Failure to insert does NOT change the return value of `buildProcessEfficiencyLines()`. A failed insert is swallowed (log to console if needed, never throw).

---

## buildCeilingMetricLines spec

```ts
export async function buildCeilingMetricLines(): Promise<string>
```

1. Query `improvement_log` for all `{component, metric}` pairs that have a key in `CEILING_HEURISTICS`, ordered by `recorded_at DESC`, limit 5 per pair (use `DISTINCT ON` or JS grouping).
2. For each pair with ≥ 3 readings: run trend detection (flat or declining check).
3. Build output lines per §5 above.
4. Never throw — catch all errors, return `'Ceiling signals (F19): stats unavailable'` on any unhandled error.

**Query shape:**
```sql
SELECT component, metric, value, recorded_at
FROM improvement_log
WHERE component = 'harness'
ORDER BY metric, recorded_at DESC
```
(Then group by metric in JS, take last 5 per group.)

---

## External deps tested

- `improvement_log` table: confirmed live in Supabase prod with 3 rows (arb-engine component)
- `module_ceiling_metrics` table: confirmed live (3 seeded rows from migration 0206)
- No new migrations — no schema changes

---

## Grounding checkpoint

Colin triggers or waits for the next morning digest after deploy. The digest message should contain a "Ceiling signals (F19):" section. On first run, it will show the "accumulating data" message. After 3+ morning digests have run (3+ days), trend detection activates.

**Immediate grounding query:**
```sql
SELECT component, metric, unit, value, recorded_at
FROM improvement_log
WHERE component = 'harness'
ORDER BY metric, recorded_at DESC;
-- After one morning digest runs post-deploy: expect 4 new rows (one per signal)
-- Values: queue_throughput_pct %, pickup_latency_p50_min float, queue_depth int, friction_index int
```

---

## Kill signals

- Builder cannot add `improvement_log` writes without breaking existing `buildProcessEfficiencyLines()` return value — escalate
- CEILING_HEURISTICS constant grows beyond 8 entries in v1 scope — defer extras to follow-up, do not self-approve

---

## Cached-principle decisions

**Twin unavailable (host not in allowlist from coordinator sandbox):** All design decisions resolved from codebase evidence:
- improvement_log schema read from Supabase information_schema
- Write pattern read from `lib/harness/daily-scan.ts` (arb-engine component)
- Digest integration pattern read from `lib/orchestrator/digest.ts` (30+ existing `build*Line()` calls)
- module_ceiling_metrics data confirmed live via MCP query

**META-C applicable:** This is a pure additive change (new TS constant, new file, 4 fire-and-forget DB inserts, 1 import in digest.ts). All decisions are reversible (delete the file, revert the process-efficiency.ts inserts). No seam files touched. No canonical writes (improvement_log is a telemetry/metrics table, not ledger/tax/money). No new terrain (harness digest lines are well-established pattern — 30+ prior examples).

**Path C conditions:**
1. Twin Q&A: blocked (unreachable) — cannot satisfy condition 1. Falling through to Path A.

→ Escalating to Colin for approval via Telegram.

---

## Open questions (for Colin)

Twin was unreachable. Surfacing for Colin in place of Twin answers:

1. **CEILING_HEURISTICS format:** Builder will use the TS constant defined in §4 above. Any changes to cause text, lift cost, or lift_gain_pct values? (These appear in the morning digest verbatim.)

2. **Trend threshold:** Using 5-reading window with <5% delta = flat. If you want a tighter/looser signal (e.g., 3 readings, 10% threshold), say so in your response — otherwise builder uses the spec values.

3. **Inclusion of `module_ceiling_metrics` in `buildCeilingMetricLines`:** v1 reads only `improvement_log` (for the 4 harness process signals). A future v2 could also pull rows from `module_ceiling_metrics` (ollama-embed, twin, vercel-cron) and include them in the digest when their `current_value` is near `ceiling_value`. Agree with deferring to v2?

---

## F17 + F18 compliance

**F17:** `improvement_log` writes from process signals create trending data that can feed path-engine decisions (high friction → reduce parallel sessions; high pickup latency → push Vercel Pro decision). Baseline established.

**F18 capture:** `improvement_log` rows written each morning digest run. Observable by querying the table.  
**F18 benchmark:** CEILING_HEURISTICS `lift_gain_pct` is the benchmark per signal.  
**F18 surfacing:** "Ceiling signals (F19):" section in morning Telegram digest. Colin can ask "what's the ceiling on harness throughput?" and get a digest-visible answer.

---

## Cost estimate

Builder session: ~1 hour. One new file (ceiling-metrics.ts ≈ 80 lines), small edit to process-efficiency.ts (4 fire-and-forget inserts ≈ 20 lines), one import + 3 lines in digest.ts, one test file (≈ 60 lines).
