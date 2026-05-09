# OSS Radar — Phase 0 Audit

**Date:** 2026-05-09
**Branch:** feat/receipts-port (audit-only, no code written)
**Status:** Phase 0 complete — awaiting Colin's "go" for Phase 1

---

## Purpose

Pre-build audit before writing `oss_scout` (pre-build gate) and `oss_audit` (retroactive scan). Seven questions answered; gaps called out before any scaffolding is proposed.

---

## 1 — Harness Rollup Scope

`harness_components` has **21 rows** (weight_pct sums to 100%, all at 100% completion as of 2026-05-09). Schema: `id` (text slug), `display_name`, `weight_pct`, `completion_pct`, `notes`, `updated_at`.

**Verdict:** These 21 slots are LepiOS infrastructure modules (auth, coordinator, night-watchman, etc.). They are NOT the OSS scan targets. Do not confuse them with the Streamlit module inventory.

---

## 2 — Scan Target: `streamlit_modules`

`streamlit_modules` is the correct target for `oss_audit`. Confirmed schema and row count:

| Column           | Type   | Notes                                                   |
| ---------------- | ------ | ------------------------------------------------------- |
| `id`             | uuid   | PK                                                      |
| `path`           | text   | Streamlit file path (e.g. `modules/receipts.py`)        |
| `lines`          | int    | LOC                                                     |
| `classification` | text   | `page` / `util` / `client` / `config` / `dead` / `test` |
| `port_status`    | text   | All 137 rows = `'pending'`                              |
| `suggested_tier` | int    | Build priority tier                                     |
| `external_deps`  | text[] | Library deps declared by module                         |
| `f17_signal`     | text   | Behavioral ingestion signal                             |

**Row count:** 137 rows, all `port_status = 'pending'`.

`external_deps[]` is the primary OSS-match signal: for each module, the array of pip/npm packages is already captured. `oss_audit` scans this column to find external libraries and evaluate whether they should be replaced with existing LepiOS infrastructure or third-party alternatives.

---

## 3 — Task Queue Verdict/Evidence Pattern

`task_queue` verdict and evidence should use existing jsonb columns:

| Column             | Use                                                                            |
| ------------------ | ------------------------------------------------------------------------------ |
| `metadata` (jsonb) | Store OSS match scores, evidence links, package names, alternative suggestions |
| `result` (jsonb)   | Store final audit verdict after coordinator reviews                            |

No dedicated verdict column exists or is needed. Pattern confirmed by existing harness tasks that store `{ "report": "...", "links": [...] }` in `result`.

---

## 4 — GitHub API: What Exists

**`lib/harness/arms-legs/http.ts`** — `httpRequest()` capability-gated HTTP client. Already has:

```typescript
HOST_ALLOW['net.outbound.github'] = 'api.github.com'
```

This means GitHub REST API calls are already allowed through the arms-legs layer. No firewall changes needed.

**What's missing:** There is no higher-level GitHub Search API wrapper. Calls to `GET /search/repositories`, `GET /search/code`, or `GET /repos/:owner/:repo` would need to be written against `httpRequest()` directly. Approximately 50 lines of typed wrapper needed.

---

## 5 — npm / PyPI / Awesome-\* Infrastructure

**npm registry client:** None. No existing wrapper for `registry.npmjs.org`. Arms-legs `net.outbound.npm` capability is not defined — would need to be added alongside the client.

**PyPI client:** None. No wrapper for `pypi.org/pypi/:package/json`. Same situation — capability + client both need building.

**Awesome-\* lists:** No Awesome-\* seed data anywhere — not in the `knowledge` table, not in a static JSON file, not in a DB table. The knowledge table uses `category` and `domain` columns with vector embeddings; it's the wrong shape for a structured OSS registry.

**Gap summary:** All three OSS data sources need to be built from scratch. GitHub is the lightest lift (capability exists, ~50-line wrapper). npm and PyPI each need capability + client (~30 lines each). Awesome-\* needs a seed pipeline + dedicated table.

---

## 6 — Ollama Analyst: Status

**`lib/llm/ollama.ts` — fully operational.**

```typescript
askOllama(userMessage: string, opts?: { model?, systemPrompt?, ... }): Promise<AskOllamaResult | null>
```

- Default system prompt: `lib/llm/prompts/analyst.md` ("You are an analyst, not an assistant")
- Anti-sycophancy rules enforced in the prompt (9 rules, cites data, disagrees when warranted)
- Logs `ollama.analyst_call` to `agent_events` on success and on failure
- Returns `null` if Ollama is unreachable — caller must handle graceful fallback
- `OLLAMA_MODELS.ANALYSIS = 'qwen2.5:32b'` (via `process.env.OLLAMA_ANALYSIS_MODEL`)

