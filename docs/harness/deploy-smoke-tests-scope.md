# Post-Deploy Smoke Test Framework — Scope Doc

**Status:** Awaiting Colin approval before build begins
**Authored:** 2026-04-27
**Triggered by:** F-L6 (twin never monitored, found by audit not alerting) +
silent Vercel cron rejection 2026-04-26 (21 points idle ~12h before W1 caught it)

---

## 1 — Audit Findings: What the Gate Does Today

### Current deploy gate (lib/harness/deploy-gate.ts)

The gate is **cron-triggered** (not webhook-driven). `GET /api/cron/deploy-gate-runner`
runs on schedule, polls Vercel API for pending preview deployments, and runs this sequence:

```
1. findPreviewDeployment — poll Vercel until preview is READY (10-min timeout)
2. runSmokeCheck        — hit /api/health, expect { ok: true } + HTTP 200
3. detectMigrations     — diff commit against main for supabase/migrations/ changes
4. IF migrations:       sendMigrationGateMessage → human approval via Telegram buttons
5. IF no migrations:    mergeToMain (if DEPLOY_GATE_AUTO_PROMOTE=true)
6. sendPromotionNotification → Telegram with 10-min rollback window
```

**What it explicitly does NOT do:**

| Gap | Description |
|-----|-------------|
| No production deploy verification | Gate merges to main and fires the Telegram "promoted" message. It never confirms that Vercel's *production* build actually succeeded. |
| `/api/health` is a stub | Returns `{ ok: true }` unconditionally — always returns 200, no real service checks. The smoke "passes" even if every downstream service is broken. |
| No cron registration check | Vercel Hobby plan only allows 2 hourly crons. Additional cron entries in `vercel.json` are silently rejected at deploy time. Nothing detects this. |
| No per-module functional check | No assertion that e.g. the twin returns chunks, or a queued notification drains correctly. |
| No morning_digest visibility | Deploys are not surfaced at all. Colin discovers deploy failures via symptoms (stalled tasks, silent Telegram), not metrics. |

### The actual failure mode (2026-04-26)

PR merged to main. Vercel's production build succeeded (build logs clean). However,
Vercel Hobby plan rejected the new cron entry because the project already had 2 hourly
crons registered — the limit. The new cron (`deploy-gate-runner`) silently did not appear
in the Vercel cron schedule. No alert fired. Colin noticed ~12 hours later when queued
tasks hadn't moved.

**Root cause:** the gate verified preview readiness and mergeability, but never checked
whether the production deployment registered its cron jobs correctly.

### Health endpoint audit

`app/api/health/route.ts` is 8 lines:
```typescript
return NextResponse.json({
  ok: true,
  commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  timestamp: new Date().toISOString(),
})
```

The `commit` field is the key useful signal here — it can verify that the production
deployment is serving the expected commit SHA after a merge. Currently unused by any
automated check.

---

## 2 — Design

### Signal source: Vercel API polling (same as current gate)

The existing gate uses `GET https://api.vercel.com/v6/deployments?target=preview&...`
to check preview state. The same API supports `target=production`. No new webhook
infrastructure required — extend the polling pattern.

### Three-layer smoke test

| Layer | Name | Check | Failure action |
|-------|------|-------|---------------|
| **L1** | Build | Vercel production deployment reaches `READY` state within 10 min of merge | Telegram alert + incident task |
| **L2** | Route health | `/api/health` returns HTTP 200 with `commit` matching the merged SHA | Telegram alert + incident task |
| **L3** | Functional | Module-specific: cron registration, endpoint shape, data retrieval | Telegram alert + incident task per module |

Layer 3 is opt-in per module. Layers 1 and 2 run on every merge automatically.

### Trigger: extend deploy-gate-runner, not a new cron

When `mergeToMain` succeeds, write a new `agent_events` row:

```typescript
{
  domain: 'orchestrator',
  action: 'production_smoke_pending',
  actor: 'deploy-gate',
  status: 'success',
  meta: { merge_sha, branch, commit_sha, merged_at }
}
```

