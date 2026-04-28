# ARMS_LEGS_S2_SPEC

**Status:** DRAFT 1 (2026-04-28) — for review. Not yet approved. No code written.
**Source of truth (when approved):** This doc.
**Authority (when approved):** `lib/harness/arms-legs/http.ts` is written from this doc; capability seed patches for Phase C + Phase D land as the first commit of each phase per §Migration plan.
**Parent component:** [`HARNESS_FOUNDATION_SPEC.md`](HARNESS_FOUNDATION_SPEC.md) §`arms_legs` — component #11 (T3, weight 9, currently 30%, target 70% per foundation spec §Priority).
**Hard prerequisite:** `arms_legs` Slice 1 (`Capability` types + `Action` envelope + `runAction()` registry plumbing) — currently queued for builder in W1. S2 spec depends on S1's contract; redline if S1 ships shape changes.
**Sibling specs:** [`SECURITY_LAYER_SPEC.md`](SECURITY_LAYER_SPEC.md) (provides `requireCapability()` and the 6 seeded `net.outbound.*` rows; verified live 2026-04-28).

---

## Slice context

`arms_legs` decomposes into a sequence of `lib/harness/arms-legs/*.ts` modules. S2 is one of those modules:

| Slice  | Module                                         | Capability domain                                       | Status      |
| ------ | ---------------------------------------------- | ------------------------------------------------------- | ----------- |
| S1     | `arms-legs/index.ts` (types + plumbing)        | (none — wires the surface)                              | Queued (W1) |
| **S2** | **`arms-legs/http.ts` (this doc)**             | **`net.outbound.*`**                                    | **DRAFT**   |
| S3+    | `fs.ts`, `shell.ts`, `browser.ts`, `google.ts` | `fs.*`, `shell.*`, `browser.*`, `net.outbound.google.*` | Future      |

S2 is fully self-contained: one new file, ≤24 caller migrations, two tiny capability-seed patches landed as the first commits of Phase C and Phase D.

---

## At a glance

| Field                                | Proposed                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Component count change               | **0** — sub-system inside `arms_legs`                                                                                                          |
| New tables                           | **0** — uses `agent_actions` (security_layer slice 1) for cap-check audit; `agent_events` for HTTP outcome                                     |
| New endpoints                        | **0** — in-process module                                                                                                                      |
| New libraries                        | **1** — `lib/harness/arms-legs/http.ts`                                                                                                        |
| New capability strings               | **2** — `net.outbound.github` (Phase C) + `net.outbound.self` (Phase D), both seeded log_only/non-destructive with builder+coordinator grants  |
| Deny semantics                       | **Option-C parity** — `requireCapability()` returns `{allowed:false, reason}`; S2 returns the result and audits, **does not throw**. See §AD2. |
| Migrations                           | **2 micro-patches** — Phase C first commit (1 cap + 2 grants); Phase D first commit (1 cap + 2 grants). Both 4-line SQL.                       |
| S2's contribution to `arms_legs` 70% | **+10 points** (30 → 45) — see §Completion accounting                                                                                          |
| Estimated effort                     | **~1 day wall-clock** — wrapper + 24-caller migration + tests                                                                                  |
| Default posture                      | **Audit-and-allow today** — all 6 (now 8 post-patch) `net.outbound.*` rows are `log_only` per the live registry                                |
| Hard prerequisites                   | `arms_legs` S1 merged + `security_layer` slices 1+2 live (already are: 34 registry rows, 9 net grants verified 2026-04-28)                     |

---

## The problem

Foundation spec §`arms_legs`:

> Most pieces exist as ad-hoc imports; no unified contract or capability registry.

Audited 2026-04-28 via `Grep "fetch("` over `lib/`: **35 outbound `fetch()` call sites in 17 files**. None pass through a capability check; none audit; none can be revoked centrally; none can be deny-listed when an agent goes rogue.

S1 ships the contract (`Capability`, `ActionEnvelope`, `runAction()`). S2 ships the _first_ concrete adapter on top of that contract. Without S2, S1 is just types — agents still curl bare URLs.

---

## Live registry — verified inputs (SQL run 2026-04-28)

```
SELECT capability, default_enforcement, destructive
FROM capability_registry WHERE capability LIKE 'net.%' ORDER BY capability;
```

| Capability                   | Default mode | Destructive |
| ---------------------------- | ------------ | ----------- |
| `net.outbound.*`             | log_only     | false       |
| `net.outbound.anthropic`     | log_only     | false       |
| `net.outbound.supabase`      | log_only     | false       |
| `net.outbound.telegram`      | log_only     | false       |
| `net.outbound.vercel.deploy` | log_only     | **true**    |
| `net.outbound.vercel.read`   | log_only     | false       |

