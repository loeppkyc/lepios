# Streamlit Inventory + Corpus Sweep — Acceptance Doc

Coordinator: Phase 1d
Date: 2026-04-24
Study doc: `docs/sprint-5/streamlit-inventory-study.md`
Builder target: ship all items below in one commit

---

## Scope

1. **Corpus embedding**: embed streamlit_app/ .py source (excluding tests) + 5 .md docs into
   the existing `knowledge` table (domain='streamlit_source', pgvector 768-dim)
2. **Catalog table**: `streamlit_modules` — one row per module with classification, deps, tier,
   suggested chunks, F17/F18 fields, port status
3. **Populate script**: `scripts/populate-streamlit-modules.ts` — walks streamlit_app/,
   analyzes each file, inserts to streamlit_modules
4. **Embed script**: `scripts/embed-streamlit-source.ts` — chunks .py/.md, generates embeddings
   via Ollama nomic-embed-text, inserts to knowledge table
5. **Catalog generator**: `scripts/generate-port-catalog.ts` — reads streamlit_modules, writes
   `docs/streamlit-port-catalog.md`
6. **Tests**: standard coverage

---

## New Files

```
supabase/migrations/0023_add_streamlit_modules.sql
scripts/populate-streamlit-modules.ts
scripts/embed-streamlit-source.ts
scripts/generate-port-catalog.ts
tests/streamlit-inventory.test.ts
```

No new API routes. No new cron entries. Scripts run manually.

---

## 1 — Migration (`supabase/migrations/0023_add_streamlit_modules.sql`)

```sql
CREATE TABLE streamlit_modules (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  path                 text        NOT NULL UNIQUE,   -- relative to streamlit_app/, e.g. 'utils/amazon.py'
  lines                int         NOT NULL DEFAULT 0,
  classification       text        NOT NULL DEFAULT 'util'
                                   CHECK (classification IN ('page','util','client','config','test','dead')),
  deps_in              text[]      NOT NULL DEFAULT '{}',  -- files that import this module
  deps_out             text[]      NOT NULL DEFAULT '{}',  -- files this module imports
  external_deps        text[]      NOT NULL DEFAULT '{}',  -- external services: 'sp_api','keepa','sheets','gmail','anthropic','ollama','chromadb','telegram','sqlite','dropbox','ebay','twilio','other'
  suggested_tier       int         CHECK (suggested_tier BETWEEN 1 AND 5),
  suggested_chunks     jsonb,                              -- array of {task: string, scope: string} decompositions
  f17_signal           text,                               -- how this module feeds the path probability engine
  f18_metric_candidate text,                               -- what metric this module should expose in LepiOS
  port_status          text        NOT NULL DEFAULT 'pending'
                                   CHECK (port_status IN ('pending','in_progress','complete','deferred','skip')),
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX streamlit_modules_tier_idx         ON streamlit_modules (suggested_tier);
CREATE INDEX streamlit_modules_status_idx       ON streamlit_modules (port_status);
CREATE INDEX streamlit_modules_classification_idx ON streamlit_modules (classification);
```

---

## 2 — Populate Script (`scripts/populate-streamlit-modules.ts`)

**Run with:** `npx tsx scripts/populate-streamlit-modules.ts`

**What it does:**

