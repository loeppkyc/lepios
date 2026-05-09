# Corpus Gap: Seborrheic Dermatitis — Coordinator Investigation

**task_id:** `4aa53419-8b04-45a8-8117-af08fc45052d`
**Discovered by:** smoke-test-q2
**Investigated:** 2026-05-09
**Status:** awaiting-grounding (Colin input required)

---

## Gap Confirmed

The `knowledge` table (category = `personal_knowledge_base`, 2,944 rows) contains zero dedicated entries about seborrheic dermatitis. The smoke test's sql_check referenced a standalone `personal_knowledge_base` table that doesn't exist as a separate table — the correct table is `knowledge` with `category = 'personal_knowledge_base'`.

**Direct query result (run 2026-05-09):**
```sql
SELECT COUNT(*) FROM knowledge
WHERE category = 'personal_knowledge_base'
  AND LOWER(... SIMILAR TO '%(seborrhei|dermatit)%'
-- Result: 3 rows
```

**All 3 rows are incidental:**
| Title | Entity | Why incidental |
|---|---|---|
| `pubmed-sibo.md` | Megan | "atopic dermatitis" mentioned as one of many IBS/probiotic indications |
| `Knowledge Base: Pubmed Child Gut Health` | Cora | no direct match (Crohn's content) |
| `Knowledge Base: Pubmed Anti Inflammatory Diet` | Megan | "dermatitis" in a peripheral gluten sensitivity paper |

**Zero rows added since task creation** (2026-04-24T12:18Z). Gap is real and unaddressed.

---

## What's Needed to Fill the Gap

The existing health knowledge base uses PubMed research ingested via `ingest-claude-md.ts`. Examples in the table:
- `pubmed-sibo.md` (entity: megan)
- `pubmed-hypertension.md` (entity: colin)
- `Knowledge Base: Pubmed Child Gut Health` (entity: cora)

To fill this gap, the coordinator needs **Colin to answer**:

1. **Who is this for?** (Colin / Megan / Cora — determines `entity` tag on knowledge rows)
2. **What context?** Personal diagnosis notes? Treatment protocol? General PubMed research on the condition? All three?
3. **What source file should be ingested?** Does a Dropbox/local file already exist, or should the ingest script run a fresh PubMed fetch for `seborrheic dermatitis`?

---

## Grounding Checkpoint

Cannot proceed autonomously. Filling health knowledge base entries requires:
- Knowing which person the condition applies to
- Colin approving the content that gets added (health domain = personal, per ARCHITECTURE.md §1)

This is a `personal_decision` escalation per coordinator Phase 1b rules.

---

## Proposed Next Step (pending Colin response)

Once Colin answers the three questions above, builder can:
1. Run ingest script targeting `seborrheic dermatitis` PubMed results for the named entity
2. OR manually add a knowledge row from existing notes Colin provides
3. Re-run smoke-test-q2 to confirm gap is closed

**No code change required — data ingestion only.**