**`lib/ollama/client.ts`** — `embed(text)` using `nomic-embed-text` is ready for semantic similarity scoring against the knowledge store.

**Verdict:** `askOllama()` is directly usable as the fit-score engine. Pass it a structured prompt like "Given this Streamlit module's external_deps [] and its classification, score OSS alternatives 0–100 for fit" and it returns structured analysis with the analyst discipline already baked in.

---

## 7 — `estimateTask()` Pattern (Reusable for Scoring)

**`lib/work-budget/estimator.ts`** implements the exact pattern `oss_scout` needs:

1. Heuristic score based on known fields → bucket (XS/S/M/L/XL)
2. If XL (high uncertainty): call `askOllama()` for refinement
3. If Ollama unreachable: return heuristic estimate with `confidence: 'low'`

This three-layer fallback (heuristic → Ollama → degraded) is proven in production. `oss_scout` fit scoring should copy this pattern: rule-based score (deps match, license check, star count threshold) → Ollama refinement for edge cases → fallback to rule-based if Ollama is down.

---

## 8 — Knowledge Table Assessment

The `knowledge` table stores vector embeddings for the Twin's Q&A layer. Columns include `content`, `embedding`, `category`, `domain`, and `source`. It is **wrong shape** for an OSS package registry — it stores prose fragments, not structured package metadata.

`oss_audit` needs its own table. Proposed name: `oss_packages`. Shape:

```sql
CREATE TABLE oss_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,           -- package name (pip or npm)
  ecosystem text NOT NULL,      -- 'python' | 'node'
  gh_stars int,
  last_commit date,
  license text,
  lepios_alternative text,      -- if exists: slug of internal module
  fit_score int,                -- 0-100, Ollama-scored
  fit_rationale text,
  audit_status text NOT NULL DEFAULT 'pending',
  updated_at timestamptz DEFAULT now()
);
```

---

## Gap Matrix

| Gap                                         | Severity                              | Lift                   |
| ------------------------------------------- | ------------------------------------- | ---------------------- |
| GitHub Search API wrapper                   | Medium — capability exists, no client | ~50 lines              |
| npm registry client                         | Medium — needs capability + client    | ~80 lines              |
| PyPI registry client                        | Medium — needs capability + client    | ~80 lines              |
| Awesome-\* seed pipeline                    | High — no data at all                 | ~200 lines + DB table  |
| `oss_packages` table                        | Blocking for reverse scan             | 1 migration            |
| `streamlit_modules.oss_audit_status` column | For tracking per-module progress      | 1 migration (additive) |

---

## Phase 1 Scaffolding Proposal (one page)

**Do in order (each unblocks the next):**

### Step 1 — Migration (1 PR)

- `oss_packages` table (see shape above)
- Add `oss_audit_status text DEFAULT 'pending'` to `streamlit_modules`
- Add `net.outbound.npm = 'registry.npmjs.org'` and `net.outbound.pypi = 'pypi.org'` to arms-legs HOST_ALLOW

### Step 2 — Data Clients (1 PR)

- `lib/oss/github.ts` — `searchRepos(q)`, `getRepo(owner, repo)` using `httpRequest` + `net.outbound.github`
- `lib/oss/npm.ts` — `getPackage(name)` using `net.outbound.npm`
- `lib/oss/pypi.ts` — `getPackage(name)` using `net.outbound.pypi`

### Step 3 — oss_audit (reverse scan) (1 PR)

- `lib/oss/audit.ts` — reads `streamlit_modules` where `port_status='pending'`, explodes `external_deps[]`, calls npm/PyPI/GitHub for each unique dep, scores with `askOllama()`, writes to `oss_packages`, updates `streamlit_modules.oss_audit_status`
- `app/api/cron/oss-audit/route.ts` — runs audit in batches of 20 modules; idempotent (skips rows with `oss_audit_status='done'`)
- `app/(cockpit)/oss/page.tsx` — results table showing package name, ecosystem, stars, license, fit score, LepiOS alternative if found

### Step 4 — oss_scout (pre-build gate) (1 PR)

- `lib/oss/scout.ts` — given a task_queue entry's `metadata.external_deps[]`, returns `ScoutResult` with fit scores + block/warn/pass decision
- Wire into `lib/harness/pickup-runner.ts`: call `scoutCheck()` before `claimTask()`, append result to `task.metadata.oss_scout`
- No UI needed at launch; result visible in task_queue `metadata` column via cockpit

### Step 5 — Awesome-\* seed (deferred, optional)

- Download `sindresorhus/awesome` index, parse categories, seed `oss_packages` with canonical alternatives
- Adds the "there's a better library" signal that rule-based scanning can't produce
- Deferred because Steps 1–4 deliver value without it

---

**Awaiting Colin's "go" to write module code.**