Total `capability_registry` rows: **34**. Net domain: 6 of 34 pre-S2; 8 of 36 post-S2 (after Phase C + Phase D micro-patches).

```
SELECT agent_id, capability FROM agent_capabilities WHERE capability LIKE 'net.%';
```

- **builder** — granted: anthropic, supabase, telegram, vercel.deploy, vercel.read (5)
- **coordinator** — granted: anthropic, supabase, telegram, vercel.read (4 — no vercel.deploy)

**Capability gaps S2 closes inline:**

1. `net.outbound.github` — NOT in registry. `deploy-gate.ts` makes 11 GitHub API calls. Phase C ships the seed patch as its first commit (§Migration plan Phase C).
2. `net.outbound.self` — NOT in registry. 3 self-targeted health-check call sites. Phase D ships the seed patch as its first commit (§Migration plan Phase D).

**Capability constraint S2 leverages:** `net.outbound.vercel.deploy` is the only destructive net cap. Coordinator does not have it; only builder. The pre-bound `vercelDeploy()` returns `denied` for coordinator-driven calls, audit-and-allow for builder. See §AD3.

---

## Architecture decisions

### AD1. Pre-bound exports for the high-frequency surfaces; `httpRequest` escape hatch for the long tail

24 in-scope callers cluster on four domains. Pre-binding `telegram`, `vercelRead`, `vercelDeploy`, `supabaseRPC` makes call sites read like:

```typescript
await telegram(`Build green: ${sha}`, { bot: 'alerts' })
const deployments = await vercelRead<DeploymentsList>('/v6/deployments?projectId=...&limit=1')
const result = await supabaseRPC('compute_harness_rollup', { tier_filter: 'T3' })
```

…instead of forcing every caller to spell out the canonical capability string. The escape hatch:

```typescript
await httpRequest({
  url: `${GITHUB_API}/repos/.../compare/main...${sha}`,
  method: 'GET',
  capability: 'net.outbound.github', // explicit — no default
  headers: { Authorization: `token ${token}` },
})
```

…handles the GitHub long tail and any future host. **Why not generic-only:** ~80% of in-scope traffic is the four named surfaces; forcing every caller to string-spell the cap is noise that buries the audit signal. **Why not pre-bound for everything:** combinatorial explosion; new APIs would require code changes.

### AD2. Deny = return-result + audit. Never throw. (Option C parity)

`security_layer.requireCapability()` already returns `{ allowed, reason, enforcement_mode, audit_id }` rather than throwing — that's the published contract. S2 mirrors this shape end-to-end:

```typescript
type ArmsLegsHttpResult<T = unknown> =
  | {
      allowed: true
      status: number
      body: T
      headers: Record<string, string>
      durationMs: number
      auditId: string
    }
  | { allowed: false; reason: string; auditId: string }
```

Callers do `if (!result.allowed) { ... }`. No try/catch needed for the deny path. Network errors (DNS, ECONNREFUSED, fetch timeout) are the only `throw` paths — and only because `fetch` itself rejects the promise. Capability denials, registry lookup failures, and unknown capabilities all return `allowed:false` with a `reason` string from the security layer's enum.

**Today this is audit-and-allow** — every `net.outbound.*` row is `log_only`, so `result.allowed` is always `true` for granted agents and `false` only for unregistered/unknown-capability cases. When security slice 7 flips enforcement to `enforce`, S2 needs zero changes — the result-shape is already discriminated.

**Open Q3 (deferred):** what does Option C do for the `enforce`-mode deny case? Two readings: (a) still return `{allowed:false}`, caller decides; (b) at `enforce` mode, throw because the contract changed semantically. Recommendation: (a). Keeps the discriminated-union shape stable across all modes; callers who want fail-fast can `if (!r.allowed) throw`.

### AD3. `vercelDeploy()` is destructive — coordinator gets a deny by design

The live registry marks `net.outbound.vercel.deploy` as `destructive=true`, and only builder has the grant. This is intentional: deploys go through the deploy gate, which builder-side code triggers; coordinator never directly deploys. S2 preserves this separation by exporting `vercelDeploy()` as an unconditional pre-bound — coordinator's call returns `{allowed:false, reason:'no_grant_for_agent'}` and audits. Ship as-is; if a future flow needs coordinator to deploy, security_layer adds the grant — no S2 code change. Acceptance F.5 pins this with a CI grant-parity test.

