# Overnight Autonomy — Acceptance Doc

Status: **partially shipped 2026-05-07** — bootstrap landed, follow-ups queued (see §13)
Author: Claude (main session, 2026-05-07)
Greenfield: no — closes the last two gaps in an existing harness
Replaces / extends: harness component #5 (task pickup), component #6 (deploy gate), self-repair pipeline

---

## 1. Why this exists

Goal in Colin's words: _"set a prompt … so it will continuously work, repair, push, commit, so I can come back and it literally ran all night until I woke up."_

The harness is closer than it feels. State of play (verified 2026-05-07):

| Capability                                          | Shipped? | Evidence                                                                                             |
| --------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| Task queue (Supabase, hourly cron pickup)           | ✅       | `task_queue` table; `0 * * * *` in `vercel.json`; AC-3 in `task-pickup-100-acceptance.md`            |
| Heartbeat + 15-min stale recovery                   | ✅       | `app/api/harness/task-heartbeat/route.ts`; migration 0021                                            |
| Remote coordinator invocation (no Colin paste)      | ✅       | `app/api/harness/invoke-coordinator/route.ts` → `fireCoordinator()`                                  |
| Deploy gate, smoke check, auto-merge non-migrations | ✅       | `app/api/cron/deploy-gate-runner/route.ts:208` reads `DEPLOY_GATE_AUTO_PROMOTE !== '0'` (default ON) |
| Migration-touching diffs gate on human Telegram tap | ✅       | Component #6 §3.4 + Chunk H                                                                          |
| Daily failure-detect → draft fix → open PR          | ✅       | `app/api/harness/self-repair-tick/route.ts`, schedule `0 3 * * *`                                    |

What is **not** shipped, and what blocks "all-night autonomous":

1. **Self-repair PRs never merge.** `tests/self-repair/no-auto-merge.test.ts` enforces this at the source level (AD2). A draft fix sits in a PR until Colin merges it — so nothing actually self-heals overnight; it accumulates PRs.
2. **Auto-promote criteria are too coarse.** Today the gate's only filter is "no migration files." Anything else is fair game — including 5,000-line diffs, env changes, RLS edits, or new dependencies. Acceptable for hand-driven harness work; insufficient if the gate is expected to merge agent-authored fixes overnight without Colin in the loop.
3. **Queue is hand-filled.** Tasks only enter `task_queue` via Colin's `INSERT`. There is no agent that watches the system, identifies gaps, and stages well-formed tasks. So even with end-to-end autonomy on the execution side, the input side is still bottlenecked on Colin.

This doc closes (1)+(2) as **Module A** and (3) as **Module B**. Both are required for the overnight loop to actually work.

---

## 2. Scope

### In scope

**Module A — Risk-tiered auto-promote + self-repair auto-merge**

- New env-driven config: `DEPLOY_GATE_RISK_TIER` selects which promotions auto-merge (`off`, `low`, `medium`, `migration-allow`)
- Risk classifier added to `lib/harness/deploy-gate.ts` — pure function, returns `{tier, reasons[]}`
- Self-repair PRs routed through deploy gate (push to `harness/task-{task_id}` branch, call trigger endpoint) instead of opening a plain PR against main
- AD2 amendment: replace "never auto-merge" with "never auto-merge unless deploy-gate risk tier permits"
- `no-auto-merge.test.ts` retired and replaced with `risk-tier-classification.test.ts`

**Module B — Queue pre-stager**

- New table: `task_proposals` (proposed-but-not-yet-queued tasks, with source + confidence + risk score)
- New cron route: `app/api/cron/queue-prestage/route.ts`, schedule `0 21 * * *` (21:00 UTC = 14:00 MT, well before night_tick)
- Five proposal sources, each a thin function in `lib/harness/prestage/sources/`:
  - `from_failures.ts` — unresolved entries in `failures.md` not yet matched to a task
  - `from_env_audit.ts` — follow-ups in `docs/env-audit-*.md` flagged severity ≥ medium
  - `from_gpu_day_gaps.ts` — `gpu-day-readiness.md` line items at <100% with no live task
  - `from_self_repair_dlq.ts` — failures the self-repair pipeline gave up on (failure_type='unrepeatable')
  - `from_morning_digest.ts` — anomalies surfaced in last 7 digests (latency spikes, friction-index regressions)
- Auto-promotion rule: a proposal becomes a `task_queue` row when (a) confidence ≥ 0.8 AND (b) risk_score ≤ tier ceiling. Otherwise it sits in `task_proposals` waiting for Colin.
- Telegram digest extension: morning digest reports "queue: N tasks (M auto-staged), proposals waiting: K"

