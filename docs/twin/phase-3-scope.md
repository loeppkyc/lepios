# Twin Q&A — Phase 3 Scope Document

**Status:** Awaiting Colin approval before any build begins
**Audited:** 2026-04-26
**Auditor:** Claude Sonnet 4.6

---

## 1 — Current State Summary

The Twin Q&A endpoint (`POST /api/twin/ask`) is fully wired at the code level:

- Embed via Ollama (nomic-embed-text, 768-dim) → pgvector cosine search → top-10 personal chunks → Ollama qwen2.5:32b → Claude fallback if needed
- Circuit breaker, uncertainty detection, confidence heuristic, agent_events logging — all real, not stubs
- 8,480 personal chunks in Supabase with embeddings: 5,536 `personal_correspondence` + 2,944 `personal_knowledge_base`, all embedded

**The twin has never returned a useful answer in production.** 100% escalation rate, all with `escalate_reason: insufficient_context`.

---

## 2 — 5-Question Audit Results (2026-04-26)

All questions run against `https://lepios-one.vercel.app/api/twin/ask`.

| #   | Question                                                                  | Sources Retrieved | Answer  | Assessment                |
| --- | ------------------------------------------------------------------------- | ----------------- | ------- | ------------------------- |
| 1   | What is Colin's risk tolerance for Amazon sourcing deals?                 | 0                 | (empty) | **Broken** — embed failed |
| 2   | How should I handle scope creep when a builder adds unrequested features? | 0                 | (empty) | **Broken** — embed failed |
| 3   | Should I batch Colin escalation questions or send them one at a time?     | 0                 | (empty) | **Broken** — embed failed |
| 4   | What is Colin's preference for UI styling — polish before shipping?       | 0                 | (empty) | **Broken** — embed failed |
| 5   | What Streamlit features are highest priority to port to LepiOS?           | 0                 | (empty) | **Broken** — embed failed |

**Every call produced the same failure path:**

1. `ollama.config_warning: OLLAMA_TUNNEL_URL not set; using localhost fallback in production`
2. `ollama.embed: failure — Ollama is unreachable` (Vercel tries `localhost:11434`, gets connection refused)
3. `ollama.generate: failure — Ollama is unreachable`
4. Claude fallback fires with **zero context chunks** (embed failed → pgvector never ran)
5. Claude correctly responds with `insufficient_context` token → escalate

**One prior run (2026-04-24 13:38) had `sources_count: 10` with `ollama_unreachable: true`** — meaning Ollama was briefly reachable, 10 chunks were retrieved, but still escalated. That incident confirms Gap 3 (corpus content mismatch): even when retrieval works, the raw email corpus doesn't answer coordinator questions.

---

## 3 — Gap List (Ranked by Impact)

### Gap 1 — `OLLAMA_TUNNEL_URL` not set in Vercel [BLOCKING]

**Impact:** 100% escalation. Embed fails on every production call.

Ollama runs on Colin's laptop. Vercel can't reach `localhost:11434`. The codebase expects `OLLAMA_TUNNEL_URL` (a Cloudflare tunnel URL) but it's missing from Vercel env vars.

Root confirmation: `ollama.config_warning: "OLLAMA_TUNNEL_URL not set; using localhost fallback in production"` logged on every single twin.ask call.

**Fix:** Wire the Cloudflare tunnel (Step 6.5, already in CLAUDE.md as pending) and add `OLLAMA_TUNNEL_URL` to Vercel.

---

### Gap 2 — No embedding fallback when Ollama is unreachable [BLOCKING]

**Impact:** Twin goes completely blind any time Colin's laptop is off or the tunnel drops. Zero degraded-mode operation.

Current flow: `embed()` fails → returns `[]` → pgvector search never runs → Claude fallback fires with empty context → always escalates. The twin has 8,480 embedded chunks ready but can't reach them without Ollama for the query vector.

The knowledge table already has a `fts` tsvector column (GENERATED ALWAYS, GIN-indexed). A keyword fallback path already exists at the DB layer — it's just not wired into twin/ask.