1. Walk `streamlit_app/` recursively, collect all .py files
2. For each file:
   - Count lines
   - Read first 100 lines to determine classification:
     - `test` if filename starts with `test_` or path contains `/tests/`
     - `page` if path contains `/pages/` or filename matches `^\d+_` (numbered page) or is `app.py` / `Business_Review.py`
     - `dead` if path matches known dead modules (`knowledge_export.py`, `proactive_agents.py`, `task_queue.py`)
     - `client` if filename matches `*_api.py` or imports `googleapiclient`, `sp_api`, `gspread`
     - `config` if filename matches `auth.py`, `config.py`, `style.py`, `data_layer.py`, `__init__.py`
     - `util` otherwise
   - Scan `import` and `from ... import` statements; split into `deps_in` (project files that
     import this) and `deps_out` (project files this imports)
   - Scan for external dep keywords: `sp_api` → 'sp_api', `keepa` → 'keepa',
     `gspread`/`sheets` → 'sheets', `googleapiclient`/`gmail` → 'gmail',
     `anthropic`/`claude` → 'anthropic', `ollama` → 'ollama', `chromadb` → 'chromadb',
     `telegram` → 'telegram', `sqlite3` → 'sqlite', `dropbox` → 'dropbox'
   - Apply tier heuristic:
     - Tier 1: no `st.` anywhere in file
     - Tier 2: has `st.secrets` or `st.cache_data`/`st.cache_resource` but no `st.write`/
       `st.metric`/`st.button`/`st.selectbox`/`st.text_input`/`st.dataframe`
     - Tier 3: has `st.*` display calls but `st.session_state` count < 5
     - Tier 4: `st.session_state` count ≥ 5
     - Tier 5: `app.py`, `auth.py`, `style.py`, or file with `st.set_page_config` + `st.navigation`
   - Populate `suggested_chunks`: for Tier 1/2 files, `[{task: 'Port {filename} to lib/{domain}/{filename.ts}', scope: 'file'}]`;
     for Tier 3-5, `[{task: 'Port {filename} page component', scope: 'file'}, {task: 'Extract data hooks from {filename}', scope: 'file'}]`
   - `f17_signal`: auto-populate based on classification:
     - `client`: `'External API call events → agent_events; call failures → path engine signal'`
     - `page` (financial): `'User interaction events → behavioral ingestion utterances'`
     - `util` (Amazon): `'Scan/order events → deal pipeline state signal'`
     - default: `null` (builder fills in for complex cases)
   - `f18_metric_candidate`: auto-populate based on external_deps:
     - has 'sheets': `'Sheets call latency p95, error rate'`
     - has 'sp_api': `'SP-API quota usage, order fetch latency'`
     - has 'keepa': `'Keepa token consumption, lookup latency'`
     - default: `null`
3. INSERT all rows with `ON CONFLICT (path) DO UPDATE SET ... updated_at = now()` (idempotent)
4. Print summary: total rows inserted, by classification, by tier
5. Log to agent_events: `action='streamlit.catalog_populated'`, `meta: {total, by_tier, by_classification}`

---

## 3 — Embed Script (`scripts/embed-streamlit-source.ts`)

**Run with:** `npx tsx scripts/embed-streamlit-source.ts`

**Pre-requisite:** Ollama must be reachable (nomic-embed-text running). If Ollama is down,
the script logs a warning and exits with code 1. It does NOT fall back to Claude — embeddings
must use the same model as existing knowledge entries (nomic-embed-text 768-dim).

**What it does:**

### File selection

- .py files: all under `streamlit_app/` EXCEPT:
  - `tests/` directory
  - `test_*.py` files
  - Known dead modules: `knowledge_export.py`, `proactive_agents.py`, `task_queue.py`
- .md files: exactly these 5:
  - `streamlit_app/ARCHITECTURE.md`
  - `streamlit_app/CLAUDE.md`
  - `streamlit_app/CODEBASE_INDEX.md`
  - `streamlit_app/KNOWLEDGE_SYSTEM.md`
  - `streamlit_app/SYSTEM_INTEGRITY_CHECKLIST.md`

### Chunking

**.py files — function-level:**

```
Split lines on:
  - /^def \w/   (top-level function)
  - /^    def \w/  (class method, 4-space indent)
  - /^class \w/    (class definition)

Rules:
  - Minimum chunk: 5 lines (skip trivial one-liners)
  - Maximum chunk: 200 lines (split at blank-line boundary if exceeded)
  - Prepend header to each chunk:
    "# File: {relative_path} — {function_name}\n"
  - Include surrounding class context for methods:
    "# File: {path} — class {ClassName}.{method_name}\n"
```

**.md files — file-level:**

```
  - Embed entire file as one chunk
  - Cap at 6,000 chars; truncate at last \n## section boundary if exceeded
  - Prepend: "# Doc: {filename}\n"
```

### Embedding + insert

For each chunk:

1. Call `embed(chunkText, 'embed')` from `lib/ollama/client.ts`
2. On `OllamaUnreachableError`: log error, increment fail counter, continue to next chunk
3. On success: INSERT into `knowledge`:
   ```typescript
   {
     category: 'pattern',
     domain: 'streamlit_source',
     entity: relativePath,           // e.g. 'utils/amazon.py'
     title: `${relativePath} — ${functionName}`,
     context: chunkText,             // the raw chunk text
     confidence: 0.8,
     tags: JSON.stringify([classification, ...externalDeps]),
     embedding: vectorArray,         // float[] from embed()
   }
   ```
