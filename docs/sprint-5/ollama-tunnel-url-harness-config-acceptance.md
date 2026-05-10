# Acceptance Doc — fix(ollama): OLLAMA_TUNNEL_URL → harness_config

**task_id:** c00e54e0-e531-4cdc-a6f5-e29a92e325ff  
**sprint:** 5 (harness track)  
**chunk:** ollama-tunnel-url-harness-config  
**authored_by:** coordinator  
**authored_at:** 2026-05-10T03:22:00Z  
**source:** morning_diagnostics_2026_04_28, task created 2026-04-27  

---

## Scope

Eliminate three remaining `process.env.OLLAMA_TUNNEL_URL` reads in production code so that
the harness_config row (key=`OLLAMA_TUNNEL_URL`) is the authoritative source for all Ollama
endpoint resolution — matching the S-L1 pattern already established by the coordinator-env
chunk. Scripts (`backfill-embeddings.ts`, `embed-streamlit-source.ts`, etc.) are out of scope;
they run locally where `process.env` is always available.

**Acceptance criterion:** After this fix, inserting `OLLAMA_TUNNEL_URL = 'https://example-tunnel.trycloudflare.com'`
into harness_config (with no Vercel env var set) causes `healthCheck()`, `runOllamaHealthSmoke()`,
and `getTunnelUsed()` in `daytime-tick.ts` to all resolve the tunnel URL from harness_config and
return `tunnel_used: true`. Confirmed by tests and by grounding checkpoint.

---

## Out of Scope

- Scripts (`scripts/backfill-embeddings.ts`, `scripts/embed-streamlit-source.ts`,
  `scripts/ingest-claude-md.ts`, `scripts/verify-step5-e2e.ts`) — local dev only, correct to read
  `process.env`
- Changing the `OLLAMA_TUNNEL_URL` value itself in harness_config — grounding checkpoint step for Colin
- Any changes to `lib/ollama/models.ts`, `lib/ollama/circuit.ts`, or other Ollama infrastructure

---

## Files Expected to Change

| File | Change |
|---|---|
| `lib/ollama/client.ts` | Fix `healthCheck()` line 265: derive `tunnelUsed` from resolved `baseUrl` (already computed at line 263), not from `process.env.OLLAMA_TUNNEL_URL` directly |
| `lib/harness/smoke-tests/ollama-health.ts` | Add `await hydrateOllamaConfig()` call at top; replace `process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434'` with `getBaseUrl()` |
| `lib/orchestrator/daytime-tick.ts` | Import `getBaseUrl` + `hydrateOllamaConfig` from `@/lib/ollama/client`; fix `getTunnelUsed()` to use `getBaseUrl()` instead of `process.env.OLLAMA_TUNNEL_URL` |
| `tests/ollama-client.test.ts` | Add/update tests that verify `tunnelUsed` in `healthCheck()` result derives from the resolved baseUrl (harness_config path), not from `process.env` |
| `tests/harness/ollama-health.test.ts` | Create (or expand existing) smoke test that mocks harness_config and verifies `runOllamaHealthSmoke()` uses the mocked URL |

---

## Check-Before-Build Findings

**What exists and is reusable (no new infrastructure needed):**

- `lib/ollama/client.ts` already has `hydrateOllamaConfig()` (async, TTL=5min) and
  `getBaseUrl()` (sync, reads module-level cache). These work correctly for all Ollama
  `generate()`, `embed()`, `autoSelectModel()` calls. The three violations are in
  `healthCheck()` and two callers outside the Ollama client module.

- `_resetOllamaConfigCache()` is already exported from client.ts for test isolation.
  Test suites in `tests/ollama-client.test.ts` already call it in `beforeEach()`.

- `OLLAMA_TUNNEL_URL` key is **not** in harness_config (confirmed: SELECT returned 0 rows).
  Colin must INSERT the row as part of the grounding checkpoint (see below).

**The specific violations:**

1. `lib/ollama/client.ts:264-265` — `healthCheck()` calls `getBaseUrl()` at line 263
   to resolve the URL, but then reads `process.env.OLLAMA_TUNNEL_URL` AGAIN at line 265
   to set `tunnelUsed`. These two reads can disagree if harness_config is authoritative.
   Fix: `const tunnelUsed = baseUrl !== 'http://localhost:11434' && !baseUrl.includes('localhost')`
   (using the already-resolved `baseUrl`).

2. `lib/harness/smoke-tests/ollama-health.ts:16` — reads `process.env.OLLAMA_TUNNEL_URL`
   directly with no harness_config awareness. Fix: add `await hydrateOllamaConfig()` at
   function start, then call `getBaseUrl()`.

3. `lib/orchestrator/daytime-tick.ts:55` — `getTunnelUsed()` reads `process.env.OLLAMA_TUNNEL_URL`
   directly. This function is called before `runDaytimeTick()` so it runs early in the handler.
   Fix: import `getBaseUrl` from client; `getTunnelUsed()` should become synchronous using
   the cache — caller must `await hydrateOllamaConfig()` first (already done in `checkOllamaHealth`
   which is the first check in `runDaytimeTick()`; ensure hydrate is called before `getTunnelUsed()`).