### AD4. Cap-check audit row in `agent_actions`; HTTP outcome row in `agent_events`

Security spec AD7 makes `agent_actions` append-only at the GRANT level — `service_role` cannot UPDATE. So the cap_check row written by `requireCapability()` carries only the check result (allowed/denied/reason), not the HTTP outcome. The HTTP outcome (status, durationMs, host, byte counts) lands in a paired `agent_events` row with `correlation_id = action_id` from the cap_check row.

Two-row pattern:

| Table           | Action                      | What it carries                                                   |
| --------------- | --------------------------- | ----------------------------------------------------------------- |
| `agent_actions` | `cap_check`                 | `result: 'allowed'\|'denied'`, `reason`, `agent_id`, `capability` |
| `agent_events`  | `arms_legs.http.{ok,error}` | `status`, `durationMs`, `host`, `bytes_in/out`, `correlation_id`  |

A single query `JOIN ON agent_actions.id = agent_events.context->>'correlation_id'` reconstructs the full call. AD7 immutability preserved; ergonomic audit retained.

### AD5. Read tokens from `process.env` directly. Defer secrets indirection to security_layer slice 4.

S2 keeps the existing 8-file `process.env.X` reads as-is. When security_layer slice 4 lands (`secrets.get(name, agentId)`), the pre-bound bodies update one line each. Two slices land in either order; whichever is second updates `http.ts` in place.

---

## Module spec — `lib/harness/arms-legs/http.ts`

### Pre-bound exports

```typescript
import type { ActionEnvelope } from './index' // S1 export

// Telegram
//
// Reads env: TELEGRAM_BUILDER_BOT_TOKEN, TELEGRAM_DAILY_BOT_TOKEN, TELEGRAM_ALERTS_BOT_TOKEN, TELEGRAM_CHAT_ID.
// Capability: net.outbound.telegram.

export async function telegram(
  text: string,
  opts?: {
    bot?: 'builder' | 'daily' | 'alerts'      // default 'builder'
    chatId?: string                            // default TELEGRAM_CHAT_ID
    parseMode?: 'Markdown' | 'HTML'
    replyMarkup?: unknown
  },
  envelope?: Partial<ActionEnvelope>
): Promise<ArmsLegsHttpResult<{ ok: boolean; result?: { message_id: number } }>>

// Sub-method for editMessageText (purpose-review/handler.ts:20 only caller today)
telegram.edit = async function (
  args: { chatId: string; messageId: number; text: string; parseMode?: 'Markdown' | 'HTML'; replyMarkup?: unknown },
  envelope?: Partial<ActionEnvelope>
): Promise<ArmsLegsHttpResult<{ ok: boolean }>>

// Vercel — split by destructive boundary
//
// vercelRead → net.outbound.vercel.read (non-destructive, both agents granted)
// vercelDeploy → net.outbound.vercel.deploy (destructive, builder only)

export async function vercelRead<T = unknown>(
  path: string,                                // e.g. '/v6/deployments?projectId=...'
  envelope?: Partial<ActionEnvelope>
): Promise<ArmsLegsHttpResult<T>>

export async function vercelDeploy<T = unknown>(
  payload: {
    name: string
    gitSource?: { type: 'github'; repoId: number; ref: string }
    target?: 'production' | 'preview'
    [k: string]: unknown
  },
  envelope?: Partial<ActionEnvelope>
): Promise<ArmsLegsHttpResult<T>>

// Supabase RPC — wraps @supabase/supabase-js .rpc() with capability check.
// Wire is not raw fetch but the supabase-js client; conceptual "outbound RPC" is gated here.
// Capability: net.outbound.supabase. Audit context records the function NAME + arg KEYS, never values (see §Open Q5).

export async function supabaseRPC<T = unknown>(
  name: string,
  args?: Record<string, unknown>,
  envelope?: Partial<ActionEnvelope>
): Promise<ArmsLegsHttpResult<T>>
```

### Generic escape hatch

```typescript
// For any host not covered by a pre-bound. Caller MUST provide a capability string — there is no default.
// Capability is type-checked at compile time against a string-literal union (or against Capability from S1).

export async function httpRequest<T = unknown>(
  args: {
    url: string
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    capability: Capability // explicit — no default
    headers?: Record<string, string>
    body?: BodyInit | Record<string, unknown> | null
    timeoutMs?: number // default 30_000
  },
  envelope?: Partial<ActionEnvelope>
): Promise<ArmsLegsHttpResult<T>>
```