4. On duplicate (same title + domain): `ON CONFLICT DO UPDATE SET context = excluded.context, embedding = excluded.embedding, updated_at = now()` — idempotent re-runs

**Dedup key:** `(domain, title)` — add UNIQUE constraint in migration if not present.
Actually: no unique constraint on knowledge table. Use upsert logic:
`SELECT id FROM knowledge WHERE domain='streamlit_source' AND title=title`. If found: UPDATE. If not: INSERT.

### Progress + logging

- Print progress every 50 chunks: `Embedded 150/3200 chunks (4.7%)...`
- After all chunks: log to agent_events:
  ```
  action: 'streamlit.corpus_embedded'
  meta: {
    total_files: N,
    total_chunks: N,
    rows_inserted: N,
    rows_updated: N,
    embed_failures: N,
    duration_ms: N
  }
  ```
- Record attribution: `recordAttribution({actor_type: 'cron', actor_id: 'embed-streamlit-source-script'}, {entity_type: 'knowledge_corpus', entity_id: 'streamlit_source'}, 'embedded', {chunks: N})`

### Post-embed: rebuild IVFFlat index

After all chunks inserted, run this SQL via Supabase service client:

```sql
DROP INDEX IF EXISTS knowledge_embedding_idx;
CREATE INDEX knowledge_embedding_idx
  ON knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);
```

Reason: the existing index was created with `lists = 10` (appropriate for <1000 rows).
After adding ~3,000-5,000 rows, lists should be ~sqrt(rows) ≈ 50 for correct ANN results.

---

## 4 — Catalog Generator (`scripts/generate-port-catalog.ts`)

**Run with:** `npx tsx scripts/generate-port-catalog.ts`

**Output:** `docs/streamlit-port-catalog.md`

**What it writes:**

```markdown
# Streamlit Port Catalog

Generated: {ISO date}
Total modules: {N} | Pending: {N} | Complete: {N} | Deferred: {N}

## Tier 1 — Pure Logic (N modules)

| Module            | Lines | Classification | External Deps | Status  | Notes |
| ----------------- | ----- | -------------- | ------------- | ------- | ----- |
| utils/sourcing.py | 186   | util           | —             | pending | ...   |

## Tier 2 — Data/Client (N modules)

...

## Tier 3 — Display Pages (N modules)

...

## Tier 4 — Interactive Pages (N modules)

...

## Tier 5 — Deep Streamlit UX (N modules)

...

## Dead / Skip (N modules)

...
```

Group by `suggested_tier` ASC, then `port_status`, then `path` within each group.
Dead/skip modules in a final section regardless of tier.

The script reads from Supabase via service client and writes the markdown file locally.
No Supabase writes.

---

## 5 — F17 Signal

The `streamlit_modules` catalog directly feeds the path probability engine:

- "Porting decisions" becomes a domain in the behavioral spec: each `port_status` change
  from 'pending' → 'in_progress' → 'complete' is an event in the decision log
- `suggested_chunks` are task decompositions that map to future `task_queue` entries —
  catalog rows become the task backlog

Declare in embed script:
`// F17: streamlit_source knowledge embeddings feed Twin corpus; catalog rows feed task backlog`

---

## 6 — F18 Measurement

| Metric                    | Captured where                                                                    | Benchmark                                        |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ |
| Corpus growth             | `agent_events(action='streamlit.corpus_embedded').meta.rows_inserted`             | Target: >3,000 chunks on first run               |
| Embed failure rate        | `meta.embed_failures / meta.total_chunks`                                         | Target: < 5% (Ollama reliability)                |
| Catalog completeness      | `SELECT COUNT(*) FROM streamlit_modules WHERE suggested_tier IS NOT NULL` / total | Target: 100% — all rows have tier                |
| Streamlit-ism detection   | `SELECT COUNT(*) FROM streamlit_modules WHERE notes LIKE '%st.session_state%'`    | Baseline: establish on first run                 |
| Retrieval test — recall@5 | Run 5 queries after embed, check top 5 results for relevance                      | Qualitative: each query returns a relevant chunk |