The existing `deploy-gate-runner` cron picks up `production_smoke_pending` events
(same query pattern it uses for `deploy_gate_triggered`) and runs the smoke sequence.
No new cron endpoint needed.

### Per-module smoke test registry

`lib/harness/smoke-tests.ts` — a static registry:

```typescript
export interface ModuleSmokeTest {
  module: string
  layer: 3
  run: (baseUrl: string) => Promise<{ passed: boolean; detail: string }>
}

export const SMOKE_TESTS: ModuleSmokeTest[] = [
  {
    module: 'cron-registration',
    layer: 3,
    async run(baseUrl) {
      // Verify Vercel cron list matches vercel.json entries via Vercel API
      // GET https://api.vercel.com/v1/projects/{id}/crons
      // Compare against vercel.json crons[*].path
      ...
    },
  },
  {
    module: 'twin',
    layer: 3,
    async run(baseUrl) {
      // POST /api/twin/ask { question: "smoke test" }
      // Expect 200 + { sources_count: N } (may be 0 — just check shape, not content)
      ...
    },
  },
  {
    module: 'telegram-webhook',
    layer: 3,
    async run(baseUrl) {
      // GET /api/telegram/webhook → should 405 (method not allowed, POST only)
      // 405 = registered and running. 404 = not deployed.
      ...
    },
  },
]
```

New modules add their smoke test to this registry as part of their acceptance doc.
The F18 pattern already requires metrics capture — smoke test registration is the
deploy-time companion.

### Deduplication and idempotency

Same pattern as budget-summary dedup: check `agent_events` for
`action='production_smoke_complete'` with `meta.merge_sha` before running. Prevents
double-fire if deploy-gate-runner ticks twice while smoke is still pending.

### Result recording

On completion:

```typescript
// agent_events INSERT
{
  domain: 'orchestrator',
  action: 'production_smoke_complete',
  actor: 'deploy-gate',
  status: 'success' | 'error',
  meta: {
    merge_sha,
    commit_sha,
    l1_passed: boolean,
    l2_passed: boolean,
    l3_results: [{ module, passed, detail }],
    duration_ms,
    production_url
  }
}
```

On failure: also insert `outbound_notifications` row (Telegram alert) AND insert
`task_queue` row:
```typescript
{
  task: 'Investigate production smoke test failure',
  description: `Deploy ${merge_sha.slice(0,8)} failed: ${failureDetail}`,
  priority: 1,   // P1 — production broken
  source: 'cron',
  metadata: { merge_sha, failed_layers, failed_modules }
}
```

### morning_digest line

```
Deploys (24h): 3 | smoke tests: 3/3 ✓
```
or:
```
Deploys (24h): 3 | smoke tests: 2/3 — 1 FAILED (cron-registration, 14:22 UTC)
```

---

## 3 — Acceptance Criteria

**(a) L1 — build verification**
After a merge to main, within 15 minutes, `agent_events` contains
`action='production_smoke_complete'` with `meta.l1_passed=true` and
`meta.commit_sha` matching the merged PR.

**(b) L2 — commit SHA verification**
`meta.l2_passed=true` only when `/api/health` returns `{ ok: true }` AND
`commit` field matches the merged SHA. A prior-commit response (cold start lag)
retries up to 3× with 60s delay before failing L2.

**(c) L3 — cron registration**
`SMOKE_TESTS` registry entry for `cron-registration` passes when Vercel API
returns all paths from `vercel.json crons[*].path` as registered. Fails if
any path is absent. This is the specific failure mode from 2026-04-26.

**(d) L3 — twin**
`POST /api/twin/ask { question: "smoke test" }` returns HTTP 200 with a valid
`TwinResponse` shape (has `answer`, `sources`, `escalate`, `retrieval_path`).
Does not require non-empty sources — just shape validity.

**(e) Telegram alert on failure**
Any layer failure fires an `outbound_notifications` row within 30 seconds of
detecting the failure.

**(f) Incident task on failure**
Any layer failure inserts a `task_queue` row with `priority=1` within 30 seconds.

**(g) Dedup**
Triggering the smoke runner twice on the same `merge_sha` runs the smoke exactly
once. Second call is a no-op (idempotent guard via `agent_events` check).