### Result shape (Option-C discriminated union)

```typescript
export type ArmsLegsHttpResult<T = unknown> =
  | {
      allowed: true
      status: number
      body: T
      headers: Record<string, string>
      durationMs: number
      auditId: string // matches the cap_check row in agent_actions; same id used as correlation_id on the agent_events outcome row
    }
  | {
      allowed: false
      reason: string // from CapabilityResult.reason (security_layer enum)
      auditId: string // cap_check row was still written
    }
```

### Behavior notes

- `agentId` MUST be present (from envelope or from a default-agent helper TBD by S1). No anonymous calls.
- Object body → `JSON.stringify` + `Content-Type: application/json`. `BodyInit` (string, FormData, Blob) passes through.
- 4xx and 5xx **do not** flip `allowed` to `false`. They return `allowed:true, status:4xx`. Capability-deny is the only `allowed:false` case (Option C).
- Network errors (DNS, ECONNREFUSED, AbortController timeout) reject the promise. Caller does try/catch IF they need to distinguish from 5xx.
- No retry. No backoff. No circuit-breaker. (Out of scope — see §Out of scope.)

---

## Migration plan — caller-by-caller

24 in-scope sites in 8 files. Migrate in 4 phases, lowest-risk first.

### Phase A — Telegram callers (7 sites, ~½ day)

| File:line                            | Old                                                        | New                                                     | Cap                   |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------- | --------------------- |
| `lib/orchestrator/telegram.ts:14`    | inline `fetch(url, ...)` (the central helper)              | replace body with `return telegram(text, opts)`         | net.outbound.telegram |
| `lib/work-budget/parser.ts:87`       | inline `fetch('https://api.telegram.org/.../sendMessage')` | `await telegram(text, { bot: 'builder' })`              | net.outbound.telegram |
| `lib/harness/telegram-buttons.ts:88` | inline `fetch(...)` with reply_markup                      | `await telegram(text, { bot: 'builder', replyMarkup })` | net.outbound.telegram |
| `lib/purpose-review/timeout.ts:25`   | inline `fetch(.../sendMessage)`                            | `await telegram(text, { bot: 'builder' })`              | net.outbound.telegram |
| `lib/purpose-review/handler.ts:20`   | inline `fetch(.../editMessageText)`                        | `await telegram.edit({ chatId, messageId, text })`      | net.outbound.telegram |
| `lib/harness/deploy-gate.ts:390`     | inline `fetch(.../sendMessage)` for build-status           | `await telegram(text, { bot: 'builder' })`              | net.outbound.telegram |
| `lib/harness/deploy-gate.ts:623`     | inline `fetch(.../sendMessage)` for FAIL alert             | `await telegram(text, { bot: 'alerts' })`               | net.outbound.telegram |

After Phase A, `lib/orchestrator/telegram.ts` is ~5 lines (a re-export to `arms-legs/http.ts`). All 7 sites flow through the same audit.

### Phase B — Vercel + Anthropic callers (3 sites, ~½ hour)

| File:line                              | Old                                                                   | New                                                                                   | Cap                      |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------ |
| `lib/harness/deploy-gate.ts:46`        | `fetch('${VERCEL_API}/v6/deployments?...')`                           | `await vercelRead('/v6/deployments?...')`                                             | net.outbound.vercel.read |
| `lib/harness/invoke-coordinator.ts:63` | `fetch('https://api.anthropic.com/v1/claude_code/routines/.../fire')` | `await httpRequest({ url, method:'POST', capability:'net.outbound.anthropic', ... })` | net.outbound.anthropic   |
| `lib/purpose-review/summary.ts:146`    | `fetch('https://api.anthropic.com/v1/messages')`                      | `await httpRequest({ url, method:'POST', capability:'net.outbound.anthropic', ... })` | net.outbound.anthropic   |

### Phase C — GitHub API callers (11 sites in deploy-gate.ts, ~½ day)

**First commit of Phase C: registry seed patch.** `supabase/migrations/0046_arms_legs_github_cap.sql`:

```sql
INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES ('net.outbound.github', 'net', 'Outbound HTTP to GitHub REST API', 'log_only', false);

INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('builder',     'net.outbound.github', 'log_only', 'colin', 'arms_legs S2 Phase C — deploy-gate GitHub callers'),
  ('coordinator', 'net.outbound.github', 'log_only', 'colin', 'arms_legs S2 Phase C — deploy-gate GitHub callers');
```