**Fix:** When `embed()` fails, fall through to FTS-only search via `knowledge.fts @@ plainto_tsquery(question)`. Retrieve top-10 by FTS rank instead of cosine similarity. Confidence cap: 0.55 (FTS is less precise than vector). This makes the twin degraded-but-functional when Ollama is down, which is the common production state right now.

---

### Gap 3 — Category filter excludes the most useful chunks [HIGH]

**Impact:** `pattern` (1,755 embedded chunks) and `principle` (10 chunks) and `rule` (5 chunks) are all excluded from twin queries. These are from `streamlit_source` domain — likely CLAUDE.md rules, behavioral patterns, and Colin's explicit principles. The coordinator needs exactly this content.

Current filter: `category IN ('personal_correspondence', 'personal_knowledge_base')` — hardcoded client-side in `app/api/twin/ask/route.ts`.

**Fix:** Add `pattern`, `principle`, `rule` to the category filter. Sample the `pattern`+`principle` chunks first (see §4 Phase 3 item P2) to confirm content before expanding.

---

### Gap 4 — Corpus content mismatch: personal_correspondence = raw emails [MEDIUM-HIGH]

**Impact:** Even when retrieval works (as in the 2026-04-24 incident), coordinator questions escalate. The `personal_correspondence` category contains raw email threads — BDC loan discussions, insurance renewals, Polymarket newsletters — not distilled preferences.

The `personal_knowledge_base` category has better content: session notes, Colin's strategic planning doc (`compile_strategic_recommendations.md`), domain knowledge files (Amazon legal, child health, winter survival). Some of this IS relevant (Amazon legal, strategic rec doc). But the format is dense documents, not structured "Colin prefers X because Y" chunks.

**Fix (two options — Colin to choose):**

- **Option A — Extract & index:** Run a one-time distillation pass: for each correspondence chunk, extract any explicit Colin preference/principle/decision and save as a new `principle` chunk. Manual review required.
- **Option B — Accept raw + improve prompt:** Keep raw chunks, but update the twin system prompt to synthesize behavioral patterns from correspondence context. Less clean but zero manual work.

---

### Gap 5 — Confidence heuristic is untested at the right thresholds [LOW-MEDIUM]

**Impact:** Once Gaps 1–3 are fixed and sources actually return, the confidence model needs calibration. Current heuristic: similarity > 0.6 → 0.85, > 0.4 → 0.70, else → 0.45. Threshold for escalation: 0.80. The 0.80 threshold means anything but a very high similarity match escalates — may be too aggressive.