**(h) morning_digest line**
`sendMorningDigest()` includes a deploy smoke line showing: N deploys in 24h,
M/N smoke tests passed, latest failure detail if any.

**(i) Pre-existing deploy gate unaffected**
All 40+ existing `deploy-gate.test.ts` tests still pass after this change.

---

## 4 — Files Expected to Change

| File | Change |
|------|--------|
| `lib/harness/smoke-tests.ts` | New — `SMOKE_TESTS` registry + `runAllSmokeTests(baseUrl, commitSha)` |
| `lib/harness/deploy-gate.ts` | Update — after successful `mergeToMain`, write `production_smoke_pending` event; add `runProductionSmoke(mergeSha)` function |
| `app/api/cron/deploy-gate-runner/route.ts` | Update — add query for `production_smoke_pending` events alongside existing `deploy_gate_triggered` query; call `runProductionSmoke` |
| `lib/orchestrator/digest.ts` | Update — add `buildDeploySmokeStatsLine()` function, wire into digest output |
| `tests/harness/smoke-tests.test.ts` | New — unit tests for registry + L1/L2/L3 checks |
| `tests/harness/deploy-gate.test.ts` | Update — add tests for production smoke trigger and `production_smoke_complete` event |

No new migrations needed. Uses existing `agent_events`, `task_queue`, `outbound_notifications`.

---

## 5 — Open Questions (for Colin to resolve before build)

**Q1: Vercel cron registration check — API availability**
Vercel's `GET /v1/projects/{id}/crons` may be a Pro-only endpoint. If unavailable on
Hobby, the cron-registration L3 check must fall back to inferring from `vercel.json`
versus a Vercel deployment metadata endpoint. Builder must verify before coding.
→ Default recommendation: attempt the crons endpoint; if 403, skip L3 cron check and
log `cron_registration_check: 'unavailable_on_hobby_plan'` in the smoke result.

**Q2: Cold-start lag on L2 (commit SHA mismatch)**
After a production deploy, Vercel edge functions may serve requests from a warmed
instance of the prior deploy for several minutes. `/api/health` returning the old
commit SHA during this window would be a false L2 failure.
→ Default recommendation: retry L2 up to 3× with 90s intervals (total 4.5 min) before
failing. Log each retry attempt in meta.

**Q3: L3 smoke tests — network path**
L3 tests call the production URL from within a Vercel serverless function. This is a
self-call (Vercel → Vercel). Should work but adds latency.
→ Default recommendation: use `LEPIOS_BASE_URL` (already in `harness_config`) as base URL
for all L3 calls. Same pattern as existing drain self-trigger.

---

## 6 — Effort Estimate

| Work item | Estimate |
|-----------|---------|
| `smoke-tests.ts` registry + L1/L2/L3 logic | 3–4h |
| `deploy-gate.ts` + `deploy-gate-runner` extensions | 2h |
| `smoke-tests.test.ts` (unit + dedup tests) | 3h |
| `deploy-gate.test.ts` additions | 2h |
| `digest.ts` smoke stats line | 1h |
| **Total** | **~12h (1.5 builder days)** |

Fits in one sprint chunk. No migrations. No new cron endpoints.

---

## 7 — Recommended First Module to Instrument

**`cron-registration`** — because it's the exact failure that happened. Every other
L3 module test catches broken endpoints; this one catches the silent infrastructure
rejection that the gate currently has no visibility into. It's also the highest
Colin-time cost per incident (12h blind spot).

Build order:
1. L1 + L2 (always-on for every merge) — highest ROI, no registry needed
2. `cron-registration` L3 module — catches the known failure mode
3. `twin` L3 module — validates the newly-repaired twin endpoint post-deploy
4. `telegram-webhook` L3 module — confirms bot connectivity on every deploy

---

## 8 — What This Does NOT Do

- Real-time monitoring (this is deploy-time only, not continuous)
- Rollback on smoke failure (human decision — incident task routes to Colin)
- Database health check within `/api/health` (separate concern; add there if needed)
- Multiple environment support (production only; staging/preview is already handled by gate)
- Synthetic load testing or performance assertions
