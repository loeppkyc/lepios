# SECURITY_LAYER_SPEC

**Status:** APPROVED (Draft 2, 2026-04-28). Colin redline applied — AD7 (self-protection) added.
**Source of truth:** This doc.
**Authority:** Migration `0045_security_layer_schema.sql` is being written from this doc.
**Parent spec:** [`HARNESS_FOUNDATION_SPEC.md`](HARNESS_FOUNDATION_SPEC.md) — `security_layer` is harness component #11 (T3, weight 7, currently 30%, target 70%).
**Sibling spec:** [`MEMORY_LAYER_SPEC.md`](MEMORY_LAYER_SPEC.md) — written same day; same doc style.

**Redline notes (Draft 1 → Draft 2):**

- **AD7 added** — the four security tables (`agent_actions`, `capability_registry`, `agent_capabilities`, `harness_config`) are themselves write-protected at the **Postgres GRANT level**, deeper than RLS. `service_role` bypasses RLS but cannot bypass GRANTs. Audit log is append-only for everyone except `postgres` (migrations).
- **M7 added** — implementation mechanics for AD7 (REVOKE/GRANT discipline, column-level GRANTs on `harness_config`).
- AD7 work folds into priority slices 1–2 (table-creation level, not application-logic level).

---

## At a glance