**5 sample retrieval queries for post-embed verification** (run manually after script completes):

1. `"how does Streamlit handle SP-API pagination"` → expect: chunks from amazon.py
2. `"where is GST calculated"` → expect: chunks from amazon_fees_ca.py or **init**.py
3. `"how does circuit breaker pattern work"` → expect: chunk from circuit_breaker.py
4. `"how are Gmail invoices extracted"` → expect: chunks from gmail.py or email_invoices.py
5. `"what is the offline-first sync approach"` → expect: chunks from data_layer.py or sync_engine.py

Surfacing path for Colin: `SELECT title, similarity FROM match_knowledge('[query embedding]', 5, 0.0)` via Supabase SQL editor.

---

## 7 — Tests (`tests/streamlit-inventory.test.ts`)

All file I/O and Supabase calls mocked.

| Test                                           | Expectation                                         |
| ---------------------------------------------- | --------------------------------------------------- |
| `chunkPythonFile()` — top-level function       | Returns chunk with correct header and function body |
| `chunkPythonFile()` — class method             | Chunk header includes class name                    |
| `chunkPythonFile()` — skips < 5-line functions | Returns no chunk for trivial one-liners             |
| `applyTierHeuristic()` — no st.\* imports      | Returns tier 1                                      |
| `applyTierHeuristic()` — st.cache_data only    | Returns tier 2                                      |
| `applyTierHeuristic()` — st.session_state ≥ 5  | Returns tier 4                                      |
| `generatePortCatalog()` — markdown output      | Contains Tier 1/2/3/4/5 headers, table rows         |
| Embed insert — duplicate title                 | Updates existing row, no INSERT (idempotent)        |

---

## 8 — Commit Message

```
feat(streamlit-inventory): corpus embedding + port catalog infrastructure

- migrations/0023: streamlit_modules table (path, tier, deps, chunks, f17/f18 fields)
- scripts/populate-streamlit-modules.ts: walks streamlit_app/, applies tier heuristic, inserts catalog
- scripts/embed-streamlit-source.ts: function-level .py chunks + .md file chunks → knowledge table (domain=streamlit_source)
- scripts/generate-port-catalog.ts: reads streamlit_modules → docs/streamlit-port-catalog.md
- Post-embed IVFFlat index rebuild (lists=50) for ~3-5K new rows
- F17/F18 instrumented; attribution recorded

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## 9 — Run Order After Build

```bash
# Step 1: Apply migration
# (via Supabase MCP or CLI)

# Step 2: Populate catalog (no Ollama needed)
npx tsx scripts/populate-streamlit-modules.ts

# Step 3: Embed corpus (Ollama must be running with nomic-embed-text)
npx tsx scripts/embed-streamlit-source.ts

# Step 4: Generate markdown catalog (read from Supabase)
npx tsx scripts/generate-port-catalog.ts

# Step 5: Verify embed (manual — run 5 sample queries in Supabase SQL editor)
```

---

## 10 — Builder Notes

1. The `streamlit_app/` directory is at `../streamlit_app/` relative to the lepios project root.
   Use `path.resolve(__dirname, '../../streamlit_app')` or `process.env.STREAMLIT_APP_PATH`
   with a default. Do NOT hardcode Windows paths.

2. `embed()` from `lib/ollama/client.ts` returns `number[]`. Cast to PostgreSQL vector by
   passing as a plain array — Supabase JS client handles vector serialization.

3. The `knowledge` table has no UNIQUE constraint on `(domain, title)`. The embed script
   must check for existing rows before inserting. Use SELECT + conditional INSERT/UPDATE,
   not ON CONFLICT (which requires a constraint).

4. `npx tsx` requires `tsx` package. Check if it's in devDependencies before adding. If
   already present (likely — it's the standard TypeScript runner for scripts in this project),
   do not add a duplicate.

5. The tier heuristic counts `st.session_state` occurrences via regex:
   `(content.match(/st\.session_state/g) ?? []).length`. Simple and correct.

6. `suggested_chunks` is jsonb. Store as an array of objects:
   `[{"task": "Port utils/amazon.py to lib/amazon/client.ts", "scope": "file", "estimated_lines": 2128}]`

7. Do not attempt to parse Python AST — use line-based regex splitting for function extraction.
   Good enough for chunking; perfect is not required.