This commit lands first; CI runs against the patched registry; subsequent caller commits in Phase C migrate against a known-good cap. If Colin needs to revert Phase C, the SQL revert is `DELETE FROM agent_capabilities WHERE capability='net.outbound.github'; DELETE FROM capability_registry WHERE capability='net.outbound.github';` — clean and self-contained.

**Subsequent commits in Phase C: caller migrations.** All 11 sites — lines 160, 205, 242, 282, 297, 312, 328, 348, 430, 476, 505 of `lib/harness/deploy-gate.ts` — migrate mechanically:

```typescript
const r = await httpRequest({
  url: `${GITHUB_API}/repos/${GITHUB_REPO}/...`,
  method: 'GET' | 'POST' | ...,
  capability: 'net.outbound.github',
  headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
  body: ...,
})
if (!r.allowed) return /* fall back to existing error path */
// use r.status, r.body
```

### Phase D — Self-health callers (3 sites, ~15 min)

**First commit of Phase D: registry seed patch.** `supabase/migrations/0047_arms_legs_self_cap.sql`:

```sql
INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES ('net.outbound.self', 'net', 'Outbound HTTP to our own deployed routes (health checks, smoke tests)', 'log_only', false);

INSERT INTO agent_capabilities (agent_id, capability, enforcement_mode, granted_by, reason)
VALUES
  ('builder',     'net.outbound.self', 'log_only', 'colin', 'arms_legs S2 Phase D — site/route/preview health'),
  ('coordinator', 'net.outbound.self', 'log_only', 'colin', 'arms_legs S2 Phase D — site/route/preview health');
```

**Subsequent commits in Phase D: caller migrations.**

| File:line                                         | Cap               |
| ------------------------------------------------- | ----------------- |
| `lib/orchestrator/checks/site-health.ts:50`       | net.outbound.self |
| `lib/harness/smoke-tests/route-health.ts:60`      | net.outbound.self |
| `lib/harness/deploy-gate.ts:105` (preview health) | net.outbound.self |

### Phase ordering rule

Each phase ships its registry patch (if any) as its first commit, then caller migrations behind tests, deployed independently. Coordinator does not start Phase B until Phase A has been live ≥ 1 hour without a regression. Rolls back independently if any phase trips an alert.

---

## Acceptance criteria

### A. Module exists, type-checks, imports cleanly

- [ ] `lib/harness/arms-legs/http.ts` exports `telegram`, `telegram.edit`, `vercelRead`, `vercelDeploy`, `supabaseRPC`, `httpRequest`, and the `ArmsLegsHttpResult<T>` type.
- [ ] All exports type-check against §Module spec.
- [ ] `tsc --noEmit` passes for the whole repo after the migration commit lands.

### B. Pre-bound functions gate correctly (allowed path) — cap_check row only

For each of `telegram`, `vercelRead`, `vercelDeploy`, `supabaseRPC`, with the corresponding cap granted to a synthetic `agentId='test_arms_legs'`:

- [ ] Mocked `fetch` (or supabase client for `supabaseRPC`) returns 200 + body fixture.
- [ ] Wrapper calls `requireCapability()` exactly once with the correct canonical cap string.
- [ ] Wrapper invokes `fetch` exactly once with the expected URL/method/body.
- [ ] Returns `{ allowed: true, status: 200, body: <fixture>, auditId: <uuid>, durationMs: number }`.
- [ ] One row exists in `agent_actions` with `agent_id='test_arms_legs'`, the right `capability`, `result='allowed'`, `action_type='cap_check'`. **The row carries no `status` or `durationMs` columns** — those live on the `agent_events` outcome row (see B.1).

### B.1. Outcome row exists in `agent_events` with matching correlation_id

For each allowed-path test in B:

- [ ] One `agent_events` row exists with `action LIKE 'arms_legs.http.%'` (`'arms_legs.http.ok'` for status<400, `'arms_legs.http.error'` for status≥400 or fetch rejection).
- [ ] The row's `context->>'correlation_id'` equals the `auditId` returned in the result (which equals the `agent_actions.id` of the cap_check row).
- [ ] The row's `context` JSONB contains `status` (number), `durationMs` (number), `host` (string).
- [ ] `JOIN agent_actions ON agent_actions.id = (agent_events.context->>'correlation_id')::uuid` reconstructs the full call from cap_check + outcome in a single query.

### C. Denied requests audit AND return `{allowed:false}` (Option C)

