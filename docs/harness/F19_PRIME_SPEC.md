# F19_PRIME_SPEC — "20% is the floor"

**Status:** DRAFT 1 (2026-04-28) — for review. Not yet approved. No migration written.
**Source of truth (when approved):** This doc.
**Authority (when approved):** `lib/rules/registry.ts` will register F19' as a sibling/extension of F19 (not a new F-number; an in-place upgrade of F19's semantics with the methodology unpacked here).
**Parent rule:** `F19 — Continuous improvement (process layer)` ([CLAUDE.md §3 rule 9](../../CLAUDE.md), [project CLAUDE.md global rule #F19](../../../CLAUDE.md)).
**Relationship:** **Extends F19, does not supersede.** F19 stays load-bearing; F19' tightens the ship-or-veto verification step that F19 today leaves implicit.
**Sibling specs:** [`SANDBOX_LAYER_SPEC.md`](SANDBOX_LAYER_SPEC.md) · [`SECURITY_LAYER_SPEC.md`](SECURITY_LAYER_SPEC.md) · [`ARMS_LEGS_S2_SPEC.md`](ARMS_LEGS_S2_SPEC.md) (same doc style).

---

## At a glance

| Field | Proposed |
| --- | --- |
| Component count change | **0** — F19' is a methodology spec, not a leverage component. No new row in `harness_components`. Shapes how other components are evaluated. |
| New tables | **0** in slice 1 — reuses `decisions_log` (live, migration 0044) and `agent_events` |
| New endpoints | **0** in slice 1 — `optimize()` and `verify()` are in-process |
| New libraries | **2** — `lib/harness/f19/{optimizer,verifier}.ts` |
| Implementation primitive | **TypeScript interface pair** — `Optimizer.propose()` returns candidate paths; `Verifier.gate()` runs F18 + acceptance + benchmark checks; vetoes any path that regresses |
| Migration | **None** in slice 1. Slice 3+ may add an `f19_proposals` operational table if reuse of `decisions_log` proves too narrow. |
| Honest target | **No %** — methodology spec doesn't carry a completion meter. The "did F19' fire correctly?" signal lives as event counts in `agent_events`. |
| Hard prerequisites | `decisions_log` (live), `agent_events` (live) |
| Soft prerequisites | `lib/harness/process-efficiency.ts` (live since 2026-04-26) — first slice-1 demo target |
| Downstream unblocks | Sets the contract that **every future improvement loop** uses — sandbox slice 1 quality gate, security_layer enforcement flips, arms_legs S2 migration verification, etc. |

---

## The problem

F19 today says: every system, process, and workflow is continuously evaluated for "20% faster, cheaper, or better." Implementation guidance in CLAUDE.md §3 rule 9 covers the *signal* layer (every module ships F18 metrics; nightly loop surfaces top 3 actionable suggestions; >20% inefficiency auto-queues a task).

**Three real gaps surface in practice:**

### Gap 1 — The 20% number is read as a target, not a floor

When a 60% improvement is on the table, F19 phrasing nudges agents toward "find a 20% win and stop." The framing rewards *meeting* the bar, not *exceeding* it. Today's session: Colin explicitly redlined "20% is the FLOOR, not the target. Take the fastest path with quality double-check. No ceiling."

### Gap 2 — F19 is silent on the verification step that gates the ship

F19 says "queue a task when inefficiency exceeds 20%" and "surface top 3 actionable suggestions." It does not say *how* a proposed shorter path is verified before the substitution happens. In practice this becomes:

- agent proposes a faster path (e.g., "skip X, batch Y") → ships → some other quality regresses (a metric drops, an acceptance test starts failing, a benchmark moves the wrong way)
- regression is caught later (or worse, never)

F18 (measurement + benchmark + surfacing) is the *evidence base* that a verifier *could* use, but F19 doesn't currently wire F18's outputs into a ship-or-veto gate.

### Gap 3 — Optimizer's reasoning is not captured

When F19 surfaces a "20% better" suggestion in morning_digest, the *why* (signal that triggered it, alternatives considered, expected gain) lives in chat context and is lost. `decisions_log` (memory layer chunk #1, shipped today via migration 0044) is the right home for these — but F19 doesn't currently write to it.

---

## Architecture decisions (five)

### AD1. **20% is the floor, no ceiling — phrasing change with teeth**

F19 currently reads as if 20% is the bar. F19' reframes:

- **Trigger threshold (unchanged):** any signal showing >20% inefficiency vs. benchmark auto-queues a task. This stays — it's the surfacing rule.
- **Optimizer target (new framing):** when a path is proposed, the optimizer reports the *largest verifiable* improvement, not the smallest acceptable one. "I found a 22% improvement" is suspect; "I found 64% but only 22% is safely verifiable" is honest.
- **Quality double-check (new requirement):** any proposed path with >0% gain *must* go through the verifier before substitution. There is no "small enough to skip review" branch.

**Why this matters:** the 20% floor framing is what stops agents from over-engineering tiny wins (<20% paths shouldn't auto-queue tasks — too noisy). The "no ceiling" framing is what stops agents from leaving 60% gains on the table because "20% was met."

**Pinning rule:** F19's existing 20% trigger is preserved. F19' adds the ceiling-removal language to the rule body. No new threshold.

### AD2. **Optimizer + Verifier pair — distinct roles, separate code paths, separate sessions**

Two interfaces, two files, two concerns:

- `Optimizer.propose(target)` — returns candidate paths ranked by *expected* gain. Pure proposal layer; takes nothing destructive.
- `Verifier.gate(candidate)` — returns `{ ship: boolean, vetoes: VetoReason[] }`. Runs F18 metric checks, acceptance test re-runs (when applicable), and benchmark regression detection on the candidate path. **Any single veto blocks ship.** The verifier is the gate; the optimizer is *not* allowed to call it on itself.

**Why separate them:** an optimizer that grades its own proposals will rationalize. The verifier must run as an independent path with its own data lookups. In practice this means the optimizer hands the verifier a `CandidatePath` value, and the verifier re-fetches the metrics it needs from `agent_events` / target-specific tables — never trusts the optimizer's quoted numbers.

**Session separation (architectural, not advisory):** Optimizer and Verifier MUST run in separate sessions. The `decisions_log` row is the seam — optimizer writes `status='proposed'`, verifier reads in a fresh session and writes `status='accepted'|'vetoed'|'pending'`. Verifier never sees optimizer's in-context reasoning, only the persisted `CandidatePath` (the `options_considered` JSON in `decisions_log` is the only reasoning trail the verifier consumes). This closes the same-window rationalization risk that S-L11 (parallel context windows) names. The cost is one round-trip latency per proposal; the cost is acceptable because F19' loops are nightly, not interactive.

**Required field on `decisions_log` rows for F19' use:** `metadata.f19_status ∈ {'proposed', 'accepted', 'vetoed', 'pending'}`. Optimizer inserts with `'proposed'`; verifier `UPDATE`s. The status transition is the audit signal — `proposed → accepted` and `proposed → vetoed` are terminal; `proposed → pending` is the multi-window persistence path (see AT5 below).

### AD3. **Verifier reuses deploy gate's quality checks + benchmark regression detection**

The deploy gate ([docs/harness-component-6-deploy-gate.md](../harness-component-6-deploy-gate.md)) already encodes the project's "is this safe to ship" rules (tests pass, smoke checks pass, no known incident). F19' verifier inherits that contract for code-path candidates and adds a benchmark layer:

- **Acceptance tests:** re-run any acceptance test associated with the target. Per F21, every module has an acceptance doc; the doc names its tests. A candidate path that fails any of them = veto.
- **F18 metrics:** for each metric the target component declares, compare candidate-path measurement against the established benchmark + recent N-day rolling baseline. Tolerance: candidate must be within ±5% of baseline on metrics not being optimized; must clear the proposed gain on the metric being optimized. Anything outside that window = veto. **Default ±5% is a starting heuristic, not derived. Calibration deferred to slice 2 against ≥14 days of real friction-index variance data. Treat slice 1 ±5% as instrumentation, not policy** (see Q8).
- **Benchmark regression detection:** if the F18 benchmark itself moves the wrong way (e.g., "median pickup latency" goes up while we were optimizing throughput), that's a regression on a sibling metric → veto.
- **Existing deploy gate hooks:** for code-path candidates, the verifier defers final ship/no-ship to the deploy gate; F19' doesn't replace it. For pure-process candidates (e.g., "spawn 3 windows instead of 1"), the verifier is the gate.

### AD4. **Decision logging — every proposal writes to `decisions_log`, not just the accepted ones**

For audit + retrospective. Every `Optimizer.propose()` + `Verifier.gate()` cycle that fires in production writes a row to `decisions_log`:

- `category = 'process'` (per the migration 0044 enum)
- `decided_by = 'agent'` for autonomous loops; `'colin'` when surfaced via morning_digest and Colin acts; `'consensus'` if `/stochastic-consensus` is involved
- `source = 'morning_digest_response'` for nightly-loop fires; `'redline_session'` for in-session manual invocations; new value `'f19_loop'` may be added if the existing enum values feel stretched (proposed in §Open questions)
- `chosen_path` = the candidate that shipped (or `'rejected: <vetoes>'` if all candidates vetoed)
- `options_considered` = JSON array of all candidate paths the optimizer surfaced, with their `expected_gain_pct` and the verifier's veto verdict
- `reason` = the specific veto/accept rationale
- `related_files` = component slug(s) touched

**Why log rejected paths too:** the most valuable F19' artifact over time is the *what we tried that didn't work* corpus. Future optimizer runs avoid revisiting paths the verifier already rejected for the same target unless conditions changed. The mirror trigger (decisions_log → knowledge) means these become Twin-retrievable, so coordinator queries like "have we tried batching X before?" return real history.

### AD5. **Relation to F17, F18, F21 — F19' is the loop that closes them**

F17 (behavioral ingestion justification), F18 (measurement + benchmark + surfacing), and F21 (acceptance tests first) are all *inputs* to F19':

- **F17 → F19':** every component must have an engine-feeding signal. F19' reads those signals when proposing optimizations. Without F17, the optimizer has nothing to differentiate "improvement" from "change."
- **F18 → F19':** the benchmark + metrics surface is what the verifier consults. Without F18, no "is this faster than before?" check is possible.
- **F21 → F19':** acceptance docs name the tests the verifier re-runs. Without F21, the verifier has no acceptance contract to consult — it falls back to F18 metrics only, which is necessary but not sufficient.

**F19' adds nothing those rules don't already require.** It composes them into an active loop. If F17, F18, and F21 are honored upstream, F19' is largely mechanical.

The thing F19' *does not* duplicate from existing rules: it does not re-state "every module has metrics" (F18 says this) or "every module has acceptance tests" (F21 says this). It assumes those, and enforces the *use* of them at substitution time.

---

## Components — TypeScript interfaces

### M1. `lib/harness/f19/optimizer.ts`

```ts
import type { ComponentSlug } from '@/lib/harness/types'

export interface CandidatePath {
  /** Stable identifier for the proposed change. */
  id: string
  /** Component being optimized (must match a row in harness_components). */
  target: ComponentSlug
  /** Human-readable summary — used in decisions_log.chosen_path. */
  summary: string
  /** Expected gain percentage on the optimized metric, optimizer's estimate. */
  expected_gain_pct: number
  /** The metric the candidate aims to improve. */
  metric_key: string
  /** Concrete change description. May reference files, queries, config. */
  proposed_change: {
    kind: 'code' | 'config' | 'process' | 'schema'
    diff_summary: string
    related_files?: string[]
  }
  /** Optimizer's reasoning trail. Goes to decisions_log.options_considered. */
  rationale: string
}

export interface OptimizerInput {
  target: ComponentSlug
  /** Floor — paths under this expected_gain_pct are not surfaced. Default 20. */
  min_gain_pct?: number
  /** Optional: bias toward speed | cost | quality. Default 'speed'. */
  axis?: 'speed' | 'cost' | 'quality'
}

export interface Optimizer {
  /**
   * Reads recent agent_events + F18 metrics for the target.
   * Returns up to N candidate paths, ranked by expected_gain_pct desc.
   * MUST NOT call Verifier on its own output.
   */
  propose(input: OptimizerInput): Promise<CandidatePath[]>
}
```

### M2. `lib/harness/f19/verifier.ts`

```ts
import type { CandidatePath } from './optimizer'

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
  /** Verifier's own measurements — independent re-fetch, not optimizer-quoted. */
  measured_gain_pct: number | null
  /** decisions_log row id for the audit trail. */
  decision_id: string
}

export interface Verifier {
  /**
   * Runs F18 metric re-fetch + acceptance test re-run + benchmark check
   * + (for code candidates) deploy_gate hooks.
   * Returns ship verdict + all vetoes (does not short-circuit on first veto).
   * Writes to decisions_log regardless of outcome.
   */
  gate(candidate: CandidatePath): Promise<VerifierResult>
}
```

### M3. (slice 2+, not in slice 1) `lib/harness/f19/loop.ts`

A small composer that runs `Optimizer.propose()` → `Verifier.gate()` for a list of targets and emits a digest. Slice 1 demonstrates the loop manually for one target; slice 2 wires it into morning_digest as the "F19' nightly loop."

---

## Slice 1 — smallest demonstrable optimizer→verifier loop

**Demo target:** `lib/harness/process-efficiency.ts` — friction signal.

**Why this target:**

1. It already exists ([lib/harness/process-efficiency.ts](../../lib/harness/process-efficiency.ts)), shipped 2026-04-26.
2. Its four signals (queue throughput, pickup latency, queue depth, friction index) all have F18 benchmarks defined inline (lines 56-103 — `>=70%`, `<5 min`, `>1`, `0/day`).
3. The friction index in particular has produced concrete redlines today (F-L13 — manual rollup tracking). So there is real data to optimize against.
4. The signal is read-only and process-layer, not code-shipping. The verifier doesn't need to re-run an acceptance test suite — it just re-measures.

**What ships in slice 1:**

1. `lib/harness/f19/optimizer.ts` exporting `Optimizer` (with one stub implementation that always proposes the single candidate "spawn coordinator at queue depth ≥ 2 instead of waiting for digest"; expected_gain_pct = 50). This is intentionally a known proposal — the slice is about proving the loop, not the AI's optimizer quality.
2. `lib/harness/f19/verifier.ts` exporting `Verifier` (real implementation: re-fetch friction index baseline from `agent_events` over last 7 days; measure candidate by re-running `buildProcessEfficiencyLines()` after a synthetic queue-depth event; compare).
3. `tests/harness/f19/optimizer.test.ts` + `tests/harness/f19/verifier.test.ts` — vitest, skipif-no-DB pattern.
4. One real run: invoke optimizer + verifier against process-efficiency, write the resulting `decisions_log` row, assert the row content via Supabase MCP.

### Slice 1 acceptance tests

- [ ] **AT1 — Optimizer respects min_gain_pct floor.** `optimizer.propose({ target: 'harness:process_efficiency', min_gain_pct: 25 })` returns 0 candidates if all paths' `expected_gain_pct < 25`. Returns >=1 candidate when threshold is met.
- [ ] **AT2 — Verifier writes a decisions_log row regardless of ship verdict.** A candidate that the verifier vetoes still produces a `decisions_log` row with `chosen_path = 'rejected: <vetoes>'` and `category = 'process'`. Counted via Supabase MCP `SELECT` after the call.
- [ ] **AT3 — Verifier vetoes a sibling-metric regression.** Synthesize a candidate that improves friction index by 50% but increases pickup latency by 30%. Verifier returns `ship: false` with at least one `sibling_metric_regression` veto. (The synthesized candidate is fixture-only; the test does not actually deploy anything.)
- [ ] **AT4 — Verifier re-measures independently.** When optimizer claims `expected_gain_pct: 50`, the verifier re-fetches and computes `measured_gain_pct` from raw `agent_events`. The test seeds `agent_events` rows that yield a known measured gain; the verifier's number must come from those rows, not from the candidate's claim. Bypass attempt (passing a candidate with `expected_gain_pct: 999`) does not affect `measured_gain_pct`.
- [ ] **AT5 — Persistence check (no single-measurement accept).** Verifier does not flip a candidate to `'accepted'` based on a single measurement. Slice 1 implements **N=3 consecutive measurement windows** (each = one nightly tick) where measured gain ≥ floor before status flips to `'accepted'`. Three sub-tests:
  - **AT5a — All 3 windows show gain → accepted.** Seed 3 synthetic `agent_events` readings showing the gain across 3 distinct window boundaries. Run verifier 3 times. Assert final `decisions_log` row has `metadata.f19_status='accepted'` and `metadata.f19_window_count=3`.
  - **AT5b — 2 gain + 1 regression → pending or vetoed (not accepted).** Seed windows 1 and 2 with gain, window 3 with a regression. Run verifier 3 times. Assert final `metadata.f19_status` is `'pending'` (if regression is within tolerance) or `'vetoed'` (if regression exceeds tolerance) — explicitly NOT `'accepted'`.
  - **AT5c — Window 1 gain + windows 2-3 regression → vetoed.** Seed window 1 with gain, windows 2-3 with regression. Run verifier 3 times. Assert final `metadata.f19_status='vetoed'` and the veto list includes a `metric_regression` entry.

  N=3 is pinned for slice 1; calibration deferred (see Q8 — same data window). Persistence check is what distinguishes F19' from a one-shot regression test: it gates on *durability* of the gain, not just its existence at a single moment.
- [ ] **AT6 — `decisions_log` row links to the proposing agent.** `decided_by = 'agent'` (since the demo runs autonomously); `source` is one of the existing enum values (decision in §Open Q1) or the new `f19_loop` value if approved.

### Slice 1 file targets (exact)

- New: `lib/harness/f19/optimizer.ts` (~120 LOC)
- New: `lib/harness/f19/verifier.ts` (~180 LOC)
- New: `tests/harness/f19/optimizer.test.ts` (~80 LOC)
- New: `tests/harness/f19/verifier.test.ts` (~140 LOC)
- No changes to existing files except an `INSERT` into `decisions_log` recording the slice 1 acceptance approval (parallel to memory layer chunk #1's pattern).

### Slice 1 estimate

**4–6 hours end-to-end.** Single composer pair; no migrations; no API surface; no UI. Risk is the synthesized regression fixtures in AT3/AT4 — straightforward but easy to write subtly wrong.

---

## Open questions

### Q1. `decisions_log.source` enum extension

Current enum: `redline_session | morning_digest_response | incident_response | post_mortem` (per migration 0044).

F19' nightly loop fires don't fit any of those cleanly:
- `morning_digest_response` is closest but implies a Colin response, which an autonomous loop wouldn't have.
- Adding `f19_loop` is one row's worth of migration churn.

**Proposed:** add `f19_loop` to the enum in slice 1 (same migration as any other slice 1 changes; or a follow-on if slice 1 ships with no migration).

**Defer-to-Colin reason:** introduces a new source value that future agents will see. Wants explicit ack.

### Q2. Where does the verifier source benchmarks?

F18 says every module has a benchmark, but doesn't fix the storage location. Today benchmarks live as inline comments (`// Benchmark: ≥70% of created tasks complete within 24h` in process-efficiency.ts) and as text in acceptance docs.

**Proposed:** verifier reads benchmarks from a structured field on `harness_components.metadata` (not yet defined) OR a `benchmarks` table. Slice 1 hardcodes the four process-efficiency benchmarks because they're the demo target — slice 2+ resolves the storage decision.

**Defer-to-Colin reason:** new schema-level decision; affects every component.

### Q3. Sibling-metric tolerance — is ±5% the right window?

AD3 specifies ±5% on metrics not being optimized. This is a guess pinned to the friction-index demo's noise floor.

**Proposed:** start at ±5%; reset per-metric in slice 2 once we have real data on each metric's day-over-day variance. Tolerance lives in `harness_components.metadata.sibling_tolerance_pct` (proposed) — defaults to 5 if absent.

### Q4. Process-efficiency.ts has 4 signals — does optimizer pick one or score the bundle?

Slice 1 commits to *one signal at a time* (per `OptimizerInput.target` having a single `metric_key`). A multi-metric optimizer is slice 3+.

**Defer-to-Colin reason:** simple decision but locks the slice 1 scope.

### Q5. Stochastic consensus integration — when?

`/stochastic-consensus` is a real existing skill. F19' could use it for high-stakes proposals (anything touching production code paths the verifier can't fully sandbox). Slice 1 doesn't wire it in.

**Proposed:** slice 3+. Slice 1 demo target is read-only process-efficiency; no stochastic gate needed.

### Q6. Auto-apply confidence threshold — do we have one?

CLAUDE.md says "Confidence scoring: Score ≥ 8 → auto-apply after tests pass. Score 5–7 → propose with reasoning, await approval. Score < 5 → stop and escalate."

Verifier's `ship: true` corresponds to "tests pass" — but optimizer doesn't currently emit a confidence score. **Should it?**

**Proposed:** YES. Add `confidence_score: number` to `CandidatePath` (1-10 per CLAUDE.md). Verifier's `gate()` always runs, but if `confidence_score < 8` the verifier returns `ship: false` with a `requires_colin_approval` veto regardless of metric/test results.

**Defer-to-Colin reason:** extends the candidate contract; needs explicit nod.

### Q7. Is rejected-path memory unbounded?

Logging every rejected path to `decisions_log` is intentional (AD4) but means the table will grow. Mirror trigger to `knowledge` doubles it.

**Proposed:** add a `superseded_at` heuristic for stale rejections — if the rejection was due to a metric that has since changed by >2x, the rejection is stale and a future optimizer run is allowed to re-propose. Slice 3+ work.

### Q8. Tolerance calibration — what's the right ±X% for the friction index?

AD3 pins ±5% as the slice 1 sibling-metric tolerance. That number is a heuristic, not derived from data. The slice 1 demo target is the friction index in `process-efficiency.ts`; we do not yet have a measured day-over-day variance for it.

**Proposed:** slice 2 adds a calibration pass against ≥14 days of friction-index variance data captured during slice 1's persistence-check runs (AT5). Per-metric tolerance lives in `harness_components.metadata.sibling_tolerance_pct` (Q3 same field) — defaults to 5 if absent, calibrated values overwrite per metric. Slice 1 ships with ±5% as instrumentation; slice 2 makes it policy.

**Defer-to-Colin reason:** affects every metric in the harness once calibration policy is set. Slice 1 is safe with the heuristic; slice 2 is when the number stops being a guess.

---

## Dependencies

### Hard prerequisites (must be live)

- `decisions_log` table — **live** (migration 0044 applied; verified 2026-04-28: `decisions_log_live=true`)
- `agent_events` table — **live**
- F19 itself — already in [CLAUDE.md §3 rule 9](../../CLAUDE.md). F19' extends, doesn't supersede.

### Soft prerequisites (slice 1 demo target)

- `lib/harness/process-efficiency.ts` — **live** (shipped 2026-04-26). Slice 1 picks this as the first concrete target because its benchmarks are inline and its signals are mature.

### Future prerequisites (post slice 1)

- `harness_components.metadata` JSONB extension for benchmark storage — slice 2+ (Q2).
- `decisions_log.source` enum extension to include `f19_loop` — slice 1 if approved (Q1).

### What this spec does NOT depend on

- `sandbox` (any slice). F19' verifier does not need an isolated execution environment for slice 1 — its demo target is read-only.
- `arms_legs` (any slice). F19' is in-process TypeScript; no fs/shell/http surface.
- `security_layer` slice 6 (sandbox boundary contract). Not relevant until F19' is applied to sandbox-shaped candidates in slice 3+.

---

## Out of scope

- Self-applying F19' to itself ("how can F19' be 20% better?"). Recursion bait. Slice 5+ if ever.
- Automatic rollback when verifier's measurements diverge from optimizer's claim. Verifier merely vetoes ship; rollback of an *already-shipped* path is incident-response domain.
- Optimizer ML / pattern recognition. Slice 1 ships a stub optimizer with a hardcoded proposal. The interface design is the deliverable; smart optimizers are a slice 4+ topic.
- Cross-component optimization. Slice 1 takes one component at a time. Multi-component "system-wide 20% better" is slice 4+.
- UI surfacing. Verifier writes to `decisions_log`; existing morning_digest already reads `decisions_log`-adjacent tables. No new UI in slice 1.
- Cost/dollar quantification. Optimizer's `expected_gain_pct` is metric-relative. Translating "50% faster pickup latency" into dollars is downstream business-layer work, not F19' methodology.

---

## Risks for redline

### R1. The 20% floor framing might still be misread as a target

The phrase "20% is the floor" is contextually unambiguous in CLAUDE.md but can be lifted out of context. Mitigation: rule registry entry includes both phrasings (floor AND no-ceiling) and a short example showing a 60% gain being honest about the headroom.

### R2. Verifier complexity creep

A verifier that runs acceptance tests + F18 metrics + benchmarks + deploy gate hooks is doing a lot. Risk: it becomes another "everything goes through here" choke point. Mitigation: slice 1 verifier is read-only and ~180 LOC; the boundary stays tight; slice 2+ adds capability via composition not by stuffing the existing module.

### R3. Optimizer always-rationalize problem — enforced via AD2's session separation

Same-window rationalization is now an architectural prohibition, not a runtime risk: AD2 requires Optimizer and Verifier to run in separate sessions, with the `decisions_log` row (status='proposed' → 'accepted'|'vetoed'|'pending') as the seam. Verifier sees only the persisted `CandidatePath`, never the optimizer's in-context reasoning. The remaining residual risk is **single-Claude-version bias** — both sessions running on the same model version may share blind spots. Accept for slice 1; revisit if verifier accept rate >95% sustained over 30 days (suggests verifier is rubber-stamping rather than gating). Slice 2+ may pair the verifier with `/stochastic-consensus` or a different model tier for further independence.

### R4. `decisions_log` becomes a noise dump

Logging every rejection (AD4) was a deliberate choice. If too many rejected proposals from chatty optimizer runs flood the table, retrieval signal drops. Mitigation: `decisions_log.category = 'process'` is the natural filter; downstream readers (Twin retrieval, morning_digest) already category-filter.

### R5. Methodology-spec expectation mismatch

F19' has no `harness_components` row and no completion %. Risk: someone reads "F19' is approved" as "F19' is at 100%" and skips the slices. Mitigation: this spec's §At-a-glance explicitly says "no completion meter; signal lives as `agent_events` counts." Slice 1 lands; subsequent slices don't move a percentage tile, but they do change behavior.

### R6. Honest-numbers floor vs. ceiling confusion in the chunk-bump rule (F-L13)

F-L13 introduced the "bumps harness:X to N%" PR description directive. F19' methodology doesn't itself bump component %, but if a verifier veto changes a component's measured efficiency, who owns updating the % — verifier or component-bump? Mitigation: verifier writes only to `decisions_log` and never bumps `harness_components.completion_pct`. Component bumps remain a separate concern. F19' is read-only with respect to harness_components.

---

## What this spec does NOT do

To pin scope honestly:

- It does not add a row to `harness_components`. F19' is methodology, not leverage component.
- It does not change the F19 trigger threshold (still 20% inefficiency).
- It does not replace the deploy gate. Verifier composes with it for code-path candidates.
- It does not require a new migration in slice 1 (Q1 may flip this).
- It does not specify *what to optimize* — only *how the loop runs* when optimization is proposed.

---

## Approval checklist (what Colin's redline confirms)

- [ ] AD1 phrasing: "20% is the floor, no ceiling, quality double-check non-negotiable" lands as F19' tagline in CLAUDE.md.
- [ ] AD2 separation: Optimizer and Verifier are distinct files. Verifier never trusts optimizer-quoted numbers. **Sessions are also separate** — `decisions_log.metadata.f19_status` is the seam (`proposed` → `accepted`|`vetoed`|`pending`).
- [ ] AD3 reuse: Verifier wraps deploy gate + acceptance tests + F18 + benchmark, not a new orthogonal pile.
- [ ] AD4 logging: Every proposal (accepted or rejected) writes to `decisions_log`.
- [ ] AD5 composition: F19' assumes F17 + F18 + F21 are honored upstream. It does not re-state them.
- [ ] Slice 1 target: process-efficiency friction signal — agreed as smallest demonstrable surface.
- [ ] AT5 persistence check: N=3 consecutive windows before `accepted`; calibration deferred to slice 2 (see Q8).
- [ ] Q1 (source enum): add `f19_loop` to `decisions_log.source` enum or fit existing values.
- [ ] Q6 (confidence score): require `confidence_score: number` on `CandidatePath`; <8 forces colin-approval veto.
- [ ] Q8 (tolerance calibration): slice 2 calibrates per-metric ±X% from ≥14 days of slice 1 variance data.

---

**End of draft.** All architecture decisions are reversible at this stage. No code written. Awaiting redline.