**Fix:** After Gaps 1–3 are fixed, run the 5-question audit again with working retrieval and tune the threshold empirically. Also consider logging `sources_count` consistently (it's missing from recent meta logs).

---

### Gap 6 — No semantic search coverage for coordinator-specific Q&A corpus [MEDIUM]

**Impact:** The coordinator asks questions like "how does Colin want scope creep handled?" — the answer IS in the codebase (CLAUDE.md §2, AGENTS.md) and in memory files, but these haven't been chunked into the twin corpus.

The `~/.claude/CLAUDE.md` and project CLAUDE.md files contain explicit Colin preferences, failure log (F1–F18), and success patterns (S1–S6). These are not in the knowledge table.

**Fix:** One-time ingest: chunk CLAUDE.md + global CLAUDE.md + AGENTS.md + ARCHITECTURE.md into `principle`/`rule` category chunks. These documents are the exact source of truth for coordinator Q&A. ~50–100 chunks total.

---

## 4 — Proposed Phase 3 Work Items

### P0 — Wire `OLLAMA_TUNNEL_URL` (prerequisite for Ollama path)

- Set up Cloudflare tunnel on Colin's laptop (cloudflared tunnel run)
- Add `OLLAMA_TUNNEL_URL` to Vercel env vars
- Verify: `ollama.embed` success logged in agent_events
- **Dependency:** Colin's laptop must be on and cloudflared running for Ollama path to work

### P1 — Add FTS fallback when embed fails [UNBLOCKS TWIN IN ALL CONDITIONS]

- In `app/api/twin/ask/route.ts`: if `embed()` returns `[]`, run FTS query against `knowledge` table
- FTS query: `SELECT * FROM knowledge WHERE fts @@ plainto_tsquery($1) AND category = ANY($categories) ORDER BY ts_rank(fts, plainto_tsquery($1)) DESC LIMIT 10`
- Cap confidence at 0.55 on FTS-retrieved answers
- Add `retrieval_method: 'fts_fallback'` to agent_events meta
- **This fix makes the twin useful even without Ollama running.**

### P2 — Expand category filter to include pattern/principle/rule

- Sample `pattern` and `principle` chunks from DB to confirm content is coordinator-relevant
- If confirmed: update PERSONAL_CATEGORIES constant in `app/api/twin/ask/route.ts`
- Add `domain` filter: include `streamlit_source` for pattern chunks (high signal), `personal` for principle chunks
- Re-run 5-question audit

### P3 — Ingest CLAUDE.md corpus as principle/rule chunks [HIGHEST ROI FOR COORDINATOR USE]

- Chunk `~/.claude/CLAUDE.md` (Failure Log F1–F18, Success Patterns S1–S6, Preferences §2)
- Chunk `lepios/CLAUDE.md` (Architecture Rules §3, Quick Context §1)
- Chunk `lepios/ARCHITECTURE.md` (sprint queue, data model decisions)
- Save each as `saveKnowledge()` calls with `category: 'principle'` or `category: 'rule'`, `domain: 'coordinator'`
- This directly answers the top coordinator Q&A: scope handling, auth rules, confidence scoring, retry limits, UI styling policy
- **Estimated: ~80–120 chunks. Highest ROI item in Phase 3.**

### P4 — Confidence threshold calibration

- After P0–P3: re-run 5-question audit + 10 additional coordinator questions
- Log `top_similarity` for each; plot distribution
- Adjust `TWIN_CONFIDENCE_THRESHOLD` env var (currently 0.80 — likely too aggressive once real corpus is in)
- Target: ≤20% escalation rate on coordinator-class questions

---

## 5 — Acceptance Criteria for "Phase 3 Complete"

1. **Retrieval not broken:** `sources_count > 0` on ≥4/5 audit questions
2. **Non-empty answers:** ≥3/5 audit questions return a non-empty answer (Ollama or Claude, either model)
3. **Confidence ≥ 0.6:** ≥3/5 audit questions return `confidence >= 0.6` without escalating
4. **Degraded-mode functional:** Run audit with Ollama tunnel disabled — FTS fallback returns sources and non-empty answer on ≥2/5 questions
5. **Coordinator Q&A coverage:** The 5 CLAUDE.md preference questions (risk tolerance, scope creep, UI styling, batch vs. trickle, port priority) all return answers grounded in `principle`/`rule` chunks from the CLAUDE.md ingest
6. **All new logs:** Every twin.ask call logs `sources_count`, `retrieval_method` (`vector` | `fts_fallback`), and `top_similarity` in `meta`

---

## 6 — Recommended Build Order

```
P1 (FTS fallback — unblocks twin today, no Ollama required)
  → P3 (CLAUDE.md ingest — highest ROI for coordinator)
  → P2 (category filter expansion — verify pattern chunk quality first)
  → P0 (Ollama tunnel — enables vector path, but twin is already useful without it)
  → P4 (threshold calibration — only meaningful once corpus is populated)
```

**Start with P1 + P3 in parallel.** These two items together transform the twin from "100% broken" to "useful for the majority of coordinator questions" without requiring any infrastructure changes (no tunnel, no Ollama dependency).

---

## 7 — Out of Scope for Phase 3

- Reranking (cross-encoder, BM25 hybrid) — defer to Phase 4 once we have baseline quality data
- Chunk size optimization — current 768-dim nomic-embed-text chunks are fine; optimize after calibration
- Conversation history — single-turn Q&A first
- UI for twin Q&A — endpoint-only for now (coordinator consumes it, not Colin directly)
- Stale decay cron (`knowledge_decay_stale()`) — exists but not needed yet