For each of the 5 callable surfaces (`telegram`, `vercelRead`, `vercelDeploy`, `supabaseRPC`, `httpRequest`), with NO grant for `agentId='test_arms_legs_denied'`:

- [ ] Wrapper calls `requireCapability()`. The result is `allowed:false`.
- [ ] **No `fetch` call is issued.** (Mock has zero invocations.)
- [ ] Wrapper returns `{ allowed: false, reason: <enum string>, auditId: <uuid> }`. **Does not throw.**
- [ ] One `agent_actions` row exists with `result='denied'`, the right `agent_id`, `capability`, `action_type='cap_check'`.
- [ ] **No** `agent_events` row exists with that `correlation_id` — denied calls don't generate outcome rows because no HTTP happened.

### D. Allowed requests round-trip with the right shape

For each pre-bound, one happy-path test asserts:

- [ ] URL: `https://api.telegram.org/bot<TOKEN>/sendMessage` for `telegram`; `https://api.vercel.com<path>` for `vercelRead`; `https://api.vercel.com/v13/deployments` (or current) for `vercelDeploy`; supabase rpc URL for `supabaseRPC`.
- [ ] Method matches the caller's intent (POST for sendMessage, GET for vercelRead with no body, etc.).
- [ ] Object body is JSON-stringified; `Content-Type: application/json` is set; passthrough for string bodies.
- [ ] Authorization header set from env per AD5 (NOT from `secrets.get()` in S2).

### D.1. Outcome row in `agent_events` carries `status`, `durationMs`, `host`

- [ ] For each pre-bound's happy path: `agent_events` outcome row's `context` JSONB contains exactly these three keys minimum: `status` (the HTTP status from `fetch`), `durationMs` (measured wall-clock), `host` (URL host segment).
- [ ] For `httpRequest`'s escape-hatch happy path: same three keys, plus `method` (because the host alone doesn't disambiguate a generic call).
- [ ] `correlation_id` matches the result's `auditId` (asserted by the same JOIN as B.1).

### E. Escape hatch refuses missing capability at compile time

- [ ] `httpRequest({ url, method:'GET' })` (no `capability`) is a TypeScript compile error. Asserted by `tsc-expect-error` style fixture.
- [ ] `httpRequest({ url, method:'GET', capability:'unknown.cap' })` returns `{allowed:false, reason:'unknown_capability'}` (driven by the security layer enum). No fetch issued.

### F. Migration count matches plan

Asserted via grep in CI:

- [ ] After Phase A: `Grep "fetch.*api\.telegram"` in `lib/` returns 0 matches outside `lib/harness/arms-legs/http.ts`.
- [ ] After Phase B: `Grep "api\.anthropic\.com"` returns 0 outside `arms-legs/`.
- [ ] After Phase C: `Grep "GITHUB_API"` outside `arms-legs/` shows only references inside `httpRequest({ ... })` shape (mechanical lint check).
- [ ] No remaining `fetch(` in the migrated 8 files except inside `lib/harness/arms-legs/`.
- [ ] **F.5 — Grant parity (CI):** `SELECT capability FROM agent_capabilities WHERE agent_id='coordinator' AND capability='net.outbound.vercel.deploy'` returns 0 rows. CI fails on non-zero. Test in `tests/security/grant-parity.test.ts`. Pins AD3 against silent grant drift.

### G. Production smoke

- [ ] After Phase A deploy: one production telegram message fires through the new path; one new `agent_actions` row exists with `capability='net.outbound.telegram'`, `result='allowed'`, plus a paired `agent_events` row with matching `correlation_id`.
- [ ] No regression in deploy-gate's next FAIL/SUCCESS alert flow.
- [ ] `lib/harness/quota-cliff.ts` still fires (it calls into the migrated path).

### H. Rollup honesty

- [ ] After S2 lands: `harness_components.completion_pct` for `arms_legs` updated 30 → **45** (see §Completion accounting).
- [ ] morning_digest reflects the bump, notes "S2 of N — outbound HTTP unified."

---

## Completion accounting

Foundation spec target for `arms_legs`: **30% → 70%** (~3 days). Decomposed across slices:

| Slice   | Ships                                                                                 | Δ pts   | Rolling |
| ------- | ------------------------------------------------------------------------------------- | ------- | ------- |
| (today) | Coordinator/builder via CC tools; ad-hoc HTTP                                         |         | **30%** |
| S1      | `Capability` + `ActionEnvelope` + `runAction()` registry plumbing                     | +5      | 35%     |
| **S2**  | **`http.ts` — outbound HTTP for telegram + vercel + anthropic + github (24 callers)** | **+10** | **45%** |
| S3      | `fs.ts` — fs read/write behind capability checks                                      | +10     | 55%     |
| S4      | `shell.ts` — shell behind allowlist (defers to push_bash_automation)                  | +5      | 60%     |
| S5      | `browser.ts` — Puppeteer behind capability checks                                     | +5      | 65%     |
| S6      | `google.ts` — Gmail + Sheets adapters                                                 | +5      | 70%     |

