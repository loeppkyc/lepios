# OSS Scout — Phase 0 Audit

**Date:** 2026-05-10
**Branch:** feat/oss-scout-step4
**Status:** Phase 0 complete — awaiting Colin's "go" for Phase 1

---

## 1 — Step 4 Scope Confirmation

From `docs/lepios/oss-radar-audit.md` Step 4:

- `lib/oss/scout.ts` — given `task_queue.metadata.external_deps[]`, returns `ScoutResult` with fit scores + block/warn/pass decision
- Wire into `lib/harness/pickup-runner.ts`: call `scoutCheck()` before `claimTask()`, append result to `task.metadata.oss_scout`
- No UI at launch; result visible in `task_queue.metadata` via cockpit

**Confirmed scope:** pre-pickup gate. Scout runs at claim time (not insert time), reads `metadata.external_deps[]` from the already-queued task, and either halts the claim or appends a verdict before proceeding.

**Design clarification resolved:** Task descriptions are free text; `scoreModuleDeps()` expects a dep-label array. The Step 4 contract is that **task inserters populate `metadata.external_deps[]`** at insert time. Scout reads it at claim time. If `metadata.external_deps` is absent or empty, scout returns `pass` (no signal, no block).

---

## 2 — Task Creation Path + Hook Point

### Task creation paths that must populate `metadata.external_deps[]`

| Path | File | Source field | Action needed |
|------|------|-------------|---------------|
| Coordinator insert | `lib/harness/coordinator-commands.ts:27` `insertTask()` | `metadata` | Coordinator must populate `external_deps[]` when task involves external libraries |
| Manual Orb tool | `lib/orb/tools/queue-task.ts` `queueTaskTool` | `metadata` | Optional; no dep parsing today — accept empty array → scout passes |
| Purpose-review handler | `lib/purpose-review/handler.ts` | `metadata` | No dep field today; out of scout scope |
| Work-budget parser | `lib/work-budget/parser.ts` | `metadata` | No dep field today; out of scout scope |

**Only the coordinator path requires `external_deps[]` population today.** Non-coordinator inserts produce no `external_deps` → scout short-circuits to `pass`.

### Hook point

**File:** `lib/harness/pickup-runner.ts`
**Where:** Before `claimTask()` call (~line 335 based on code read)
**Pattern:**

```typescript
const scoutResult = await scoutCheck(peekedTask);
if (scoutResult.decision === 'block') {
  // do not claim; log agent_events; fire Telegram
  return;
}
await claimTask(runId);
// attach scoutResult to task metadata post-claim
```

`peekTask()` already exists in `lib/harness/task-pickup.ts` — provides the task row for scout inspection without claiming it.

---

## 3 — Scoring Core Reuse

`lib/oss-radar/audit.ts` exports `scoreModuleDeps(deps: string[])` with an 11-entry `DEP_VERDICT` map. Verdicts:

| Verdict | Meaning | Scout decision |
|---------|---------|---------------|
| `replace` | Native LepiOS alternative exists | **block** — halt pickup, surface via Telegram |
| `fork-extend` | Partial overlap, should extend LepiOS | **warn** — proceed with warning in metadata |
| `absorb-patterns` | Pattern worth internalizing | **warn** | 
| `keep` | No LepiOS alternative, library is fine | **pass** |
| `complement-with` | Library adds value alongside LepiOS | **pass** |

**Block threshold:** any dep with `replace` verdict → `decision = 'block'`.
**Warn threshold:** any `fork-extend` or `absorb-patterns` → `decision = 'warn'`.
**Pass:** all deps `keep` or `complement-with`, or `external_deps` is absent/empty.

`oss_packages` table (migration 0179, live) can be queried for existing verdicts before falling back to `scoreModuleDeps()` — avoids re-running rule-based scoring for already-audited packages.

---

## 4 — Design Spec

### `lib/oss/scout.ts`