---

## External Dependencies Tested

- Ollama endpoint itself is NOT tested by builder. Tests mock the fetch call.
- harness_config Supabase read: already in production use via `hydrateOllamaConfig()`;
  no new auth or entitlement requirements.

---

## Grounding Checkpoint

Colin verifies after deploy:

1. **Insert the harness_config row** (must not be set as Vercel env var for a clean test):
   ```sql
   INSERT INTO harness_config (key, value)
   VALUES ('OLLAMA_TUNNEL_URL', 'https://your-actual-tunnel.trycloudflare.com')
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
   ```

2. **Verify `healthCheck()` returns `tunnel_used: true`:**
   ```bash
   curl -s GET https://lepios-one.vercel.app/api/cron/daytime-tick \
     -H "Authorization: Bearer {CRON_SECRET}" | jq '.tunnel_used'
   ```
   Expected: `true`

3. **Verify `agent_events` row** (emitted by `healthCheck()` on each tick):
   ```sql
   SELECT meta->>'tunnel_used', meta->>'base_url'
   FROM agent_events
   WHERE action = 'ollama.health'
   ORDER BY occurred_at DESC LIMIT 1;
   ```
   Expected: `tunnel_used = 'true'`, base_url matches the harness_config value.

Physical-world fallback: if Ollama tunnel is down, `reachable: false` is acceptable;
`tunnel_used: true` is sufficient to confirm the URL was sourced from harness_config.

---

## Kill Signals

- Builder proposes changes to `lib/ollama/circuit.ts`, `lib/ollama/models.ts`, or
  any Ollama-adjacent file outside the 3 targeted files + tests — scope creep, reject.
- Builder proposes adding a migration for OLLAMA_TUNNEL_URL — unnecessary; it's a runtime
  data value Colin inserts, not a schema change.
- Tests introduce `process.env.OLLAMA_TUNNEL_URL` mocks in new tests that should be
  testing the harness_config path — wrong direction.

---

## Cached-Principle Decisions

| Decision | Principle | Reversibility |
|---|---|---|
| No migration for OLLAMA_TUNNEL_URL row — it's a runtime config value Colin inserts | S-L1: harness_config for runtime config | N/A — not a schema decision |
| Auto-proceeded via META-C (see below) | META-C | All edits reversible via git revert |
| Scripts left reading process.env | S-L1 applies to agent/app runtime, not local dev scripts | N/A |

---

## Open Questions

None. The fix is fully specified by the existing pattern in `hydrateOllamaConfig()` +
`getBaseUrl()`. The only judgment call is tunnelUsed derivation logic — using
`!baseUrl.includes('localhost')` is consistent with `getTunnelUsed()` in `daytime-tick.ts:7`.

---

## META-C Cache-Match Block

```
2026-05-10T03:22:00Z sprint=5 chunk=ollama-tunnel-url-harness-config doc=docs/sprint-5/ollama-tunnel-url-harness-config-acceptance.md
cited_principles: [S-L1, F21, META-C]
trigger_match_evidence: |
  S-L1 (from CLAUDE.md §9 Successes S-L1): "Store runtime config in harness_config (Supabase).
  Read via SQL at session start. Never read from process.env for cross-boundary values."
  Situation: three production code paths read process.env.OLLAMA_TUNNEL_URL despite
  hydrateOllamaConfig() + getBaseUrl() infrastructure already existing in lib/ollama/client.ts.
  These are app-layer reads, not cross-boundary agent reads, but the pattern applies: the
  harness_config value should be authoritative, making it visible to agents at runtime.

  F21 (CLAUDE.md §3 rule 6): "Acceptance tests first — Every module has written acceptance
  criteria before code is written."
  Situation: this acceptance doc is written before any code is changed. Builder receives it
  as the contract. ✓

  META-C (docs/colin-principles.md): all four conditions checked below.
reversibility_check: |
  lib/ollama/client.ts line 265 edit: reversible — revert the tunnelUsed derivation line. Cost: trivial.
  lib/harness/smoke-tests/ollama-health.ts: add 2 lines + replace 1. Reversible via git. Cost: trivial.
  lib/orchestrator/daytime-tick.ts: import + getTunnelUsed() change. Reversible via git. Cost: trivial.
  tests: additive. Reversible via git. Cost: trivial.
  harness_config OLLAMA_TUNNEL_URL row: inserted by Colin. Reversible (DELETE WHERE key='OLLAMA_TUNNEL_URL'). Cost: trivial.
  No schema changes. No migrations. No destructive operations. All reversible.
confidence: high
outcome: auto-proceeded
```

**META-C check:**
- ✓ Trigger conditions match existing principle (S-L1) exactly
- ✓ Nothing in this session contradicts the cached decision
- ✓ All decisions reversible per reversibility_check above
- ✓ Confidence is `high`

→ **AUTO-PROCEEDED** — acceptance doc approved by cache-match. Proceeding to Phase 3 (builder delegation).