S2 covers HTTP (1 of 4 unification axes per foundation spec — HTTP/fs/shell/browser) but represents ~40% of total ad-hoc-call volume across all axes — hence +10 of the +25 remaining unification points. S3-S5 split the remaining 15 points across fs (+10), shell (+5), browser (+5).

**S2's contribution: +10 percentage points.** Honest landing — the unified surface for HTTP unblocks scout/reviewer/deployer/self_repair from needing bespoke fetch wrappers, but it doesn't help fs/shell/browser yet. Acceptance H pins the 45% number; if S2 ships fewer than 24 callers (e.g., GitHub Phase C slips), redline this number to match the real coverage.

---

## Out of scope

- **Gmail / Sheets adapters** — Slice S6. Different auth model (OAuth refresh) than bearer-token pattern. Defer.
- **Puppeteer / browser** — Slice S5. Different shape (long-lived sessions vs request/response). Defer.
- **Retries / exponential backoff** — Existing `retryFetch` inside `deploy-gate.ts` stays inline. Do not extract or generalize in S2. Hides root causes.
- **Circuit breakers** — BBV repo has a dedicated `circuit-breaker` skill; cross-pollination is a future call.
- **Secrets indirection** — Security_layer slice 4. AD5 explicit defer.
- **F18 morning_digest line for HTTP volume** — Not in S2. Sketch the shape when volume tells us what's anomalous.
- **Migration of Ollama / Amazon SP-API / Keepa / eBay callers** — 16 raw `fetch()` calls in `lib/{ollama,amazon,keepa,ebay,orb}/`. Product-feature plumbing, not harness infrastructure. Recommendation in §Open Q4: scope-cap arms_legs at "harness outbound" and leave product features as raw fetchers.
- **Enforce-mode flips for any net.\* cap** — Security_layer slice 7. S2 ships clean across both modes via the discriminated `ArmsLegsHttpResult`.

---

## Open questions — flag, do not guess

**Q1 and Q2 from earlier draft are resolved in-spec** — see §Migration plan Phase C (registry patch for `net.outbound.github`) and Phase D (registry patch for `net.outbound.self`). Remaining open questions retain their original numbering for stable cross-reference:

3. **Option C semantics in `enforce` mode.** Currently every `net.outbound.*` row is `log_only`, so deny is theoretical. When security slice 7 flips to `enforce`, two readings of Option C: (a) keep returning `{allowed:false}` — caller decides; (b) at `enforce` mode, throw because the contract semantically tightened. **Q: which?** Recommendation: (a). Stable discriminated-union shape across modes; callers who want fail-fast write `if (!r.allowed) throw`. This question matters at the moment of the flip, not at S2 ship time.

4. **`net.outbound.anthropic` route narrowing.** The cap is one string, but Anthropic has two distinct surfaces in use today: `/v1/messages` (LLM API) and `/v1/claude_code/routines/.../fire` (Claude Code routines). Different cost models, different blast radii. **Q: split into `net.outbound.anthropic.messages` and `net.outbound.anthropic.routines`?** Recommendation: keep as one cap in S2. Splitting later is a 2-row migration + grep migration; speculation now adds noise. Revisit if a single rogue agent burns budget on one surface and we want fine-grained revoke.

5. **`supabaseRPC` arg redaction default.** RPC args may contain PII (user IDs, emails). **Q: audit row records arg KEYS only, with `auditArgs?:'keys'|'values'|'none'` opt-in for callers that want more?** Recommendation: keys-only default. Same posture for `httpRequest` body — keys-only by default, full-value opt-in is per-call.

6. **`httpRequest` capability type.** S1 will export some `Capability` type — likely `string` aliased, or a string-literal union. **Q: does S2 narrow it (compile-time safety against typos like `'net.outboud.github'`) or stay loose (allow forward-compat with unseen caps)?** Recommendation: narrow, sourced from `lib/security/capabilities.ts` enum or the `capability_registry` rows generated at build-time. Lint-check'd against the registry in CI.