```typescript
export type ScoutDecision = 'pass' | 'warn' | 'block';

export interface ScoutResult {
  decision: ScoutDecision;
  verdicts: Array<{ dep: string; verdict: string; rationale: string }>;
  scorer: 'oss_packages_cache' | 'rule_based_v1';
  latency_ms: number;
}

export async function scoutCheck(task: TaskRow): Promise<ScoutResult>
```

**Algorithm:**
1. Read `task.metadata?.external_deps` — if absent or empty, return `{ decision: 'pass', verdicts: [] }` immediately.
2. For each dep, query `oss_packages` by `name = dep`. If found and `audit_status = 'done'`, use cached `fit_score` + `lepios_alternative` for verdict.
3. For deps without a cache hit, call `scoreModuleDeps([dep])` from `lib/oss-radar/audit.ts`.
4. Aggregate: any `replace` → `block`; any `fork-extend`/`absorb-patterns` → `warn`; else `pass`.
5. Return `ScoutResult`.

### `lib/harness/pickup-runner.ts` modification

- After `peekTask()` and before `claimTask()`, call `scoutCheck(task)`.
- On `block`: insert `agent_events` row (`event_type: 'scout_block'`), fire Telegram drain, return without claiming.
- On `warn`: proceed to claim, then UPDATE `task_queue SET metadata = metadata || '{"oss_scout": ...}'` post-claim.
- On `pass`: proceed to claim, optionally attach empty `oss_scout` to metadata (omit to avoid metadata bloat).

### Telegram alert on block

Reuse `lib/telegram/harness-alert.ts` (existing). Message format:
```
🚫 Task pickup blocked — OSS Scout
Task: <task.task>
Blocked dep: <dep> → verdict: replace → LepiOS alternative: <lepios_alternative>
To override: POST /api/harness/coordinator-resume with { task_id, override: true }
```

---

## 5 — F18 / F19 Metrics

### F18 — Measurement

| Metric | Table | Column | Notes |
|--------|-------|--------|-------|
| `scouts_run` | `agent_events` | `event_type = 'scout_run'` | Count per day |
| `halts_issued` | `agent_events` | `event_type = 'scout_block'` | Count per day |
| `warns_issued` | `agent_events` | `event_type = 'scout_warn'` | Count per day |
| `override_rate` | `agent_events` | ratio block→override | Colin accepts 0% initially |
| `latency_ms` | `agent_events` | `metadata.latency_ms` | Target <100ms |

**Benchmark:** 0 blocks in first week = either gate is working correctly (no bad deps) or `external_deps[]` isn't being populated. Surface both scenarios in morning_digest so Colin can distinguish.

**Surfacing:** add to morning_digest SQL: `SELECT count(*) FROM agent_events WHERE event_type IN ('scout_run','scout_block') AND created_at > now() - interval '24h'`

### F19 — Continuous Improvement

Baseline: 0 scouts run today. First improvement cycle: % of tasks with `external_deps[]` populated (coordinator path adoption). Target: 100% of coordinator-inserted tasks include `external_deps[]` within 2 weeks.

Declining block rate over time = either (a) coordinator is learning to use LepiOS alternatives (success), or (b) `external_deps[]` is being omitted to avoid blocks (drift to investigate).

---

## Gap Matrix

| Gap | Severity | Lift |
|-----|----------|------|
| `lib/oss/scout.ts` — new file | Required | ~80 lines |
| `pickup-runner.ts` hook | Required | ~15 lines |
| `agent_events` logging | Required | 3 insert calls |
| Telegram block alert | Required | reuse existing helper |
| Coordinator `insertTask()` update | Required for real signal | ~5 lines; coordinator adds `external_deps[]` when known |
| Override endpoint (`coordinator-resume` extension) | Deferred | `/api/harness/coordinator-resume` already exists; add `override: true` path |
| Morning digest metric | Deferred | 1 SQL row |

**Total Phase 1 lift: ~100 lines new code, 2 file edits.** Fits one builder chunk.

---

**Awaiting Colin's "go" to write module code.**
