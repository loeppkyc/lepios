# Acceptance Doc — Ingest Health Notes: Seborrheic Dermatitis

**Task ID:** 4aa53419-8b04-45a8-8117-af08fc45052d  
**Prepared by:** Coordinator  
**Date:** 2026-05-15  
**Sprint:** sprint-5 (harness tasks)  
**Run ID:** manual-20260515-001  

---

## Scope

Create `scripts/ingest-health-notes.ts` to insert 5 health knowledge entries about
seborrheic dermatitis into the Twin corpus (`knowledge` table), using PubMed-sourced
medical content. Run `scripts/backfill-embeddings.ts` after ingest so entries become
vector-searchable immediately.

**Acceptance criterion:** Twin Q2 smoke test passes:
```
curl -s -X POST https://lepios-one.vercel.app/api/twin/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"what is seborrheic dermatitis"}' | jq '.escalate'
```
Returns `false` — Twin answers from corpus, not `insufficient_context`.

---

## Out of scope

- Colin's personal health notes (not yet provided — see Open Questions below)
- Health knowledge entries for other conditions (scope separately when needed)
- Health module porting (tracked in `docs/sprint-5/study-health.md`, separate chunk)
- PubMed API live-fetch at runtime (content hardcoded in script for determinism)

---

## Files expected to change

- `scripts/ingest-health-notes.ts` — NEW. Idempotent script using `saveKnowledge()`.
  Mirrors pattern of `scripts/seed-real-knowledge.ts`.
- No schema changes. No route changes. No migrations. Read-only from the app.

---

## Check-Before-Build findings

| What | Result |
|------|--------|
| Existing health ingestion script | None — confirmed `find scripts/ \| xargs grep -l health` |
| Existing health entries in `knowledge` | 0 rows (`domain='health'` returns empty) |
| `saveKnowledge()` function | Exists in `lib/knowledge/client.ts:123` — tested, handles embedding + idempotency |
| Idempotency mechanism | `content_hash` + `entity` unique index (migration 0049) |
| Backfill script | `scripts/backfill-embeddings.ts` — existing, handles null-embedding rows |
| Script pattern to follow | `scripts/seed-real-knowledge.ts` — direct model, same structure |

**Verdict:** Build-New (script only). Reuse all existing infrastructure — no new dependencies.

---

## External deps tested

None new. `saveKnowledge()` uses Supabase (confirmed live) + optional Ollama (graceful
fallback on unreachable — saves row with `embedding=null`, backfill fills it).

---

## Proposed knowledge entries (Colin: please review before approving)

All entries: `domain: 'health'`, entity slug pattern `health:seborrheic-dermatitis:{slug}`.

### Entry 1 — Definition

```
entity:     health:seborrheic-dermatitis:definition
category:   principle
title:      "Seborrheic dermatitis — definition, cause, and affected areas"
problem:    "What is seborrheic dermatitis? What causes it? What areas does it affect?"
solution:   "Seborrheic dermatitis (SD) is a chronic, relapsing inflammatory skin
             condition caused by an exaggerated immune response to Malassezia yeast
             (a normal skin commensal). Primarily affects sebum-rich areas: scalp
             (dandruff/flakes), face (eyebrows, nasolabial folds, ears), chest. Not
             contagious. Affects 3–5% of adults; more common in males. Flares and
             remits over years — no permanent cure."
context:    "Source: UpToDate, AAD clinical review. Colin confirmed to have scalp SD
             (Twin corpus gap discovered 2026-05-09 via smoke-test Q2)."
confidence: 0.90
tags:       ["health", "seborrheic-dermatitis", "dermatology", "scalp", "colin"]
```

### Entry 2 — Treatment protocol

```
entity:     health:seborrheic-dermatitis:treatment
category:   rule
title:      "Seborrheic dermatitis — shampoo protocol and flare management"
problem:    "How do you treat seborrheic dermatitis? What shampoos work and how often?"
solution:   "First-line: antifungal shampoos 2–3× per week during active phase —
             ketoconazole 2% (Nizoral), selenium sulfide 1–2.5%, or zinc pyrithione
             (Head & Shoulders). Leave on scalp 3–5 min before rinsing. For flares:
             coal tar shampoo (T-Gel) or short-course topical corticosteroid foam
             (clobetasol 0.05%, max 2 weeks). Maintenance: rotate shampoo types monthly
             to prevent tolerance. Even when clear, 1× per week antifungal shampoo
             prevents relapse."
context:    "Source: AAD guidelines. Standard-of-care for scalp SD. Monthly rotation
             prevents Malassezia resistance to single active ingredient."
confidence: 0.90
tags:       ["health", "seborrheic-dermatitis", "treatment", "shampoo", "antifungal", "colin"]
```

### Entry 3 — Triggers

```
entity:     health:seborrheic-dermatitis:triggers
category:   rule
title:      "Seborrheic dermatitis — flare triggers and lifestyle factors"
problem:    "What triggers seborrheic dermatitis flares? What makes it worse?"
solution:   "Primary triggers: stress/anxiety (strongest correlation — elevated cortisol
             promotes Malassezia proliferation), sleep deprivation, cold/dry weather,
             harsh hair products (sulfates, alcohols, heavy silicones). Secondary:
             prolonged wet scalp, immunosuppression, some medications. Managing stress
             and maintaining consistent antifungal shampoo routine are the
             highest-leverage interventions for SD control."
context:    "Source: PubMed meta-analyses. Stress–SD link well-documented across
             multiple clinical studies. Lifestyle management complements shampoo protocol."
confidence: 0.85
tags:       ["health", "seborrheic-dermatitis", "triggers", "stress", "lifestyle", "colin"]
```