| Field                              | Approved                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Component count change             | **0** (extends `security_layer` scope; no new harness rows)                                              |
| New tables                         | **1** — `agent_actions` (immutable audit log)                                                            |
| Extended tables                    | **1** — `harness_config` gains `description` + `last_accessed_at` columns                                |
| New endpoints                      | **0** — secrets are server-side only; capability checks are in-process                                   |
| New libraries                      | **3** — `lib/security/{capabilities,secrets,audit}.ts`                                                   |
| New agent frontmatter              | **`caps:` array** in every `.claude/agents/*.md`                                                         |
| Migration                          | **0045** — single file: `agent_actions` + `harness_config` extension + RLS                               |
| Honest target for `security_layer` | **30% → 70%** (matches foundation spec priority #1 in parallel with `digital_twin`)                      |
| Estimated effort                   | **~3 days wall-clock** (matches foundation spec)                                                         |
| Default posture                    | **Default deny** — agents start with empty capability set                                                |
| Enforcement rollout                | **Log-only → enforce**, per-capability flip (not big-bang)                                               |
| Self-protection model              | **DB GRANT-level** — `agent_actions` append-only for `service_role` too; registries migration-only (AD7) |

---

## The problem (verbatim from kickoff)

Security_layer is foundation spec priority #1 because it's the prereq for `sandbox`,
`push_bash_automation`, and `self_repair`. Without capability scoping + audit trail +
secrets indirection, those three components cannot ship safely.

**What's live today (per foundation spec, verified 2026-04-28):**

- `lib/harness/branch-guard.ts` — branch-naming guard (S-L3) with audit signal in `agent_events`
- `CLAUDE.md §5` — secrets-redaction rules (no echoing tokens; first 4 / last 4 mask)
- `.husky/pre-commit` → `lint-staged` + `scripts/ai-review.mjs` (Sonnet diff review)
- `lib/safety/checker.ts` — six-rule pre-execution check: destructive SQL, secret-leak regex, missing tests, scope creep, missing rollback, Zod coverage. Logs to `agent_events.action='safety.check'`.
- `harness_config` table — DB-resident runtime config (S-L1, `is_secret` flag exists but unused as a real boundary)
- INC-001/INC-002 — known git-history token exposures, both revoked, history not rewritten (risk accepted while repo private)

**What's missing:**

1. **Per-agent capability scope** — every agent (coordinator, builder, future scout, future reviewer) currently has the union of all tool surfaces available. No declared scope. No enforcement.
2. **Secrets indirection** — 65 `process.env.X` reads across 23 lib files, 54 across 26 app files. Direct env reads with no audit trail. `lib/supabase/service.ts` reaches `SUPABASE_SERVICE_ROLE_KEY` with a non-null assertion at module init.
3. **Agent-action audit log** — `agent_events` mixes informational signal (heartbeats, ship events, escalations) with what should be security-relevant signal (capability denies, secret accesses). No append-only contract; rows can be UPDATEd or DELETEd by anything with the auth role.
4. **Sandbox-boundary contract** — `sandbox` (component #10) is at 0%. When it lands it needs an interface to ask "is this agent allowed to do X in this scope?" That interface doesn't exist.

---

## Architecture decisions (seven)

### AD1. Capability granularity — **per-domain with per-action overlay for high-blast surfaces**

Pure per-action (`read_file`, `write_file`, `run_shell`) is too granular: every new module introduces N capabilities and the registry grows uncontrollably.

Pure per-domain (`fs`, `net`, `db`, `shell`) is too coarse: granting `fs` means granting `fs.delete` too, which is a different blast radius than `fs.read`.

**The hybrid:** capabilities are domain-scoped strings of the form `{domain}.{action}[.{target}]`. Action is required for write-side domains; target is optional and used to narrow further.

```
fs.read                     # any path within repo root
fs.read:/etc/secrets        # specific path scope (deny)
fs.write
fs.delete                   # always escalates separately from fs.write
net.outbound.telegram       # outbound HTTP to Telegram
net.outbound.vercel.deploy  # narrower — Vercel deploy API specifically
net.outbound.*              # wildcard, default deny
db.read.knowledge           # SELECT on a table
db.write.task_queue         # INSERT/UPDATE on a table
db.migrate                  # apply_migration via MCP
shell.run                   # atomic; allowlist of patterns checked separately
git.commit
git.push
git.force_push              # always escalates
```

**Why this shape:**

- Domain prefix lets a module check `cap.startsWith('db.')` for all DB ops without listing each one.
- Action is required for the dangerous domains (fs, db, git) where read/write/delete have very different blast.
- Target (optional) lets us write `fs.read:/etc/secrets` deny rules without polluting the action namespace.
- Wildcards (`*`) supported in the registry so `net.outbound.*` works as a base scope.
- New capability strings don't need code changes — they live in the registry table, not in TypeScript enums.

**Open question (redline):** do we model `shell.run` allowlist (e.g. `npm test`, `git status`) as separate capabilities (`shell.run:npm.test`) or as a separate `shell_allowlist` table? Recommendation: separate table — `shell.run` is a yes/no capability; the allowlist of what shell commands are auto-approved is a different concern (it's about command-pattern matching, not actor-scoped capability). Lives in `push_bash_automation` (component #13), not here. **Accepted in Draft 1.**

### AD2. Default deny — **explicit, no exceptions**

Given $800k blast radius (BBV LIVE Stripe + LepiOS + Megan's app), default-allow is unacceptable. Every agent starts with an empty capability set; needed capabilities are declared in the agent's frontmatter and granted at registration time.

Concretely:

- `requireCapability(agentId, cap)` returns `{ allowed: false, reason: 'no_grant_for_agent' }` if the agent has no rows in the registry.
- A capability not in the canonical registry returns `{ allowed: false, reason: 'unknown_capability' }`.
- Agents that haven't been registered (no row in `agent_capabilities`) return `{ allowed: false, reason: 'unregistered_agent' }`.
- Wildcard grants are explicit: `db.read.*` must be granted as that exact string. `db.read.x` does NOT inherit from a non-existent `db.*` grant.

The system tells you what's missing, but it never auto-extends.

### AD3. Layered with Claude Code's tool permissions, not replacing — **CC outer, security_layer inner**

Claude Code already has its own permission model: `settings.json` allow/deny lists, `PreToolUse` hooks, the per-call user-prompt confirmation dialog. That layer is the **outermost** guard for any agent running as a CC subprocess (which is most of them today).

Security_layer is the **inner** guard. It runs at the application boundary inside the Next.js process and inside any future autonomous loop (chat_ui, daytime Ollama, scout_agent). Concretely:

- When coordinator/builder run as CC subagents, both layers fire. CC catches the tool call at the OS boundary; security_layer catches the application action at the in-process boundary. Both must allow.
- When chat_ui or scout_agent run autonomously inside the Next.js process (no CC subprocess), security_layer is the only guard. CC is not in the picture.
- The two layers don't talk to each other. Each is independently enforcing. We document this clearly so that bypassing one (e.g. running an autonomous loop) doesn't bypass both.

**Concrete rule:** every agent action that calls into a `lib/security/capabilities.ts` checkpoint logs to `agent_actions` regardless of whether CC also fired. We get the layered audit trail for free.

### AD4. Secrets vault — **extend `harness_config`, defer external vault**

Three options were on the table:

1. **Extend `harness_config`** — add `last_accessed_at`, `description`, mark `is_secret=true` rows as the canonical secrets store. `secrets.get(name, agentId)` reads from this table, logs access to `agent_actions`. Already exists. RLS-locked. Service-role-only.
2. **Doppler / Infisical / Vault SaaS** — buy. More features (rotation, audit UI, sealing). Costs $/month + adds an external dependency that must be reachable.
3. **Supabase Vault (`pgsodium`)** — encrypted column storage in the same DB. Requires `pgsodium` extension enable + key management.

**Pick (1)**, defer (3) to a v2. Reasoning:

- (1) is zero new infrastructure. The table exists; the RLS exists; we add two columns and a wrapper.
- (3) is the right answer when the secret count grows past ~20 or when rotation cadence becomes routine. Today there are ~10 secrets total and rotation is rare. Premature.
- (2) has no advantage over (1) at this scale — extra dependency for the same enforcement boundary.

**Concrete shape:**

```typescript
// lib/security/secrets.ts
export async function get(
  name: string,
  agentId: string,
  opts?: { reason?: string }
): Promise<string>
// Reads from harness_config WHERE key=name AND is_secret=true.
// Verifies agentId has cap `secret.read:<name>` or `secret.read.*`.
// Inserts an agent_actions row regardless of allow/deny.
// Throws if denied (Error class with reason).
// Updates harness_config.last_accessed_at.
```

`process.env.X` reads are NOT removed in v1 — they continue to work for non-secret values (region names, public URLs, feature flags). The migration is **only for `is_secret=true` rows**: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `TELEGRAM_BOT_TOKEN_ALERTS`, `TELEGRAM_BOT_TOKEN_BUILDER`, `TELEGRAM_BOT_TOKEN_DAILY`, `STRIPE_SECRET_KEY` (when ported), etc.

**Off-ramp signal:** if `harness_config` row count crosses 25 secrets, or rotation events exceed 1/month, escalate the move-to-Vault decision.

### AD5. Audit log distinct from `agent_events` — **`agent_actions`, append-only, never deleted**

`agent_events` mixes informational and security-relevant signal:

| Today's `agent_events`               | Belongs in...                                                  |
| ------------------------------------ | -------------------------------------------------------------- |
| heartbeat, ship.\*, escalate.\*      | `agent_events` (informational, OK)                             |
| safety.check, branch_guard_triggered | both — keep mirror in events; canonical row in `agent_actions` |
| capability_denied (new)              | `agent_actions` only                                           |
| secret_accessed (new)                | `agent_actions` only                                           |
| destructive_op_attempted (new)       | `agent_actions` only                                           |
| sandbox_escape_detected (new)        | `agent_actions` only                                           |

**Why distinct:**

- **Retention.** `agent_events` is candidate for periodic trim (after N months). `agent_actions` is never deleted. Different policies need different tables.
- **Mutability.** `agent_events` is implicitly mutable (rows can be UPDATEd if needed). `agent_actions` enforces append-only via RLS denying UPDATE/DELETE. Two RLS profiles, two tables.
- **Volume.** `agent_events` is high-volume (every heartbeat). `agent_actions` is low-volume (capability checks, secret reads). Indexing strategies differ.
- **Audit narrative.** "Show me everything that touched secrets last week" should be a single-table SELECT with a clear actor/cap/result schema, not a filter through heartbeats.

**Schema sketch (full DDL in §M2 below):**

```sql
agent_actions(
  id, occurred_at,
  agent_id, capability, target,             -- who/what/scope
  action_type,                              -- 'cap_check' | 'secret_read' | 'destructive_op' | 'sandbox_check' | 'override'
  result,                                   -- 'allowed' | 'denied' | 'error'
  reason,                                   -- enum-ish: 'no_grant_for_agent' | 'unknown_capability' | 'in_scope' | ...
  context,                                  -- jsonb: task_id, session_id, sandbox_id, file_path, sql_excerpt
  parent_action_id                          -- for follow-up rows (success/failure of the action that was checked)
)
```

The **parent_action_id** chain lets a single capability check produce: row 1 (`cap_check` → allowed), row 2 (the actual side-effect outcome — `success` or `error`). Auditors trace the chain.

### AD6. Enforcement rollout — **log-only first, enforce per-capability**

A big-bang flip from "no enforcement" to "default deny" would brick the running harness for hours. Instead, every capability has an `enforcement_mode` column with three states:

- `log_only` — `requireCapability` always returns `{ allowed: true }`, but logs the would-be deny to `agent_actions.action_type='cap_check', result='allowed_log_only'`. Used to discover real usage patterns before flipping.
- `warn` — returns allowed, logs as `result='allowed_warn'`, also fires a one-line Telegram to alerts bot. Used for capabilities we're about to flip; gives Colin one cycle to see the volume.
- `enforce` — returns deny when grant absent. Throws or returns false depending on caller pattern.

A capability can be promoted: `log_only` → `warn` → `enforce`. Demotions allowed (rollback). The capability registry table holds this state.

**Rollout sequence (concrete):**

1. **Day 1:** all capabilities land in `log_only`. Nothing breaks. Audit trail starts populating.
2. **Day 2:** `secret.read.*` capabilities flip to `enforce` for the four known secrets (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, two Telegram tokens). Coordinator + builder agents pre-granted these.
3. **Day 3:** `db.migrate` flips to `enforce` for builder only. Coordinator does not have `db.migrate`. (This codifies the existing rule.)
4. **Day 4+:** other capabilities flipped one at a time as confidence and grants stabilize.

Day 1's success criterion: 24h of `log_only` data with **zero** unexpected `agent_id`s. If an unexpected agent_id appears (i.e., something is calling `requireCapability` we didn't register), do not flip until that's resolved.

### AD7. Self-protection — the security layer cannot be modified at runtime by the agents it guards

The four tables introduced or extended by this spec — `agent_actions`, `capability_registry`, `agent_capabilities`, `harness_config` — are themselves high-value targets. An agent with ambient `db.write.public.*` capability could grant itself any capability or wipe the audit log. **A security layer that can be disabled by the agents it guards is not security; an audit log that can be edited is not an audit log.**

**Enforcement boundary:** Postgres **GRANT level**, deeper than RLS. RLS is bypassed by `service_role`; GRANTs are not. The protection matrix:

| Table                 | `service_role` / `authenticated`                                              | `postgres` (migrations only) |
| --------------------- | ----------------------------------------------------------------------------- | ---------------------------- |
| `agent_actions`       | `SELECT`, `INSERT` only                                                       | full                         |
| `capability_registry` | `SELECT` only                                                                 | `INSERT`, `UPDATE`, `DELETE` |
| `agent_capabilities`  | `SELECT` only                                                                 | `INSERT`, `UPDATE`, `DELETE` |
| `harness_config`      | `SELECT`; `UPDATE` allowed only on `(last_accessed_at, access_count)` columns | full                         |

**Concrete mechanics:**

- `REVOKE ALL ... FROM PUBLIC, authenticated, anon, service_role` on each table after creation. Then `GRANT` only the minimum back. Service_role bypasses RLS but does NOT bypass table-level or column-level GRANTs.
- New capability grants (rows in `agent_capabilities`) ship as part of versioned migrations. PR'd, CI-gated, applied via the `postgres` role (Supabase's migration role). No runtime path can write to this table.
- `agent_actions` is write-once. Any UPDATE or DELETE attempt from `service_role` returns `permission denied for table agent_actions` at the DB layer. Corrections require a new migration that explicitly INSERTs an `action_type='override'` row — visible in the audit trail.
- `harness_config.value` (the secret content) cannot be UPDATEd from runtime. Rotation = new migration. Tracking columns (`last_accessed_at`, `access_count`) ARE writable from `service_role` to support `secrets.get()`'s access logging — column-level GRANT.

**Capability namespace consequence:** there is no `security.grant`, `security.revoke`, `security.modify_audit` capability in the registry. Those operations are not callable from any agent — they're only reachable via deploy-time migrations. Asking `requireCapability('security.grant', ...)` returns `unknown_capability`. Checking would be a category error: the boundary is enforced one layer below the application, at the DB role/grant level.

**The trust statement.** The security layer trusts:

1. Supabase's role separation between `postgres` and `service_role`.
2. The CI pre-push gate (`scripts/ai-review.mjs` + lint-staged) on every migration.
3. Colin's review of any PR touching `supabase/migrations/0045_*.sql` or successors.

These trusts define the perimeter. Anything below them is out of scope for this layer (it's Supabase's security model, not LepiOS's).

**Self-grant attack vector — closed.** The kickoff scenario "an agent with `db.write` could grant itself any capability" is structurally impossible:

- `db.write` capability strings target specific tables. `db.write.agent_capabilities` is **not** in the registry seed.
- Even if a future migration accidentally added that grant, the table-level REVOKE still denies the INSERT — `service_role` has no INSERT privilege on `agent_capabilities`.
- The only path to grant a new capability is a deploy-time migration through CI gate + Colin approval.

**Audit-log-tampering attack vector — closed.** Service_role has no UPDATE or DELETE on `agent_actions`. Even a fully-compromised application process cannot rewrite history. Modifications require a `postgres`-role migration which is itself version-controlled.

---

## Component specs

### M1. `lib/security/capabilities.ts` — registry + `requireCapability()`

In-process module. No HTTP surface. Reads from `agent_capabilities` table on first call (cached for the process lifetime; cache invalidation on SIGHUP-equivalent / Vercel cold start, which is fast enough for this scope).

**Interface:**

```typescript
export interface CapabilityCheck {
  agentId: string // 'coordinator' | 'builder' | 'scout' | 'reviewer' | future
  capability: string // canonical cap string per AD1
  target?: string // optional narrowing scope (file path, table name, SQL excerpt)
  context?: {
    taskId?: string
    sessionId?: string
    sandboxId?: string // set when running inside the sandbox component
    reason?: string // free-form, recorded in audit
  }
}

export interface CapabilityResult {
  allowed: boolean
  reason: string // enum-ish — see §M2 audit reasons
  enforcement_mode: 'log_only' | 'warn' | 'enforce'
  audit_id: string // UUID of the agent_actions row written
}

export async function requireCapability(check: CapabilityCheck): Promise<CapabilityResult>

// Variant that throws on deny — for call sites that want fail-fast.
export async function assertCapability(check: CapabilityCheck): Promise<void>

// For sandbox component to ask "is this agent allowed to do X here?"
export async function checkCapability(check: CapabilityCheck): Promise<CapabilityResult>
// Same as requireCapability but never throws regardless of mode. Always returns the result object.
```

**Files:**

- `lib/security/capabilities.ts` — implementation
- `lib/security/types.ts` — `Capability`, `CapabilityCheck`, `CapabilityResult`, `EnforcementMode` types
- `tests/security/capabilities.test.ts` — happy path, default-deny, log_only mode, wildcard match

### M2. `agent_actions` table — append-only audit log

**Schema (Migration 0045, first table):**

```sql
CREATE TABLE public.agent_actions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Who / What / Scope
  agent_id        TEXT         NOT NULL,                       -- 'coordinator', 'builder', 'scout', etc.
  capability      TEXT         NOT NULL,                       -- canonical cap string per AD1
  target          TEXT,                                        -- optional narrowing scope

  -- Categorization
  action_type     TEXT         NOT NULL
                  CHECK (action_type IN (
                    'cap_check',          -- requireCapability invocation
                    'secret_read',        -- secrets.get invocation
                    'destructive_op',     -- DROP, TRUNCATE, force_push, etc.
                    'sandbox_check',      -- sandbox boundary query
                    'override'            -- Colin manually overrode a deny
                  )),

  -- Outcome
  result          TEXT         NOT NULL
                  CHECK (result IN (
                    'allowed',
                    'allowed_log_only',
                    'allowed_warn',
                    'denied',
                    'error'
                  )),
  reason          TEXT         NOT NULL,                       -- enum-ish, see below
  enforcement_mode TEXT        NOT NULL
                  CHECK (enforcement_mode IN ('log_only','warn','enforce')),

  -- Context
  context         JSONB        NOT NULL DEFAULT '{}'::jsonb,   -- {task_id, session_id, sandbox_id, sql_excerpt, file_path, ...}
  parent_action_id UUID        REFERENCES public.agent_actions(id) ON DELETE NO ACTION,

  -- Generated FTS — operators can grep
  fts             tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(agent_id,'') || ' ' ||
      coalesce(capability,'') || ' ' ||
      coalesce(target,'') || ' ' ||
      coalesce(reason,'') || ' ' ||
      coalesce(context::text,'')
    )
  ) STORED
);

CREATE INDEX agent_actions_recent_idx       ON public.agent_actions (occurred_at DESC);
CREATE INDEX agent_actions_agent_idx        ON public.agent_actions (agent_id, occurred_at DESC);
CREATE INDEX agent_actions_capability_idx   ON public.agent_actions (capability, occurred_at DESC);
CREATE INDEX agent_actions_denied_idx       ON public.agent_actions (occurred_at DESC) WHERE result = 'denied';
CREATE INDEX agent_actions_secret_idx       ON public.agent_actions (occurred_at DESC) WHERE action_type = 'secret_read';
CREATE INDEX agent_actions_fts_idx          ON public.agent_actions USING GIN (fts);

-- Append-only enforcement: deny UPDATE and DELETE for all roles except service_role.
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_actions_insert_authenticated" ON public.agent_actions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "agent_actions_select_authenticated" ON public.agent_actions
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- No UPDATE policy. No DELETE policy. → Deny by default for authenticated.
-- AD7: service_role does NOT bypass these — it's locked at the GRANT level (see M7).
-- The migration's REVOKE/GRANT block, not a CLAUDE.md note, is the load-bearing protection.
```

**Reason taxonomy (the canonical strings written to `reason`):**

| Reason                 | When                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| `unregistered_agent`   | `agent_capabilities` has no row for this agent_id                            |
| `unknown_capability`   | Capability string not in registry                                            |
| `no_grant_for_agent`   | Agent registered, capability registered, but no grant connecting them        |
| `in_scope`             | Allowed because agent has a matching grant                                   |
| `wildcard_grant`       | Allowed via a `*` grant (logged separately so we can audit wildcard usage)   |
| `target_denied`        | Agent has the cap, but target string matches a deny rule                     |
| `enforcement_log_only` | Returned allowed because mode is `log_only` (would have denied if enforcing) |
| `enforcement_warn`     | Returned allowed but Telegram-warned                                         |
| `colin_override`       | Colin manually allowed via Telegram callback                                 |
| `sandbox_required`     | Cap requires a sandbox context but call was outside one                      |
| `sandbox_in_scope`     | Cap was checked from inside a sandbox; allowed within sandbox bounds         |

### M3. `lib/security/secrets.ts` — secrets indirection

```typescript
// Reads from harness_config WHERE key=name AND is_secret=true.
// Always logs to agent_actions (action_type='secret_read').
// Throws SecretAccessError on deny in 'enforce' mode.
export async function get(
  name: string,
  agentId: string,
  opts?: { reason?: string; sandboxId?: string }
): Promise<string>

// Convenience: read multiple in one batch (cheaper, single capability check).
export async function getMany(
  names: string[],
  agentId: string,
  opts?: { reason?: string }
): Promise<Record<string, string>>
```

**Migration touchpoint for `lib/supabase/service.ts` (the canary):**

```typescript
// before
return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// after — Phase 2 of rollout, log_only initially
return createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!, // public, stays env
  await secrets.get('SUPABASE_SERVICE_ROLE_KEY', currentAgentId(), {
    reason: 'createServiceClient',
  })
)
```

**`currentAgentId()` resolution — decision: AsyncLocalStorage** (option 2 of three considered: function-arg threading, AsyncLocalStorage, `X-Agent-Id` header).

Implementation:

- AsyncLocalStorage context initialized at every API route entry, every cron entry, and at coordinator/builder session start.
- Fallback to a static `'system'` agent_id when no context is set (avoids hard-failing requests during the rollout window).
- Costs ~10 entry-point edits one time. Lands as part of slice 4 (`secrets.get()` canary), not slice 3 (middleware) — middleware accepts `agentId` as a parameter; only secrets.get() needs the implicit context.

Constraint per R5 (see Risks §): AsyncLocalStorage is Node-runtime only. Routes that run on Vercel Edge runtime cannot use `secrets.get()`; they must continue reading from `process.env` directly. Today no Edge-runtime routes hold secrets — verify in slice 4 before flipping enforce.

### M4. `agent_capabilities` table + `harness_config` extension

**Schema (Migration 0045, second table + alter):**

```sql
-- Capability registry — canonical list of every capability string the system knows about.
CREATE TABLE public.capability_registry (
  capability        TEXT         PRIMARY KEY,                  -- canonical string per AD1
  domain            TEXT         NOT NULL,                     -- 'fs','net','db','shell','git','secret','sandbox'
  description       TEXT         NOT NULL,
  default_enforcement TEXT       NOT NULL DEFAULT 'log_only'
                    CHECK (default_enforcement IN ('log_only','warn','enforce')),
  destructive       BOOLEAN      NOT NULL DEFAULT false,       -- always escalates regardless of grant
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Per-agent grants — connects an agent to a capability with an enforcement mode.
CREATE TABLE public.agent_capabilities (
  agent_id          TEXT         NOT NULL,
  capability        TEXT         NOT NULL REFERENCES public.capability_registry(capability) ON DELETE RESTRICT,
  enforcement_mode  TEXT         NOT NULL
                    CHECK (enforcement_mode IN ('log_only','warn','enforce')),
  target_pattern    TEXT,                                       -- optional regex; NULL = no target restriction
  granted_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  granted_by        TEXT         NOT NULL DEFAULT 'colin',     -- audit attribution
  reason            TEXT,                                       -- why this grant exists
  PRIMARY KEY (agent_id, capability)
);

CREATE INDEX agent_capabilities_agent_idx ON public.agent_capabilities (agent_id);

ALTER TABLE public.capability_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;

-- AD7: SELECT-only policies. INSERT/UPDATE/DELETE deliberately omitted — those operations
-- are denied for `authenticated` (no matching policy) and for `service_role` (GRANT-level
-- REVOKE in M7). Writes require a postgres-role migration. See M7 for the GRANT block.
CREATE POLICY "capability_registry_select" ON public.capability_registry
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

CREATE POLICY "agent_capabilities_select" ON public.agent_capabilities
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Extend harness_config with audit-friendly columns.
ALTER TABLE public.harness_config
  ADD COLUMN IF NOT EXISTS description       TEXT,
  ADD COLUMN IF NOT EXISTS last_accessed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_count      INTEGER NOT NULL DEFAULT 0;
```

**Initial seed (Migration 0045 third section):**

The full registry seed lives in the migration. Roughly ~30 capability rows covering fs/net/db/shell/git/secret/sandbox domains. Initial grants:

- **coordinator** — `db.read.*`, `db.write.{agent_events,task_queue,outbound_notifications,session_handoffs}`, `fs.read`, `fs.write` (within `docs/sprint-*/` and `docs/harness/`), `net.outbound.{telegram,vercel,supabase}`, `secret.read.{CRON_SECRET,TELEGRAM_CHAT_ID}`. **No** `db.migrate`. **No** `git.push` (uses Bash but commits via builder handoff, not direct).
- **builder** — superset of coordinator's writes plus `db.migrate`, `git.commit`, `git.push` (non-force), `fs.write` (full repo), `shell.run` (allowlist via `push_bash_automation`), `secret.read.{SUPABASE_SERVICE_ROLE_KEY,...}`.
- **scout** (future) — `db.read.*`, `net.outbound.{anthropic_search,vercel_docs,*}`, `db.write.idea_inbox`. **No** filesystem write. **No** secret reads beyond what its model needs.
- **reviewer** (future) — `db.read.*`, `fs.read`, `net.outbound.anthropic`. No writes, no migrations, no shell.
- **deployer** (future) — `net.outbound.vercel.deploy`, `db.write.agent_events` for deploy markers.

The seed grants live in the migration so they're versioned alongside the registry.

### M5. Sandbox boundary contract — interface only, no implementation

Sandbox component (#10, currently 0%) will consume this contract when it lands:

```typescript
// lib/security/sandbox-contract.ts — types and functions the sandbox component imports.

export interface SandboxScope {
  fs?: { allowedPaths: string[]; deniedPaths?: string[] }
  net?: { allowedHosts: string[]; deniedHosts?: string[] }
  db?: { mode: 'readonly' | 'readwrite'; allowedTables?: string[] }
  timeout_ms: number
}

export interface SandboxCheckRequest {
  agentId: string
  sandboxId: string
  capability: string
  target?: string
  scope: SandboxScope
}

// Called by the sandbox runtime before each side-effecting op inside the sandbox.
// Returns whether the op is allowed within both the agent's caps AND the sandbox scope.
export async function checkSandboxAction(req: SandboxCheckRequest): Promise<CapabilityResult>
```

**The sandbox component implements `runInSandbox()`, `escapeSandbox()`, etc.** — those are out of scope here. This spec only defines the question-answering interface that sandbox calls into. Sandbox spec doc will reference this contract.

### M6. Agent frontmatter — declared capability scope

Every `.claude/agents/*.md` gets a new frontmatter field:

```yaml
---
name: coordinator
description: Sprint planner for LepiOS...
tools: Read, Glob, Grep, Write, Edit, Bash
caps:
  - db.read.*
  - db.write.agent_events
  - db.write.task_queue
  - db.write.outbound_notifications
  - fs.read
  - fs.write:docs/sprint-*/**
  - fs.write:docs/harness/**
  - net.outbound.telegram
  - net.outbound.vercel.read
  - net.outbound.supabase
  - secret.read.CRON_SECRET
  - secret.read.TELEGRAM_CHAT_ID
---
```

The frontmatter `caps` array is the **declarative spec**. The migration's grant inserts mirror it. Drift between the two is a smoke-test failure (see §Acceptance).

**Why both frontmatter AND DB grants?**

- Frontmatter is what humans read and what Colin redlines.
- DB grants are what `requireCapability` reads at runtime.
- Both must agree. The smoke test is a parser that diffs them and fails CI on mismatch. Cheap; closes the spec-drift class entirely (similar pattern to F-L3 / F-L14).

### M7. Self-protection — DB-level GRANT discipline (the AD7 mechanism)

Implementation lives entirely in Migration 0045's GRANT statements. There is no runtime application code for M7 — the protection is **structural**, not procedural. Cannot be disabled by an application bug or a misconfigured agent because the application can't reach it.

**For `agent_actions` (immutable audit log):**

```sql
ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent_actions_insert" ON public.agent_actions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "agent_actions_select" ON public.agent_actions
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.agent_actions FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT, INSERT ON public.agent_actions TO authenticated, service_role;
-- No UPDATE. No DELETE. Service_role gets no exception.
```

**For `capability_registry` and `agent_capabilities` (registry is migration-only):**

```sql
ALTER TABLE public.capability_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "capability_registry_select" ON public.capability_registry
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.capability_registry FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT ON public.capability_registry TO authenticated, service_role;
-- INSERT, UPDATE, DELETE: postgres role only (i.e., migrations).

-- Same pattern applied to agent_capabilities.
```

**For `harness_config` (column-level UPDATE):**

```sql
REVOKE ALL ON public.harness_config FROM PUBLIC, authenticated, anon, service_role;
GRANT SELECT ON public.harness_config TO service_role;
GRANT UPDATE (last_accessed_at, access_count) ON public.harness_config TO service_role;
-- INSERT, full UPDATE, DELETE: postgres role only.
-- Authenticated and anon: zero access — preserves the lockdown from migration 0029.
```

**Defense-in-depth note:** RLS policies stay enabled even though GRANT is the primary boundary. If a future migration accidentally re-grants UPDATE to service_role, the RLS policy would still need its own explicit add to allow that path. Two locks; both must be picked.

**Why postgres-role-only writes for the registries:**

1. **Migration discipline** — capability changes are PR'd, reviewed, CI-gated. No runtime path can grant a capability without a Colin-approved migration.
2. **Audit trail by construction** — the migration file IS the audit trail for the registry. `git log supabase/migrations/*security*` shows every grant change with author, date, and reason.
3. **Replay safety** — recreating a prod-equivalent environment from migrations alone reproduces the exact capability grants. No drift from runtime mutations.

**Operational consequence — secrets rotation:**

Rotating a secret (e.g., `SUPABASE_SERVICE_ROLE_KEY`) now requires:

1. A migration that `UPDATE`s the row (runs as `postgres`).
2. PR + CI gate + Colin approval.
3. Apply via `mcp__claude_ai_Supabase__apply_migration`.

This is intentional friction. Compared to the current state (anyone with service_role can rotate at runtime), this trades convenience for an immutable rotation record. **If rotation cadence becomes routine (>1/month), revisit AD4 and consider the pgsodium / external vault path** — those provide programmatic rotation with audit, which the current approach does not.

---

## Migration scope — `0045_security_layer_schema.sql`

**Single migration, five logical sections. ~350 lines (DDL + seeds + AD7 GRANT/REVOKE block).**

```sql
-- 0045_security_layer_schema.sql
-- Security layer: agent_actions audit log + capability registry + harness_config extension.
-- Spec: docs/harness/SECURITY_LAYER_SPEC.md
--
-- 1. CREATE TABLE agent_actions + RLS (insert/select only) + AD7 REVOKE/GRANT (no UPDATE/DELETE).
-- 2. CREATE TABLE capability_registry + RLS + AD7 lockdown (SELECT only for non-postgres roles).
--    Seed ~30 canonical capability rows.
-- 3. CREATE TABLE agent_capabilities + RLS + AD7 lockdown.
--    Seed grants for coordinator + builder. (scout, reviewer, deployer grants land when those agents do.)
-- 4. ALTER TABLE harness_config ADD description, last_accessed_at, access_count.
--    AD7 column-level GRANT: service_role can UPDATE (last_accessed_at, access_count) only.
-- 5. UPDATE harness_components SET completion_pct=70 WHERE id='harness:security_layer'.
-- 6. (DEFERRED) INSERT decisions_log row — moved to a follow-on once 0044 lands.
--    Migration 0045 does NOT depend on 0044.
```

**Pre-migration check (must run before applying):**

```sql
-- Confirm 0044 already landed (decisions_log exists)
SELECT 1 FROM information_schema.tables
WHERE table_schema='public' AND table_name='decisions_log';
-- If no rows: stop. Apply 0044 first.

-- Confirm no agent_id strings collide with existing actor strings in agent_events
SELECT DISTINCT actor FROM agent_events;
-- Cross-reference manually — agent_id values must be a subset or aligned namespace.
```

**Rollback:**

```sql
ALTER TABLE public.harness_config DROP COLUMN IF EXISTS access_count;
ALTER TABLE public.harness_config DROP COLUMN IF EXISTS last_accessed_at;
ALTER TABLE public.harness_config DROP COLUMN IF EXISTS description;
DROP TABLE IF EXISTS public.agent_capabilities;
DROP TABLE IF EXISTS public.capability_registry;
DROP TABLE IF EXISTS public.agent_actions;
```

**Note on rollback:** dropping `agent_actions` destroys audit history. In production we accept that the rollback path destroys this — if we need to revert mid-flight, the audit log was incomplete anyway. Once we hit `enforce` mode for any capability, rollback is a Colin decision, not auto.

---

## Acceptance criteria (per F21 — written before code) — for the 30% → 70% target

### A. Schema lands cleanly

- [ ] Migration 0045 applies on prod. `list_tables` returns `agent_actions`, `capability_registry`, `agent_capabilities`.
- [ ] `harness_config` has new columns; existing rows have `description=NULL` (backfilled in a follow-on as keys are touched).
- [ ] `SELECT COUNT(*) FROM capability_registry >= 25`. (Final count to be set after redline lands; ~30 expected.)
- [ ] Coordinator + builder agent_capabilities rows present and match their `.md` frontmatter `caps:` array.

### B. Capability check round-trips

- [ ] `requireCapability({ agentId: 'coordinator', capability: 'db.read.knowledge' })` → `{ allowed: true, reason: 'in_scope', enforcement_mode: 'log_only' }` and writes one `agent_actions` row.
- [ ] `requireCapability({ agentId: 'coordinator', capability: 'db.migrate' })` → `{ allowed: true, reason: 'enforcement_log_only' }` (would be denied if enforced; coordinator does not have db.migrate).
- [ ] `requireCapability({ agentId: 'unknown_agent', capability: 'fs.read' })` → `{ allowed: false, reason: 'unregistered_agent' }` (denied even in log_only when agent doesn't exist — log_only applies to capability misses, not unregistered agents).
- [ ] `requireCapability({ agentId: 'coordinator', capability: 'fictional.cap' })` → `{ allowed: false, reason: 'unknown_capability' }`.

### C. Secrets indirection works for the canary

- [ ] `secrets.get('SUPABASE_SERVICE_ROLE_KEY', 'builder', { reason: 'createServiceClient' })` returns the value.
- [ ] One `agent_actions` row written: `action_type='secret_read', result='allowed', reason='in_scope'`.
- [ ] `harness_config.last_accessed_at` for that key updated within ≤ 1s.
- [ ] `secrets.get('SUPABASE_SERVICE_ROLE_KEY', 'reviewer')` (no grant) → throws `SecretAccessError` once `secret.read.SUPABASE_SERVICE_ROLE_KEY` is in `enforce` mode (Phase 2 day).

### D. Append-only enforcement (AD7 / M7)

- [ ] `UPDATE agent_actions SET reason='hacked' WHERE id=$1` from `authenticated` → `permission denied for table agent_actions`.
- [ ] `UPDATE agent_actions SET reason='hacked' WHERE id=$1` from **`service_role`** → `permission denied for table agent_actions`. (This is AD7's load-bearing test — RLS bypass does not save you.)
- [ ] `DELETE FROM agent_actions WHERE id=$1` from `service_role` → `permission denied`.
- [ ] `INSERT INTO agent_capabilities (agent_id, capability, ...) VALUES ('coordinator', 'db.migrate', ...)` from `service_role` → `permission denied for table agent_capabilities`.
- [ ] `INSERT INTO capability_registry (capability, ...) VALUES ('rogue.cap', ...)` from `service_role` → `permission denied for table capability_registry`.
- [ ] `UPDATE harness_config SET value='evil' WHERE key='SUPABASE_SERVICE_ROLE_KEY'` from `service_role` → `permission denied for column value`.
- [ ] `UPDATE harness_config SET last_accessed_at=now() WHERE key='SUPABASE_SERVICE_ROLE_KEY'` from `service_role` → succeeds (column-level GRANT allows the tracking columns only).
- [ ] All of the above writes ARE permitted from the `postgres` role (proven by the migration itself running). No additional acceptance test needed — if the migration applied, postgres works.

### E. Frontmatter ↔ DB grant smoke test

- [ ] `tests/security/frontmatter-grant-parity.test.ts`: parses every `.claude/agents/*.md` `caps:` array, queries `agent_capabilities` for that agent, asserts both sets equal. Fails on any drift.
- [ ] Test runs in CI; pre-push hook blocks divergence.

### F. F18 surfacing — morning_digest line

- [ ] New digest line: `Security layer (24h): N cap_checks, M denies, K secret_reads, J overrides`.
- [ ] If `denies > 0` for an agent that should be hands-off, fire alerts bot.

### G. Rollup honesty

- [ ] After 0045 + middleware live + secrets canary done: `harness_components.completion_pct` for `security_layer` updated from 30 → 70 in the same PR. Done in 0045's UPDATE step or follow-on.
- [ ] morning_digest next run reflects the bump.

### H. Documentation lands

- [ ] `CLAUDE.md §5` extended: capability model summary + pointer to this spec.
- [ ] `coordinator.md` and `builder.md` updated with `caps:` frontmatter.
- [ ] `decisions_log` row inserted recording this spec's decisions (per memory layer pattern).

---

## Priority order (within security_layer) — for the 3-day budget

Ranked by leverage and prerequisite-ness. Each item is a chunk-sized slice (acceptance-doc-able).

| #   | Slice                                                                                  | Effort        | Why first / Notes                                                                                                           |
| --- | -------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`agent_actions` table + AD7 GRANT lockdown + `lib/security/audit.ts` insert helper** | ½ day         | Smallest, no behavior change. Starts the audit trail today. M7's REVOKE/GRANT block lands here. Foundation for 2–6.         |
| 2   | **`capability_registry` + `agent_capabilities` tables + seed grants + AD7 lockdown**   | ½ day         | Schema + M7 GRANT discipline. Coordinator + builder pre-granted. `harness_config` column-level GRANT also lands here.       |
| 3   | **`requireCapability` middleware in log_only mode**                                    | 1 day         | Wire into ~5 call sites (`createServiceClient`, branch-guard, safety.checker, etc). All log_only — nothing breaks.          |
| 4   | **`secrets.get()` + canary on SUPABASE_SERVICE_ROLE_KEY**                              | ½ day         | Replace one `process.env` read; log only initially. Flip to enforce on day 2.                                               |
| 5   | **Agent frontmatter `caps:` + parity smoke test**                                      | ½ day         | Closes the F-L3/F-L14 spec-drift class for capabilities. Required by acceptance E.                                          |
| 6   | **F18 digest line + sandbox boundary contract types + AD7 acceptance D test runner**   | ½ day         | Closes acceptance F + ships the interface sandbox component (#10) will consume + automates the GRANT-protection assertions. |
| 7   | **Phase 2: flip `secret.read.*` for the four known secrets to enforce**                | (next sprint) | Day-2 in production, not part of initial 30→70 push.                                                                        |

**Slice 1–2 note:** AD7 / M7 work is structural (GRANT/REVOKE statements in the migration itself). It adds ~30 lines to the migration but no separate code chunk. Slices 1–2 absorb the work without effort change.

Total: **3 days end-to-end**, fully serial. With parallelism (1+2 same window, 3 after, 4+5 in parallel windows, 6 closing): **~2 days wall-clock.**

**Stop conditions / off-ramp:** if Day 1's `log_only` data shows >100 denies/hour from any one agent_id, the registry seed is wrong — pause flips and redline before continuing. If `agent_capabilities` parity test fails persistently in CI, the `caps:` frontmatter shape needs a rethink (perhaps move to a separate `caps.yml` file per agent).

---

## Out of scope (named for the avoidance of doubt)

- **Sandbox implementation** (component #10) — this spec defines only the boundary contract `checkSandboxAction()`. Sandbox component has its own scope doc.
- **`push_bash_automation`** (component #13) — its allowlist of auto-approved shell patterns is its own concern. Security_layer only provides the `shell.run` capability check.
- **`self_repair`** (component #12) — depends on full security_layer + sandbox; out of scope here.
- **External secrets vault migration** (Doppler / Vault / pgsodium) — deferred per AD4. Off-ramp signal: harness_config crosses 25 secrets or rotation goes monthly.
- **INC-001 git-history scrub** — separate decision (delete-and-restart vs filter-repo). Risk accepted while repo is private.
- **Multi-user RLS hardening** — `auth.uid() IS NOT NULL` matches existing single-user pattern; revisit when a second user is on the table (not soon).
- **CC permission-model integration** — security_layer does not read or modify CC's `settings.json`. The two layers are independently enforcing per AD3.
- **OAuth/session management for chat_ui** — gated on chat_ui (#14) shipping; that component has its own auth story.
- **Migration of all 65 `process.env` reads in `lib/`** — only secret-bearing reads migrate in v1. Public values (URLs, region names) stay as `process.env` reads.

---

## Integration plan with `HARNESS_FOUNDATION_SPEC.md`

Two follow-on edits to the foundation spec, applied at the same time as 0045's UPDATE step:

1. Replace the "Why 30%" paragraph in §`security_layer` with a blended-completion sub-table:

   | Sub-system                       | Weight inside security_layer | Today | Notes                                      |
   | -------------------------------- | ---------------------------- | ----- | ------------------------------------------ |
   | Audit log infrastructure         | 25%                          | 100%  | `agent_actions` live, append-only, indexed |
   | Capability registry + middleware | 30%                          | 80%   | Seeded; middleware in log_only mode        |
   | Secrets indirection              | 25%                          | 60%   | Canary done; remaining secrets pending     |
   | Frontmatter parity + smoke test  | 10%                          | 100%  | Test passing in CI                         |
   | Sandbox boundary contract        | 10%                          | 100%  | Interface defined; sandbox to consume      |

   Math: 0.25·1.00 + 0.30·0.80 + 0.25·0.60 + 0.10·1.00 + 0.10·1.00 = 0.25 + 0.24 + 0.15 + 0.10 + 0.10 = **0.84 ≈ 80%**.

   _(Note: the 30→70 step targets ~70%; the table above shows what 80% would look like — overshooting `secret.read._` enforce flips. Pick the right re-score after deploy.)\*

2. Foundation spec rollup math footer: `T3` total updated; total updated. Annotation: "security_layer 30 → 70 reflects audit table + log-only middleware + canary secret indirection. See SECURITY_LAYER_SPEC.md §M1–M6."

3. In §Priority section, replace `security_layer (30 → 70% planning)` with `security_layer (30 → 70%)` and link to this doc's §"Priority order".

No other foundation-spec edits.

---

## Risks called out for redline

- **R1.** `requireCapability` adds a DB round-trip per check. 100ms tail latency × N checks per route = real. Mitigation: in-process cache of the registry + grants, invalidated on cold start. Cache hit ratio > 99% expected.
- **R2.** Append-only RLS denies UPDATE/DELETE for authenticated role; service role bypasses. If anything in the app uses service role to mutate `agent_actions` (it shouldn't), we lose append-only. Mitigation: code review + grep for `agent_actions` writes in `lib/supabase/service.ts` callers.
- **R3.** Default-deny on a registered agent that's mid-task could throw on a capability the agent has always implicitly used. Day-1 log_only mode catches this — we discover the surface area before flipping. The risk is a flip without sufficient log_only soak.
- **R4.** Agent frontmatter is human-edited; drift from DB grants is the F-L3 / F-L14 class. The parity smoke test is the mitigation; CI must enforce.
- **R5.** AsyncLocalStorage pattern (AD4 redline) is Node-version-sensitive. Verify Vercel's runtime supports it (it does for Node ≥ 16; Edge runtime does not — restrict secrets.get() to Node-route handlers).
- **R6.** `process.env` reads outside the migrated-secrets set continue to work; nothing forces the migration. A new secret added via `process.env` directly won't be audited. Mitigation: lint rule (or `scripts/verify-safety.ts` extension) that flags new `process.env.X` reads where `X` matches a secret-y naming pattern (`*_KEY`, `*_TOKEN`, `*_SECRET`).
- **R7 (AD7-specific).** Secrets rotation now requires a migration. Today's runtime-rotation paths (none currently in use, but possible) will not work post-0045 — `UPDATE harness_config SET value=...` from `service_role` returns permission denied. Mitigation: documented in M7's "Operational consequence" — rotations go through PR + CI + Colin. Off-ramp: if rotation cadence exceeds 1/month, revisit AD4 (external vault).
- **R8 (AD7-specific).** Supabase's `service_role` privilege model could change in a future Supabase release (e.g., service_role gains the ability to override column-level GRANTs). Mitigation: the parity smoke test (acceptance D) runs on every CI cycle and will fail loud if `service_role` ever succeeds at an `UPDATE agent_actions`. Detect-and-alarm rather than detect-and-prevent (which is impossible for a runtime-only test).

---

## Working agreement reminders (per kickoff)

- Specs first, code second.
- No padding. Honest numbers — `security_layer` lands at 70%, not 90%. The remaining 30% is `enforce`-mode flips and the broader process.env migration, both of which take real soak time.
- Acceptance tests written before building (§Acceptance criteria, above).
- Doc-as-source: this file is authoritative once approved; migration 0045 follows it.
- Read existing files before drafting anything new — done; sources cited inline.
- This window is SCOPE ONLY. No migrations, no code, no commits beyond this spec doc.