7. **Product-feature HTTP callers (Ollama, Amazon SP-API, Keepa, eBay).** 16 raw `fetch()` calls in `lib/{ollama,amazon,keepa,ebay,orb}/`. **Q: do these ever migrate to `arms-legs/http.ts`, or does `arms_legs` scope-cap at "harness outbound only" and leave product features as direct fetchers?** Recommendation: scope-cap. These are app-internal API clients; routing them through arms_legs adds audit overhead with low security upside (they're not agent-driven; they're called from product routes with their own auth). Keep raw. If approved, add to §Out of scope explicitly.

---

## Dependencies on other components

### Hard prerequisites (S2 cannot ship without these)

| Component                | What S2 needs                                                                     | Live status (verified 2026-04-28) |
| ------------------------ | --------------------------------------------------------------------------------- | --------------------------------- |
| `arms_legs` S1           | `Capability` type + `ActionEnvelope` + `runAction()` plumbing                     | ⬜ queued (W1)                    |
| `security_layer` slice 1 | `agent_actions` table for cap-check audit rows                                    | ✅ live (table verified)          |
| `security_layer` slice 2 | `capability_registry` (34 rows) + `agent_capabilities` (9 net grants) + base seed | ✅ live                           |

### Soft dependencies

| Component                                  | What it adds                                                        | Defer to                         |
| ------------------------------------------ | ------------------------------------------------------------------- | -------------------------------- |
| `security_layer` slice 4 (`secrets.get()`) | Replaces AD5's direct `process.env` reads with audited secret reads | Re-touches `http.ts` once landed |
| `f18_surfacing`                            | Morning-digest line for HTTP volume + denies                        | Future slice — shape post-volume |

### Downstream consumers (S2 unblocks)

| Component              | What S2 unlocks                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `scout_agent` (future) | `httpRequest` for outbound research without bespoke fetch wrappers                       |
| `chat_ui` (future)     | LLM tool surface includes pre-bound `telegram`, `vercelRead` already audited             |
| `self_repair` (future) | `httpRequest({ ..., capability:'net.outbound.github' })` for PR-open from inside sandbox |
| `deploy_gate`          | Already uses these surfaces; gets free audit + capability-deny safety                    |

---

## Risks called out for redline

- **R1.** S1 contract drift. If S1's `ActionEnvelope` shape changes during W1 build, S2 spec needs a redline before Phase A. Mitigation: coordinator reads S1's handoff JSON before S2 opens; coordinator-window sets a watchpoint on `lib/harness/arms-legs/index.ts`.
- **R2.** Audit-row volume. ~50–200 outbound calls/day today. AD4 says one cap_check row + one outcome row per call. At ~10 inserts/sec sustained the table is fine; at 500/sec it's not. Mitigation: monitor row growth post-deploy; sample in a future slice if needed.
- **R3.** Telegram bot routing. `deploy-gate.ts:623` is the ONLY caller routing to the alerts bot; the other 6 use builder. If `telegram(text, { bot:'alerts' })` accidentally falls through to builder default, FAIL alerts go to the wrong place. Mitigation: explicit unit test in C asserts bot routing — assert URL contains the alerts-bot token, not builder's.
- **R4.** Body serialization. Object body with implicit JSON works for 24/24 in-scope callers. `multipart/form-data` (image upload, file upload) needs `body: FormData` branch. None of the 24 use multipart; if a future caller does, escape hatch needs updating. Mitigation: TS type already accepts `BodyInit`; runtime branch is one `if (body instanceof FormData)`.
- **R5.** Test mock surface. 5 callable surfaces × 2 paths (allowed/denied) × N callers = a lot of fixture. Mitigation: factor `mockArmsLegs(grants)` helper in the first test file; reuse across all caller test files.
- **R6.** Coordinator mistakenly gets `net.outbound.vercel.deploy`. AD3 relies on the seed: only builder has it. If a future grant accidentally adds coordinator, deploys could fire from coordinator code paths. Mitigation: parity test (acceptance F.5) asserts the absence; CI blocks on drift.

---

## Working agreement reminders

- Specs first, code second.
- No padding. S2 lands at +10 points (30 → 45). Honest. Remaining 25 points are S3–S6.
- Acceptance tests written before building (§Acceptance criteria, above).
- Doc-as-source: this file is authoritative once approved; `lib/harness/arms-legs/http.ts` follows it.
- Read existing files before drafting anything new — done; 17 fetch-caller files audited inline; live capability registry queried (6 net rows / 34 total / 9 net grants).
- **This window is SCOPE ONLY. No code, no commits beyond this spec doc.**