### Out of scope

- Self-rewriting acceptance docs (proposals carry a description; coordinator still drafts the actual acceptance doc in Phase 1)
- New ML models — proposal sources are deterministic / heuristic
- Migration of self-repair to use `task_queue` (it stays as its own pipeline; only the merge path changes)
- Per-source priority weights (single combined scoring function for v1)
- A "rollback the rollback" loop (rollback decisions stay one-shot)
- Auto-resolving migration gates — those still require human tap, regardless of risk tier

---

## 3. Module A — Risk-tiered auto-promote

### 3.1 Risk tiers

| Tier              | What auto-merges                  | Diff size cap                 | File-type rules                                                                                                                                                                                                                            |
| ----------------- | --------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `off`             | nothing                           | n/a                           | gate runs all checks but never merges; logs `deploy_gate_promotion_skipped` (existing behavior of `DEPLOY_GATE_AUTO_PROMOTE=0`)                                                                                                            |
| `low` _(default)_ | code-only fixes that pass smoke   | ≤ 200 added lines, ≤ 5 files  | no shared seam files (see CLAUDE.md `.claude/CLAUDE.md` seam list); no `package.json` / `package-lock.json`; no `app/api/**/route.ts` net-new files; no `supabase/migrations/**`; no `.env*`                                               |
| `medium`          | low-tier criteria, relaxed        | ≤ 800 added lines, ≤ 15 files | route handlers in scope; new files allowed; still no shared seams; still no migrations                                                                                                                                                     |
| `migration-allow` | medium-tier criteria + migrations | ≤ 800 added lines             | migrations allowed if they match the **additive allowlist** in component #6 §9 Q4 v1 (CREATE TABLE, ADD COLUMN nullable, CREATE INDEX CONCURRENTLY, CREATE POLICY, CREATE FUNCTION, CREATE TYPE). Destructive patterns still gate on Colin |

`DEPLOY_GATE_RISK_TIER` is read from `harness_config` (not `process.env`) per S-L1. Default value seeded as `low`.

### 3.2 Classifier

Pure function:

```ts
// lib/harness/deploy-gate.ts
export type RiskTier = 'off' | 'low' | 'medium' | 'migration-allow'

export type ClassifyInput = {
  changed_files: string[] // from GitHub diff API (already used for migration detection)
  added_lines: number // from diff stats
  removed_lines: number
  diff_text: string // for additive-migration regex check
}

export type ClassifyResult = {
  required_tier: RiskTier // minimum tier that allows auto-merge
  reasons: string[] // human-readable, e.g. ["touches package.json", "diff size 412 > 200"]
}

export function classifyRisk(input: ClassifyInput): ClassifyResult
```

Decision order (first match wins, escalating):

1. Any shared-seam file → `off` (always require human)
2. Any migration not in additive allowlist → `off`
3. Any `.env*` change → `off`
4. Touches migrations (additive only) → `migration-allow`
5. `added_lines > 200` OR file count > 5 → `medium`
6. Otherwise → `low`

The cron compares `classifyRisk(...).required_tier` against the configured `DEPLOY_GATE_RISK_TIER`. Auto-merge fires when configured tier ≥ required tier (treating off < low < medium < migration-allow). Otherwise: log `deploy_gate_promotion_skipped`, attach `meta.required_tier` and `meta.configured_tier`, fall through to existing Telegram-with-buttons path.

### 3.3 Self-repair PR rerouting

Self-repair currently calls `openPR()` (PR against main, requires Colin merge). Change `lib/harness/self-repair/pr-opener.ts` to:

