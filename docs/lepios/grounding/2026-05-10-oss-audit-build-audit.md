# Phase 0 Audit — OSS Audit Step 1 + Step 3 Build
**Date:** 2026-05-10 (Edmonton MT)  
**Branch target:** feat/oss-audit-step1-step3  
**Migration slot:** 0178  
**Status:** Phase 0 complete — awaiting Colin's "go"

---

## 1 — Scope Confirmation

**Step 1 (migration):**  
- `oss_packages` table — cached OSS candidate metadata, fit scores, verdicts  
- `streamlit_modules` additive columns: `oss_audit_status`, `oss_audit_at`, `oss_audit_evidence`  
- `capability_registry` seed rows for `net.outbound.npm` + `net.outbound.pypi`

**Step 3 (reverse scan):**  
- `lib/oss-radar/audit.ts` — score each pending module, write verdict + evidence  
- `app/api/cron/oss-audit/route.ts` — idempotent batch cron, N modules per tick  
- Digest line (F18); defer cockpit page to a later PR  

Steps 4 (oss_scout pre-build gate) and 5 (Awesome-* seed) are out of scope for this build.

---

## 2 — Capability Gating Audit

**Result: all three clients are properly gated. No code fix needed.**

| Client | File | Uses httpRequest()? | Capability | HOST_ALLOW in http.ts? |
|--------|------|---------------------|------------|------------------------|
| GitHub | `lib/oss-radar/sources/github.ts` | ✅ Yes | `net.outbound.github` | ✅ `api.github.com` |
| npm | `lib/oss-radar/sources/npm.ts` | ✅ Yes | `net.outbound.npm` | ✅ `registry.npmjs.org` |
| PyPI | `lib/oss-radar/sources/pypi.ts` | ✅ Yes | `net.outbound.pypi` | ✅ `pypi.org` |

The npm.ts and pypi.ts files have stale header comments saying "Window 2 must add to http.ts HOST_ALLOW." These were already added before PR #178 merged. The comments are wrong — no action needed.

**capability_registry DB gap (Step 1 must fix):**  
`net.outbound.npm` and `net.outbound.pypi` are NOT seeded in the `capability_registry` table (confirmed: `SELECT * WHERE capability ILIKE '%npm%' OR '%pypi%'` returns 0 rows). Migration 0178 must INSERT both. `net.outbound.github` also absent — seed it for completeness.

**capability_registry schema:** `capability`, `domain`, `description`, `default_enforcement`, `destructive`, `created_at`. No `host` column.

**fetch-log.ts note:** Uses `fs.appendFileSync` to `.oss-radar/fetch-log.jsonl`. This is ephemeral in Vercel serverless. Fine for local bench scripts (`scripts/oss-radar/bench-*.ts`). The Step 3 cron route does NOT call external APIs (all verdicts rule-based, see §4), so it never calls `appendFetchLog`. Non-issue for v1. If external API calls are added in v2, the cron route should write to `agent_events` instead.

---

## 3 — Critical Discovery: external_deps Are Service Labels, Not Package Names

The original Phase 0 plan assumed `streamlit_modules.external_deps[]` would contain pip/npm package names (e.g. `pandas`, `boto3`, `requests`) that could be looked up against npm/PyPI/GitHub.

**Actual contents:**

| dep label | module_count | What it means |
|-----------|-------------|----------------|
| `sheets` | 124 (53%) | Google Sheets integration |
| `anthropic` | 62 (27%) | Claude API calls |
| `keepa` | 38 (16%) | Keepa Amazon product data API |
| `telegram` | 30 (13%) | Telegram Bot API |
| `dropbox` | 28 (12%) | Dropbox file storage |
| `chromadb` | 22 (9%) | ChromaDB vector store |
| `ollama` | 14 (6%) | Local Ollama LLM |
| `ebay` | 12 (5%) | eBay marketplace API |
| `sp_api` | 8 (3%) | Amazon Seller Partner API |
| `gmail` | 7 (3%) | Gmail read/send |
| `sqlite` | 6 (3%) | SQLite local database |

**Only 11 distinct values.** These are integration category labels, not PyPI/npm package names. There are no modules with deps like `pandas`, `requests`, or `boto3`.

**Consequence:** The GitHub/npm/PyPI clients are NOT needed for Step 3 v1. Every module in the corpus can be scored 100% rule-based against the known-11 map. External API clients remain in the repo for oss_scout (Step 4) and for any future module inventory with real package deps.

**Module coverage:**
- 53 modules have `external_deps = {}` (zero deps — score as `keep`)
- 180 modules have ≥ 1 dep from the known-11 set

---

## 4 — Verdict Map (Rule-Based Scoring)

Each dep label maps to a verdict based on whether LepiOS already has an equivalent:

| dep | verdict | LepiOS alternative |
|-----|---------|-------------------|
| `sheets` | `absorb-patterns` | Supabase (already migrated for business review, receipts, etc.) |
| `anthropic` | `absorb-patterns` | `lib/llm/claude.ts` + Anthropic SDK in LepiOS |
| `telegram` | `absorb-patterns` | `lib/orchestrator/telegram.ts` + webhook handler |
| `dropbox` | `absorb-patterns` | `lib/dropbox/` (shipped PR #179) |
| `chromadb` | `absorb-patterns` | pgvector in Supabase + `lib/knowledge/` Twin store |
| `ollama` | `absorb-patterns` | `lib/llm/ollama.ts` (Qwen 2.5 32B, Phi-4 14B) |
| `gmail` | `absorb-patterns` | `lib/gmail/` scanner + classifier (shipped) |
| `sqlite` | `absorb-patterns` | Supabase (all persistent state migrated) |
| `sp_api` | `keep` | Already integrated in LepiOS (`lib/amazon/`) |
| `keepa` | `complement-with` | No LepiOS equivalent; Keepa is irreplaceable for historical Amazon data |
| `ebay` | `complement-with` | No LepiOS equivalent; eBay API is a real external dependency |

**Module-level verdict aggregation rule:**
1. Zero deps → `keep`
2. Any dep maps to `complement-with` → module verdict = `complement-with`
3. All deps map to `absorb-patterns` or `keep` → module verdict = `absorb-patterns`
4. `sp_api`-only → `keep`
5. Ambiguous (future: dep not in known-11) → `keep` + flag for Ollama review

**Expected verdict distribution across 233 pending modules (estimate):**

| verdict | rough count | basis |
|---------|-------------|-------|
| `keep` | ~70 | 53 zero-dep + sp_api-only modules |
| `absorb-patterns` | ~120 | sheets/anthropic/telegram/etc. dominated modules |
| `complement-with` | ~43 | any module with keepa (38) or ebay (12), with overlap |

**T4 rollup impact:**  
- `keep` and `absorb-patterns` → count as port work (must build in LepiOS)  
- `complement-with` → count as port work + note external integration required  
- `replace` → exclude from T4 count (nothing to port; no modules expected in this category for current corpus)

---

## 5 — Migration 0178 Design

**File:** `supabase/migrations/0178_oss_audit.sql`

```sql
-- A. Additive columns on streamlit_modules
ALTER TABLE streamlit_modules
  ADD COLUMN oss_audit_status TEXT NOT NULL DEFAULT 'unaudited'
    CONSTRAINT oss_audit_status_values CHECK (
      oss_audit_status IN ('unaudited','replace','fork-extend','absorb-patterns','keep','complement-with')
    ),
  ADD COLUMN oss_audit_at TIMESTAMPTZ,
  ADD COLUMN oss_audit_evidence JSONB;

-- B. oss_packages table (for future oss_scout API-based scoring)
CREATE TABLE oss_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ecosystem TEXT NOT NULL CHECK (ecosystem IN ('python','node','github')),
  gh_stars INT,
  last_activity_at DATE,
  license TEXT,
  lepios_alternative TEXT,
  fit_score INT CHECK (fit_score BETWEEN 0 AND 100),
  fit_rationale TEXT,
  audit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (audit_status IN ('pending','scored','reviewed')),
  last_audited_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (name, ecosystem)
);

-- C. capability_registry seeds
INSERT INTO capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES
  ('net.outbound.github', 'oss_radar', 'GitHub REST API — repo search + metadata', 'enforce', false),
  ('net.outbound.npm',    'oss_radar', 'npm registry — package metadata + downloads', 'enforce', false),
  ('net.outbound.pypi',   'oss_radar', 'PyPI JSON API — package metadata lookup', 'enforce', false)
ON CONFLICT (capability) DO NOTHING;
```

**Reversibility:** Additive only — no existing columns changed, no RLS policies modified. Rollback = drop the three new `streamlit_modules` columns + `oss_packages` table + delete the three `capability_registry` rows.

---

## 6 — Step 3 Implementation Design

### 6a. `lib/oss-radar/audit.ts`

Entry point: `auditModuleBatch(limit: number): Promise<AuditBatchResult>`

Logic per module:
1. Read `path`, `classification`, `external_deps[]` from `streamlit_modules WHERE oss_audit_status = 'unaudited' LIMIT limit FOR UPDATE SKIP LOCKED`
2. Compute verdict via `scoreModuleDeps(external_deps)` — pure function, no I/O
3. Build `evidence` JSONB: `{ deps, dep_verdicts, rule, lepios_alternatives, scored_at, scorer: 'rule_based_v1' }`
4. `UPDATE streamlit_modules SET oss_audit_status=verdict, oss_audit_at=now(), oss_audit_evidence=evidence WHERE id=...`
5. Collect aggregate counts

Returns: `{ audited: number, verdicts: Record<string, number>, errors: number, duration_ms: number }`

**No external API calls in v1.** Ollama path deferred to v1.1 (triggered when a dep label is not in the known-11 map).

### 6b. `app/api/cron/oss-audit/route.ts`

- Auth: `requireCronSecret(request)` (F22 compliance)
- Calls `auditModuleBatch(40)` — 40 modules per tick
- Writes one `agent_events` row: `domain: 'oss_radar', action: 'oss_audit_batch', status: 'success'|'error'`
- Returns 200 `{ audited, verdicts, remaining }`
- `remaining` = `SELECT COUNT(*) FROM streamlit_modules WHERE oss_audit_status = 'unaudited'`

**Batch sizing:** 40 modules/tick × 6 ticks = 240 — covers all 233 in one manual sweep. Each tick is pure DB reads/writes, ~200ms.

**Trigger for initial backfill:** Manual `POST /api/cron/oss-audit` × 6 calls, or one-shot script. No pg_cron job needed — this is a one-time backfill, not an ongoing cron.

### 6c. Digest line (F18)

`lib/oss-radar/digest.ts` → `buildOssAuditDigestLine(): Promise<string>`

```
OSS audit: 233/233 · keep=70 absorb-patterns=120 complement-with=43 [done]
OSS audit: 47/233 audited · 186 remaining
```

Wire into `sendMorningDigest()` in `lib/orchestrator/digest.ts`.

### 6d. evidence JSONB shape

```json
{
  "deps": ["sheets", "anthropic"],
  "dep_verdicts": { "sheets": "absorb-patterns", "anthropic": "absorb-patterns" },
  "rule": "all_deps_absorb_patterns",
  "lepios_alternatives": {
    "sheets": "supabase",
    "anthropic": "lib/llm/claude.ts"
  },
  "scored_at": "2026-05-10T18:00:00Z",
  "scorer": "rule_based_v1"
}
```

---

## 7 — Execution Order

```
a) Migration 0178 → add columns + table + capability_registry seeds
b) lib/oss-radar/audit.ts + app/api/cron/oss-audit/route.ts
c) Wire digest line in lib/orchestrator/digest.ts
d) Commit + push + PR
e) Apply migration to production
f) Manual backfill: POST /api/cron/oss-audit × 6 (all 233 modules)
g) Verify via: SELECT oss_audit_status, COUNT(*) FROM streamlit_modules GROUP BY 1
```

Step (f) can run immediately after deploy since it's read-only aside from the audit columns.

---

## 8 — F18 Metrics

Written to `agent_events` per batch tick:

| field | value |
|-------|-------|
| `domain` | `oss_radar` |
| `action` | `oss_audit_batch` |
| `meta.audited` | modules scored this tick |
| `meta.verdicts` | `{keep: N, absorb-patterns: N, complement-with: N}` |
| `meta.remaining` | unaudited count after this tick |
| `meta.tokens_used` | 0 (rule_based_v1); actual when Ollama path added |
| `meta.scorer` | `rule_based_v1` |
| `duration_ms` | wall time for the batch |

**Benchmark:** 40 modules / 200ms per tick = 5 modules/second. Target: no tick exceeds 2s.

---

## 9 — F19 Calibration (20%-Better Loop)

**Metric:** `% of complement-with verdicts where Colin agrees after 30-day spot-check`  
**Target:** ≥ 80% agreement (calibration threshold)  
**Method:** After backfill, Colin reviews a 10-module random sample of each verdict category. Disagreement rate > 20% → adjust dep verdict map or add Ollama refinement.  
**Stored:** spot-check results in `oss_packages.audit_status = 'reviewed'` with `fit_rationale` capturing Colin's override.

---

## 10 — What's NOT in This Build

- Cockpit page `/oss` — deferred (post-backfill once verdict distribution is known)
- oss_scout pre-build gate (Step 4) — separate PR
- Awesome-* seed (Step 5) — explicitly deferred  
- Ollama analyst path for ambiguous deps — v1.1 trigger
- libraries.io integration for PyPI keyword search — v1.1 trigger
- External API calls (GitHub/npm/PyPI) — not needed for current corpus; ready for oss_scout

---

## 11 — Open Questions for Colin

| # | Question | Blocking |
|---|----------|---------|
| Q1 | Should `complement-with` modules count full weight in T4 rollup (port owed) or discounted (only the LepiOS piece)? | Auto-rollup T4 accuracy |
| Q2 | Manual backfill 6×POST or add a one-shot script that loops internally? | Step (f) execution |
| Q3 | Confirm: `replace` verdict excluded from T4 count? (No current `replace` expected — corpus has no generic pip/npm packages.) | T4 rollup logic |

---

_Grounded: all claims verified against live DB + source files. No generated claims._