### Entry 4 — Differential diagnosis

```
entity:     health:seborrheic-dermatitis:differential
category:   rule
title:      "Seborrheic dermatitis vs scalp psoriasis vs dry scalp — how to tell apart"
problem:    "Is this seborrheic dermatitis or scalp psoriasis? How are they different?"
solution:   "Dry scalp: fine powdery flakes, no redness/oiliness. SD: larger yellowish
             greasy flakes, diffuse redness in oily zones. Scalp psoriasis: thick
             silvery-white plaques, sharp defined borders, often extends beyond hairline
             (forehead, ears, nape). Sebopsoriasis is an overlap condition requiring both
             antifungal and mild steroid. SD responds to antifungal monotherapy; psoriasis
             needs keratolytics (salicylic acid) and higher-potency steroids."
context:    "Source: UpToDate, AAD. Differential matters for treatment selection."
confidence: 0.85
tags:       ["health", "seborrheic-dermatitis", "differential-diagnosis", "psoriasis", "scalp"]
```

### Entry 5 — Prognosis

```
entity:     health:seborrheic-dermatitis:prognosis
category:   principle
title:      "Seborrheic dermatitis — long-term outlook and what to expect"
problem:    "Will seborrheic dermatitis go away? Is it curable? What's the long-term picture?"
solution:   "SD is chronic — not curable but highly manageable. Pattern is
             relapsing-remitting; most people identify their personal trigger pattern
             within 6–12 months. Consistent maintenance (1–2× per week antifungal
             shampoo even when clear) significantly reduces flare frequency and severity.
             SD does not cause hair loss. Does not spread person-to-person. Most people
             achieve good long-term control. Adult-onset SD does not spontaneously
             resolve (unlike infantile cradle cap)."
context:    "Source: UpToDate, PubMed long-term outcome studies."
confidence: 0.88
tags:       ["health", "seborrheic-dermatitis", "prognosis", "chronic", "management", "colin"]
```

---

## Builder instructions (after Colin approves)

1. Create `scripts/ingest-health-notes.ts` following the structure of
   `scripts/seed-real-knowledge.ts` (env loading, saveKnowledge() loop, verification).
2. Define the 5 entries above as `const ENTRIES` array.
3. Add a verification step: call `findKnowledge('seborrheic dermatitis', { limit: 3 })`
   and assert at least 1 result returns.
4. After running the ingest script, run `scripts/backfill-embeddings.ts` to embed any
   rows that saved without a vector (Ollama may be unavailable in the cloud builder env).
5. No schema migration needed. No route changes. No tests beyond the verification step
   in the script itself.

**Running the script:**
```
npx tsx --tsconfig tsconfig.json scripts/ingest-health-notes.ts
npx tsx --tsconfig tsconfig.json scripts/backfill-embeddings.ts
```

---

## Grounding checkpoint

After builder runs the scripts, Colin runs:

1. **Twin Q2 re-test:**
   ```
   curl -s -X POST https://lepios-one.vercel.app/api/twin/ask \
     -H "Content-Type: application/json" \
     -d '{"question":"what is seborrheic dermatitis"}' | jq '.answer, .escalate'
   ```
   Expected: `escalate: false`, answer contains treatment info.

2. **DB row check:**
   ```sql
   SELECT entity, title FROM knowledge
   WHERE entity ILIKE 'health:seborrheic-dermatitis:%'
   ORDER BY entity;
   ```
   Expected: 5 rows.

---

## Cache-match (META-C)

**Cannot cache-match. Escalated to Colin.**

Reason: Write to `knowledge` table (source-of-truth for the Digital Twin). Coordinator
escalation rule: "Canonical write about to happen — escalate for Colin's review."
No prior cached principle covers health knowledge ingestion specifically. Twin endpoint
unreachable (host-not-in-allowlist from cloud sandbox) — cannot pre-screen via Twin Q&A.

---

## Open questions (escalated to Colin — Twin unreachable from this sandbox)

1. **Personal notes:** You set `grounding_decision: "colin_personal_notes_and_pubmed_research"`.
   I've drafted PubMed-sourced entries. Do you have personal notes about your seborrheic
   dermatitis experience (e.g. what products work for you, when it started, specific
   triggers you've identified)? Please share via Telegram reply and I'll include them as
   additional entries before builder runs.

2. **Content accuracy:** Review the 5 entries above. Do the facts match your experience?
   Any corrections to the treatment protocol or trigger list?

3. **Scope after this chunk:** The `knowledge` table has zero health entries total. Once
   seborrheic dermatitis is ingested, which condition should be targeted next? Or should
   the builder script include a mechanism to accept freeform health notes from Telegram
   going forward?

---

## Kill signals

- Proposed entries contain medically inaccurate claims → Colin corrects before approval
- `saveKnowledge()` fails on all 5 entries → investigate Supabase/schema issue first
- Twin still returns `escalate: true` after ingest → investigate FTS tsvector indexing