1. Push the fix to `harness/task-self-repair-{run_id}` (matches existing branch convention from component #6).
2. Insert a `task_queue` row with `source='self_repair'`, `status='claimed'` (skips pickup; coordinator already has the work), and `metadata.run_id` linking back to `self_repair_runs`.
3. Call `POST /api/harness/deploy-gate/trigger` with the new branch + commit SHA + `tests_passed: true` if `verifyDraft()` returned green.

The deploy gate then runs its existing flow. Risk tier classifies the diff. If it auto-merges → fix is live. If it doesn't (e.g., medium-tier diff with `tier=low` configured) → existing Telegram review path catches it.

This **closes AD2** without removing the safety. The hard barrier ("never silently change production") is now enforced by the gate's risk classifier, not by the self-repair module's source code.

### 3.4 Tests retired vs added

| File                                             | Action                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/self-repair/no-auto-merge.test.ts`        | **Retire.** Source-level "never call mergeToMain" assertion is no longer the right invariant.                                                                                                                                                                   |
| `tests/harness/risk-tier-classification.test.ts` | **New.** 8+ cases covering each decision branch + boundary conditions (199/200/201 lines, 5/6 files, additive vs destructive migration regex).                                                                                                                  |
| `tests/harness/deploy-gate.test.ts`              | **Extend.** Add cases: tier=off blocks everything, tier=low promotes a 50-line code-only diff, tier=low refuses a `package.json` edit, tier=medium promotes a 400-line route addition, migration-allow promotes additive-only migration but blocks DROP COLUMN. |
| `tests/self-repair/auto-merge-via-gate.test.ts`  | **New.** End-to-end mock: `pr-opener.ts` pushes branch → gate trigger called → mock gate auto-merges → `self_repair_runs.status` ends as `merged`.                                                                                                              |

### 3.5 New env / config

Stored in `harness_config` (Supabase), not `process.env`:

| Key                              | Default | Notes                                                                              |
| -------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `DEPLOY_GATE_RISK_TIER`          | `low`   | Single tier covering both human-authored harness branches AND self-repair branches |
| `SELF_REPAIR_AUTO_MERGE_ENABLED` | `false` | Phase rollout: ship Module A with this off, observe for a week, then flip on       |

Gate at runtime reads `DEPLOY_GATE_RISK_TIER`. Self-repair `pr-opener.ts` reads `SELF_REPAIR_AUTO_MERGE_ENABLED` — if false, it falls back to the current openPR() behavior (no behavior change). This decouples shipping the classifier from enabling self-repair auto-merge.

---

## 4. Module B — Queue pre-stager

### 4.1 Migration

`supabase/migrations/0160_task_proposals.sql` (next free per `ls supabase/migrations | tail -1` = 0159).

```sql
CREATE TABLE public.task_proposals (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  task          TEXT         NOT NULL,
  description   TEXT,
  source        TEXT         NOT NULL
                CHECK (source IN ('failures_md','env_audit','gpu_day_gap','self_repair_dlq','morning_digest','manual')),
  source_ref    TEXT,                       -- file path / line / failure id, for dedup
  confidence    NUMERIC(3,2) NOT NULL,      -- 0.00 - 1.00
  risk_score    SMALLINT     NOT NULL,      -- 0 (lowest) - 100; mapped to tier at promotion time
  proposed_priority SMALLINT NOT NULL DEFAULT 5,
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT         NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','promoted','dismissed','superseded')),
  promoted_task_id UUID      REFERENCES public.task_queue(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);

CREATE INDEX task_proposals_pending_idx
  ON public.task_proposals (status, confidence DESC, created_at DESC)
  WHERE status = 'pending';

CREATE UNIQUE INDEX task_proposals_dedup_idx
  ON public.task_proposals (source, source_ref)
  WHERE source_ref IS NOT NULL AND status IN ('pending','promoted');

ALTER TABLE public.task_proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task_proposals_authenticated" ON public.task_proposals
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
```

**Why a `task_proposals` table and not direct insert into `task_queue`:**
A pre-stager that always wrote directly to `task_queue` would push everything it found, regardless of confidence. That's how queues become poisoned (F-L7 sibling). Two-tier (proposal → review → promote) lets Colin see what the system _would_ queue, and lets the auto-promote rule be tightened or loosened per source without changing source code.

### 4.2 Cron + sources

Schedule: `0 21 * * *` (21:00 UTC / 14:00 MT). Three-hour gap before night_tick (00:00 UTC). Doesn't compete with task-pickup (top of every hour) — pre-stager runs once daily at a fixed slot.

Each source returns `{task: string, description: string, source_ref: string, confidence: number, risk_score: number, metadata: object}[]`. The cron:

1. Calls each source.
2. Dedups against existing pending/promoted proposals (unique index `(source, source_ref)`).
3. Inserts new proposals.
4. For each new proposal: if `confidence >= 0.8 AND risk_score <= ceiling` → INSERT into `task_queue`, mark proposal `status='promoted'`. Ceiling per `DEPLOY_GATE_RISK_TIER`: `low`=20, `medium`=50, `migration-allow`=70, `off`=100 (never auto-promotes from proposals; everything waits for Colin).
5. Logs a single `agent_events` row with `task_type='queue_prestage'`, meta = counts per source + counts auto-promoted vs held.

### 4.3 Source: `from_failures.ts`

Reads `docs/claude-md/failures.md` + the legacy F-L block in `lepios/CLAUDE.md`. For each F-N / F-L entry:

- Extract title, body, "→" follow-up sentence.
- `source_ref = 'F-N{n}'` or `'F-L{n}'` (the F-number is the dedup key).
- Confidence = 0.6 base; +0.2 if entry contains "Queue task:" (Colin-flagged); +0.2 if rule registry shows no existing task references this F-number.
- Risk score = 30 base; +20 if entry mentions migration, RLS, or deploy gate; -10 if entry is doc-only (mentions "doc" or "spec" but not code).

### 4.4 Source: `from_env_audit.ts`

Reads the most recent `docs/env-audit-*.md`. For each follow-up flagged severity ≥ medium with no resolution date:

- `source_ref = audit_filename + '#' + section_title`
- Confidence = 0.7 base; +0.2 if severity = high.
- Risk score = 40 base (env changes touch shared seam).

### 4.5 Source: `from_gpu_day_gaps.ts`

Parses `docs/gpu-day-readiness.md` line-item table. For each line at <100% with no row in `task_queue` matching its name:

- `source_ref = 'gpu-day:' + line_id` (e.g. `gpu-day:A4`)
- Confidence = 0.5 + (weight / 20); higher-weight gaps are higher-confidence proposals.
- Risk score = 25 (mostly doc/decision work; rarely deploy-impacting).

### 4.6 Source: `from_self_repair_dlq.ts`

Queries `self_repair_runs` for rows where `status='escalated'` (existing column) older than 24h with no follow-up task. Self-repair can fail to draft a fix; those failures shouldn't sit silently.

- `source_ref = 'self-repair-run:' + run_id`
- Confidence = 0.5 (failure is real but root cause may need human eyes).
- Risk score = 50.

### 4.7 Source: `from_morning_digest.ts`

Read last 7 morning_digest agent_events rows. Heuristic anomaly detection (no ML): if `meta.pickup_latency_p95_ms` jumped >2× over 7-day median, propose a "investigate pickup latency regression" task.

- `source_ref = 'digest-anomaly:' + ISO_date`
- Confidence = 0.4 (anomalies are noisy by nature).
- Risk score = 30.

### 4.8 Risk score ↔ tier mapping

Risk score is a 0–100 integer; the gate tier system is categorical. Mapping at promotion time:

| Risk score range | Mapped tier required          |
| ---------------- | ----------------------------- |
| 0–20             | `low`                         |
| 21–50            | `medium`                      |
| 51–70            | `migration-allow`             |
| 71–100           | `off` (always wait for Colin) |

If `DEPLOY_GATE_RISK_TIER` is `low`, only proposals with risk_score ≤ 20 auto-stage. The rest accumulate in `task_proposals` for Colin's morning review.

---

## 5. Acceptance criteria

Machine-checkable. Tests written and passing before merge.

### AC-A1 (Module A): risk classifier covers all decision branches

Run `tests/harness/risk-tier-classification.test.ts`. All 8+ cases pass:

- empty diff → `low`
- 50 lines, 2 files, no special paths → `low`
- 250 lines → `medium`
- 6 files → `medium`
- touches `package.json` → `off`
- touches `app/layout.tsx` (shared seam) → `off`
- additive migration (`CREATE TABLE foo (...)`) → `migration-allow`
- destructive migration (`DROP COLUMN foo`) → `off`
- `.env.example` change → `off`

### AC-A2 (Module A): gate respects configured tier

With `DEPLOY_GATE_RISK_TIER='low'` in `harness_config`:

- A 50-line code-only PR auto-merges (existing behavior preserved).
- A 250-line route addition does NOT auto-merge — `deploy_gate_promotion_skipped` logged with `meta.required_tier='medium'`, `meta.configured_tier='low'`, Telegram alert with promote/abort buttons.

### AC-A3 (Module A): self-repair auto-merge gated by feature flag

With `SELF_REPAIR_AUTO_MERGE_ENABLED='false'`: self-repair opens a plain PR (existing behavior), no `harness/task-self-repair-*` branch created, no gate trigger called.
With `SELF_REPAIR_AUTO_MERGE_ENABLED='true'`: self-repair pushes to `harness/task-self-repair-{run_id}`, gate trigger called, gate evaluates per AC-A1/A2 logic.

### AC-A4 (Module A): `no-auto-merge.test.ts` retired only when classifier is in place

Migration order enforced by reviewer: PR cannot delete `no-auto-merge.test.ts` unless `risk-tier-classification.test.ts` exists and passes in the same PR.

### AC-B1 (Module B): table + indexes match spec

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'task_proposals'
ORDER BY ordinal_position;
```

Match §4.1 column list exactly. Both indexes present.

### AC-B2 (Module B): each source produces at least one proposal on a known fixture

Test fixture: `tests/fixtures/prestage/` with a stub `failures.md`, `env-audit-fixture.md`, `gpu-day-readiness-fixture.md`, mock `self_repair_runs` rows, mock digest rows. Each source returns ≥1 proposal with all required fields populated.

### AC-B3 (Module B): dedup prevents double-staging

Run cron twice in succession. Second run: 0 new proposals inserted (unique index on `(source, source_ref)`). agent_events shows two `queue_prestage` rows; second has `meta.new_proposals=0`.

### AC-B4 (Module B): auto-promotion respects tier ceiling

With `DEPLOY_GATE_RISK_TIER='low'` (ceiling=20):

- A proposal with `confidence=0.9, risk_score=15` → auto-promoted (status='promoted', `task_queue` row exists with `source='self_repair_dlq'` etc.).
- A proposal with `confidence=0.9, risk_score=45` → status='pending', no `task_queue` row.

### AC-B5 (Module B): morning digest surfaces queue + proposal counts

Manually invoke `/api/cron/morning-digest`. Resulting Telegram message includes one line of the form: `queue: 3 active (1 auto-staged), proposals waiting: 5`.

### AC-C1 (cross-module): existing 370+ tests still pass

`npm test` green on the integration branch before merge.

### AC-C2 (cross-module): observability event logged

Both new crons (`queue-prestage`, the existing gate-runner with new classifier path) write `agent_events` with sufficient meta to reconstruct decisions: every promotion-skipped row carries `required_tier` + `configured_tier`; every `queue_prestage` row carries per-source proposal counts and auto-promotion split.

---

## 6. Rollout

Phased — do not flip the whole loop on at once.

1. **Migration** — apply `0160_task_proposals.sql`. Verify table.
2. **Module A code merged, both flags off** — `DEPLOY_GATE_RISK_TIER='off'`, `SELF_REPAIR_AUTO_MERGE_ENABLED='false'`. Classifier runs on every gate invocation but never auto-merges. Logs `deploy_gate_promotion_skipped` with classifier output. **Observe for 7 days** — read the logs, confirm classifier matches your intuition on each diff. Adjust.
3. **Flip to `low`** — `DEPLOY_GATE_RISK_TIER='low'`. Self-repair still off. Now hand-driven harness PRs auto-merge if they're small + code-only. Same as today's behavior but with the new spec language; gives you a week of testing the classifier on real diffs.
4. **Module B code merged, sources off** — pre-stager cron runs but every source returns `[]`. Verifies the cron itself is healthy.
5. **Enable sources one by one** — start with `from_gpu_day_gaps.ts` (lowest blast radius — proposals only). Confirm proposals look reasonable. Then `from_failures.ts`, then env-audit, then self-repair-dlq, then digest-anomaly.
6. **Flip `SELF_REPAIR_AUTO_MERGE_ENABLED='true'`** — only after 7 days of clean classifier behavior on hand-driven branches. This is the final unlock; once it's on, the loop closes.

Fast disable (any phase): set `DEPLOY_GATE_RISK_TIER='off'` in `harness_config`. All gate auto-merges stop on next invocation. No redeploy needed.

---

## 7. Open questions

**Q1 — Should `risk_score` and `confidence` be tunable per-source from `harness_config`?**
Hardcoded heuristics will drift. Probably yes — defer to a follow-up acceptance doc once we have ≥30 days of pre-stager output to calibrate against.

**Q2 — Self-repair branch naming.**
Component #6 expects `harness/task-{task_id}` where `task_id` is a UUID. Self-repair runs are also UUIDs. Use `harness/task-{run_id}` directly, OR introduce a synthetic task_queue row first and use that id? Spec proposes the latter — self-repair inserts a `task_queue` row with `source='self_repair'` so attribution and the existing branch-parser work without special-casing.

**Q3 — Migration risk allowlist owner.**
The additive-allowlist regex lives in `lib/harness/deploy-gate.ts` per Component #6 §9 Q4 v1. Build it with this work, or split into a follow-up? Recommendation: **split**. Module A ships with the allowlist returning `false` for everything (i.e., all migrations route to `off`), so the migration tier exists in the schema but is never reachable until the allowlist is implemented. Keeps this scope tight.

**Q4 — Pre-stager confidence floor for auto-promotion.**
0.8 is a guess. Right answer is "whatever empirically produces <5% bad auto-stages" but we don't have data yet. Ship with 0.8, log every promote/hold decision, revisit after 14 days.

**Q5 — Should pre-stager run more than once a day?**
Daily means a proposal sits up to 24h before staging. Hourly means more chance of noisy proposals (env audit doesn't change hourly). Stay daily for v1. Upgrade to "every 4 hours" if the queue starts running dry between night_tick and morning_digest.

**Q6 — What about the dependency on Cline / Ollama for self-repair drafting?**
Self-repair already exists as-is, so this doc doesn't change the drafter. But: if self-repair drafts a fix using Ollama (Tier 1) and it's wrong, the gate could merge it overnight before Colin reviews. Mitigation: classifier risk score considers `meta.drafter_tier` — Ollama-drafted fixes get +20 risk score, pushing them out of `low` tier and forcing the medium-tier or human-review path. Worth adding? Recommendation: **yes, ship with this in v1.** Cheap signal.

---

## 8. Files expected to change

| File                                                          | Action      | Notes                                                                           |
| ------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `supabase/migrations/0160_task_proposals.sql`                 | New         | Verify next migration number before writing                                     |
| `lib/harness/deploy-gate.ts`                                  | Beef up     | Add `classifyRisk()`, no behavior change to existing exports                    |
| `app/api/cron/deploy-gate-runner/route.ts`                    | Beef up     | Read `DEPLOY_GATE_RISK_TIER` from `harness_config`, branch on classifier result |
| `lib/harness/self-repair/pr-opener.ts`                        | Beef up     | Add gate-trigger path behind `SELF_REPAIR_AUTO_MERGE_ENABLED` flag              |
| `lib/harness/prestage/index.ts`                               | New         | Source registry + cron entrypoint                                               |
| `lib/harness/prestage/sources/from_*.ts`                      | New (×5)    | One per source                                                                  |
| `app/api/cron/queue-prestage/route.ts`                        | New         | Auth + invoke registry                                                          |
| `vercel.json`                                                 | Edit (seam) | Add `{ "path": "/api/cron/queue-prestage", "schedule": "0 21 * * *" }`          |
| `tests/harness/risk-tier-classification.test.ts`              | New         | Module A core test                                                              |
| `tests/harness/prestage-sources.test.ts`                      | New         | Module B per-source tests with fixtures                                         |
| `tests/fixtures/prestage/*`                                   | New         | Fixture files for sources                                                       |
| `tests/self-repair/no-auto-merge.test.ts`                     | Delete      | Replaced by classifier tests                                                    |
| `tests/self-repair/auto-merge-via-gate.test.ts`               | New         | End-to-end self-repair → gate flow                                              |
| `lib/harness/morning-digest.ts` (or wherever digest is built) | Beef up     | Add queue + proposal count line                                                 |
| `harness_config` rows (no migration; runtime insert)          | Add         | `DEPLOY_GATE_RISK_TIER='off'`, `SELF_REPAIR_AUTO_MERGE_ENABLED='false'`         |

**Do not touch:**

- `task_queue` schema (no column changes)
- `self_repair_runs` schema (use existing `escalated` status)
- `lib/auth/cron-secret.ts` (F22 helper used as-is)
- `vercel.json` task-pickup or self-repair entries (separate crons; pre-stager is additive)

---

## 9. Measurement (F18)

```yaml
module: overnight-autonomy
metric_name: autonomous-completion rate + nighttime-quiet rate
units:
  - autonomous_completion_rate: tasks completed start-to-finish without Colin in the loop / total claimed
  - nighttime_quiet_rate: nights (00:00–08:00 MT) where Colin received no FAIL alerts AND queue was processed
  - false_promote_rate: PRs auto-merged then reverted within 24h / total auto-merged
capture_method: |
  autonomous_completion_rate = COUNT(task_queue WHERE status='completed' AND no agent_events with task_type='colin_intervention' tied to task_id) / COUNT(claimed)
  nighttime_quiet_rate = nights with zero outbound_notifications of severity='fail' between 00:00-08:00 MT / total nights
  false_promote_rate = COUNT(deploy_gate_rolled_back rows where roll_back_reason != 'colin_explicit') / COUNT(deploy_gate_promoted)
benchmark:
  - autonomous_completion_rate ≥ 0.7 (target). Baseline today: ≈0 (every task needs a Colin paste somewhere)
  - nighttime_quiet_rate ≥ 0.85 over rolling 7 nights
  - false_promote_rate ≤ 0.05 (1 in 20)
surfacing_path: |
  morning_digest extends to include:
    - "autonomy: 4/5 tasks last 24h closed without intervention"
    - "nights quiet: 6 of last 7"
    - "false promotes: 0 of last 12 auto-merges"
alert_threshold: |
  - false_promote_rate > 0.10 over a rolling window of 10 promotes → demote DEPLOY_GATE_RISK_TIER one step automatically + Telegram alert
  - autonomous_completion_rate < 0.4 for 5 days → flag in digest, candidate for revisit (likely a bottleneck Colin can fix)
```

---

## 10. Engine-feeding (F17)

| Signal                                             | Path to engine                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-task `colin_intervention` events               | Direct measure of "where the autonomous loop still bottlenecks on Colin" — input to which source/path probabilities to expand                        |
| Risk classifier `required_tier` distribution       | Tells us which tier should be the default in steady state — currently we assume `low`, but if 90% of harness diffs are medium-tier, the bar is wrong |
| Pre-stager source acceptance rate (promoted/total) | Per-source quality signal — sources with <30% acceptance get pruned or downweighted                                                                  |
| `self_repair_runs.status='merged'` rate            | The single tightest signal for "the loop closes overnight" — should trend up after `SELF_REPAIR_AUTO_MERGE_ENABLED='true'`                           |
| `nighttime_quiet_rate`                             | Cumulative measure of "Colin sleeps undisturbed" — the prime objective of this whole module                                                          |

---

## 11. The "set a prompt and walk away" question

Colin's specific ask: a prompt he can fire that runs the whole loop overnight. The honest answer:

**You don't need a prompt — once both modules ship and the flags flip on, the harness IS the prompt.** The literal trigger is the existing `task-pickup` cron, which already invokes `fireCoordinator()` per claimed task. No human paste required after this acceptance doc lands.

What Colin should do at end-of-day to set up an overnight run, after both modules are live:

```sql
-- Optional: queue specific tasks you want done overnight
INSERT INTO task_queue (task, priority, source) VALUES
  ('Investigate pickup latency regression flagged in 2026-05-06 digest', 3, 'manual'),
  ('Resolve F-N7 follow-up — log entries duplicated on retry', 5, 'manual');
```

Then go to bed. Pre-stager fires at 14:00 MT (already past), pickup fires hourly all night, self-repair fires at 21:00 MT (3 AM UTC), gate auto-merges anything ≤ low-tier risk that passes smoke, Telegram only fires on FAIL.

Morning digest at 06:00 MT reports what happened.

If you wake up and the digest is silent — the loop ran clean and is waiting for input. That's the success state.

---

## 12. Kill signals

1. **`false_promote_rate > 0.10`** within first 14 days → demote tier automatically (or take to `off` if it spikes), Telegram alert. Do not manually "ride it out."
2. **Pre-stager poisons the queue** (>3 cancelled-on-max-retries from `source='self_repair_dlq'` in 48h) → disable that source via `harness_config`, queue diagnostic task.
3. **Classifier gives `low` to a diff that breaks production** — write the failure as F-N entry, identify the missing rule, add to classifier, write a test against that exact diff before re-enabling.
4. **Gate auto-merges a self-repair PR that was wrong but not detectable as wrong by smoke** — this is the existential risk of the whole feature. If it happens once, demote to `off` immediately, escalate, do not retry without spec change.

---

## Escalation summary

This is one acceptance doc covering two modules because they unblock the same outcome together: Module A without Module B leaves the queue empty all night. Module B without Module A leaves a queue full of tasks whose fixes pile up in PRs that never merge.

Recommendation:

- Colin reviews this doc and answers Q1–Q6 (mostly Q3 and Q6 are load-bearing).
- If approved: run the formal coordinator Phase 1 (Streamlit-equivalent study against existing harness code, twin Q&A, 20% Better) on a fresh window and produce the final acceptance doc this draft becomes input to.
- Builder ships Module A first, observe 7 days, then Module B.

Total weight estimate: **8–10 builder-windows** for Module A, **5–7** for Module B, plus observation time. ~3 weeks calendar at current cadence.

---

## 13. Bootstrap shipped 2026-05-07 — what landed and what didn't

### Shipped on `harness/overnight-autonomy-bootstrap`

- **Migration `0160_task_proposals.sql`** — Module B's landing table per §4.1.
- **`lib/harness/risk-classifier.ts`** — pure-function `classifyRisk()` + `tierPermits()` + `riskScoreToTier()`. Decisions per §3.1 / §3.2. Q3 baked in as "all migrations route to off until additive allowlist ships." Q6 baked in as "+20 risk if drafter_tier_hint='tier_1_laptop_ollama'."
- **`lib/harness/deploy-gate.ts`** — added `fetchDiffSummary()` for classifier input.
- **`app/api/cron/deploy-gate-runner/route.ts`** — `runAutoPromote` reads `DEPLOY_GATE_RISK_TIER` from `harness_config` (default `'low'`), runs the classifier, falls through to existing merge logic when permitted, logs `deploy_gate_promotion_skipped` with full reason set otherwise. `DEPLOY_GATE_AUTO_PROMOTE=0` retained as a hard kill switch (now logs the skip event instead of being silent).
- **`lib/harness/prestage/{types,index}.ts` + `sources/from_failures.ts`** — runner with source registry, dedup, auto-promote; `from_failures` source as the proof source.
- **`app/api/cron/queue-prestage/route.ts`** — cron entry, F22-compliant, supports `?dry=1`.
- **Tests**: `risk-tier-classification.test.ts` (29), `prestage-from-failures.test.ts` (8), `prestage-runner.test.ts` (6). Total 43 new green. Existing `deploy-gate.test.ts` updated for the new `deploy_gate_promotion_skipped` event in the kill-switch path. All 706 harness tests pass.

### Pre-existing test failures (unrelated; not introduced by this work)

- `tests/architecture/search-path-coverage.test.ts` (1) — F-N7 search_path
- `tests/auth/api-routes-locked-down.test.ts` (20) — diet/health route auth
- `tests/orchestrator/chat-summarize.test.ts` (3) — `status: 'ok' | 'pass'` field

These also fail on `main` with this branch's changes stashed. Do not block this PR.

### Not yet shipped — follow-up tasks (queue these into `task_queue`)

| #   | Task                                                                                                                                                                                                        | Notes                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Add `vercel.json` cron entry: `{ "path": "/api/cron/queue-prestage", "schedule": "0 21 * * *" }`                                                                                                            | Shared seam — needs `[seam-approved]` commit                                      |
| 2   | Seed `harness_config` rows: `DEPLOY_GATE_RISK_TIER='off'` (Phase 6 step 2 observe-only), `SELF_REPAIR_AUTO_MERGE_ENABLED='false'`, `PRESTAGE_SOURCE_FAILURES_MD_ENABLED='false'` (and four more, all false) | Direct SQL via Supabase Studio or MCP — privileged op                             |
| 3   | Apply migration `0160` to production Supabase                                                                                                                                                               | `mcp__claude_ai_Supabase__apply_migration` once Colin reviews the SQL             |
| 4   | Module A — self-repair PR rerouting in `lib/harness/self-repair/pr-opener.ts` (§3.3)                                                                                                                        | Behind `SELF_REPAIR_AUTO_MERGE_ENABLED` flag; preserves current behavior when off |
| 5   | Module A — retire `tests/self-repair/no-auto-merge.test.ts`, add `tests/self-repair/auto-merge-via-gate.test.ts` (§3.4)                                                                                     | Replaces source-level invariant with classifier+e2e tests; do AFTER #4            |
| 6   | Module B — implement `from_env_audit.ts`, `from_gpu_day_gaps.ts`, `from_self_repair_dlq.ts`, `from_morning_digest.ts` (§4.4–4.7)                                                                            | All four currently stubbed with empty array returns                               |
| 7   | Module B — fixture-based tests per source (§AC-B2)                                                                                                                                                          | `tests/fixtures/prestage/*` + 4 source tests                                      |
| 8   | Module A — additive-migration allowlist regex (Q3 follow-up)                                                                                                                                                | Lifts migrations from `off` → `migration-allow` for safe DDL                      |
| 9   | Morning-digest extension — surface queue/proposal counts and `nighttime_quiet_rate` (§AC-B5, §9 surfacing)                                                                                                  | Existing digest builder, add lines                                                |
| 10  | F18 metrics rollup query for `autonomous_completion_rate` and `false_promote_rate` (§9)                                                                                                                     | Surface in morning_digest after #9                                                |

### How to enable, after items 1–3 above land

```sql
-- Phase 6 step 2: observe-only — gate runs classifier but never auto-merges
UPDATE harness_config SET value = 'off' WHERE key = 'DEPLOY_GATE_RISK_TIER';

-- After 7 clean days, flip to low to start auto-merging hand-driven harness PRs
UPDATE harness_config SET value = 'low' WHERE key = 'DEPLOY_GATE_RISK_TIER';

-- After another 7 clean days, enable the failures source as a canary
UPDATE harness_config SET value = 'true' WHERE key = 'PRESTAGE_SOURCE_FAILURES_MD_ENABLED';

-- Last unlock — closes the loop
UPDATE harness_config SET value = 'true' WHERE key = 'SELF_REPAIR_AUTO_MERGE_ENABLED';
```

### Branch + claim

- Branch: `harness/overnight-autonomy-bootstrap`
- Claim file: `.claude/active-windows/harness__overnight-autonomy-bootstrap.json`
- Commit: see git log for `feat(harness): overnight-autonomy bootstrap`
