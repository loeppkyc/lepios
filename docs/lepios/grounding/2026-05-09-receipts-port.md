# Grounding Checkpoint — Receipts Port (PR #175)

**Branch:** feat/receipts-port  
**Migration:** 0169_receipts_v2.sql  
**Date:** 2026-05-09  
**Status:** PENDING SIGN-OFF — do not merge until Colin approves

---

## 1 — Migration 0169 schema diff

**Changes:** additive only — two new columns on `public.receipts`, one new index. No existing columns modified, no rows deleted, no defaults changed.

| Column       | DDL                                                                                              | Existing rows                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `ocr_source` | `TEXT NOT NULL DEFAULT 'manual' CHECK (ocr_source IN ('manual','claude_vision','email_import'))` | Get default `'manual'` — safe (Postgres applies the stored default at catalog level, no full table rewrite since PG 11) |
| `vendor_key` | `TEXT NOT NULL DEFAULT ''`                                                                       | Get default `''` — safe                                                                                                 |

**Index:** `CREATE INDEX IF NOT EXISTS receipts_vendor_key_idx ON public.receipts (vendor_key)` — non-unique, non-blocking in Supabase hosted PG (concurrent by default). Safe.

**Destructive operations:** NONE.

**Minor comment error in the migration:** The header comment says "Both columns are nullable with defaults" — they are **NOT NULL with defaults**, not nullable. The implementation is correct and safe; only the comment is wrong.

**Not yet applied to prod.** This migration is on the feature branch. Needs to be applied at merge time via `mcp__claude_ai_Supabase__apply_migration`.

---

## 2 — Routes and components touched

| File                                                  | Change summary                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(cockpit)/receipts/_components/ReceiptsPage.tsx` | Full rewrite: replaced 62 `style={}` inline attributes with Tailwind classes (F20 compliance); added `MonthlySummary` strip (4 tiles: total spend, GST ITCs, matched count, unmatched); added `BookkeeperView` accordion tab; added two-tab switcher (Receipt List / Bookkeeper View); drag-drop upload zone unchanged in behavior |
| `app/api/receipts/route.ts`                           | GET: replaced bare `createClient()` with `requireUser()` (F22 fix) + fixed month filter to query `receipt_date` with `upload_date` fallback via `.or()` (bug fix); POST: added `vendor_key` normalization and `ocr_source` write using new columns                                                                                 |
| `app/api/receipts/[id]/route.ts`                      | DELETE: replaced raw `auth.getUser()` with `requireUser()` (F22 fix); also clears `hubdoc=false` on matched expense when receipt is deleted (correct cascading cleanup)                                                                                                                                                            |
| `app/api/receipts/[id]/match/route.ts`                | PATCH: replaced raw `auth.getUser()` with `requireUser()` (F22 fix); clears old matched expense's `hubdoc` before setting new one (correct re-link behavior)                                                                                                                                                                       |
| `lib/types/receipts.ts`                               | Added `vendor_key: string` and `ocr_source: 'manual' \| 'claude_vision' \| 'email_import'` to `Receipt` interface; added `OcrResult` interface                                                                                                                                                                                     |
| `docs/sprint-receipts/receipts-acceptance.md`         | New — acceptance doc for this sprint                                                                                                                                                                                                                                                                                               |
| `docs/sprint-receipts/receipts-study.md`              | New — Phase 1a Streamlit study doc                                                                                                                                                                                                                                                                                                 |
| `supabase/migrations/0169_receipts_v2.sql`            | New — see §1                                                                                                                                                                                                                                                                                                                       |

---

## 3 — Streamlit parity

Streamlit Receipts page has 7 tabs. Disposition of each:

| Streamlit tab            | LepiOS status              | Notes                                                                                                                                                                   |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload Receipt           | **PORTED**                 | Drag-drop + camera capture + Claude Haiku OCR. JPEG/PNG/WebP only (HEIC deferred — Streamlit used pillow_heif). 4.5 MB limit (same as Streamlit's Claude Vision limit). |
| Review Queue             | **PARTIAL**                | Inline match picker in the receipts table row (click "Link"). No dedicated 3-panel Hubdoc-style queue. Adequate for the v1 volume; full queue deferred.                 |
| All Receipts             | **PORTED**                 | Month-filtered table with status badges and match/unlink/delete actions. Monthly summary strip added (better than Streamlit).                                           |
| Bookkeeper View          | **PORTED (scope-limited)** | Accordion with category breakdown — but receives only the selected month's receipts. Streamlit showed YTD across all months. See flag §F1.                              |
| Email Import             | **DEFERRED**               | Accepted — `gmail_invoice_sync.py` is a subprocess call, not portable to serverless. No loss of current functionality.                                                  |
| Statement Reconciliation | **DEFERRED**               | Accepted — requires join with `business_expenses` + color-coded UI. Separate sprint.                                                                                    |
| Hubdoc Archive           | **DEFERRED**               | Accepted — reads from Dropbox `/Hubdoc`, different storage backend. Unblocked by Dropbox client now shipping in PR #179.                                                |

**Streamlit improvements preserved in LepiOS:**

- UUID-based expense matching (vs Streamlit's fragile sheet-row-number)
- Lowercase `matched`/`review`/`unmatched` enum (Streamlit used capitalized strings)
- Supabase Storage for images (vs Streamlit's Google Drive service account)

---

## 4 — F18 surfacing

**Acceptance doc commitment:** OCR success/failure events, receipt save events, match rate — all to `agent_events`.

**Reality:** Zero `agent_events` inserts exist anywhere in `app/api/receipts/**`. The metrics described in the acceptance doc are not implemented.

**What IS visible:**

- `MonthlySummary` strip shows total spend, GST ITCs, matched/unmatched counts inline on the page.
- The morning_digest integration ("X receipts, Y% matched, $N GST ITCs") is not implemented.

**Verdict: F18 is PARTIALLY met.** UI visibility exists via the summary strip. Event logging and morning_digest surfacing are missing. This is a gap but not a blocker for v1 if explicitly deferred.

---

## 5 — F19 hook

What this port delivers that is ≥20% better than Streamlit:

1. **Correctness:** The `receipt_date` query bug is fixed. Streamlit also queries by receipt date; the LepiOS route had been querying `upload_date` only — a January upload of a December receipt would silently appear in the wrong month. Fixed.
2. **Correctness:** UUID-based expense linking. Streamlit's fragile sheet-row-number reference breaks on row deletions. LepiOS uses stable UUIDs throughout.
3. **Security:** F22 auth on all routes (requireUser). Streamlit is gated only at the app shell; individual pages have no per-route checks.
4. **UX:** Monthly summary strip (spend / GST / match%) surfaced at the top of the list. Streamlit requires navigating to All Receipts tab to see aggregates.

**Remaining 20% opportunity (deferred, not this PR):**

- Full-year bookkeeper view (see §F1)
- F18 event logging + morning_digest receipts tile
- Vendor memory system (`vendor_rules` table → auto-fill category on OCR match)
- Statement reconciliation view

---

## 6 — Harness rollup impact

**Current Receipts component:** weight 10 at 5%.

**Evidence in this PR:**

| Workflow                              | Implemented           | Verified by code read                              |
| ------------------------------------- | --------------------- | -------------------------------------------------- |
| Upload + OCR                          | Yes                   | `handleFile` → `/api/receipts/scan` → `handleSave` |
| Receipt list (by month, correct date) | Yes                   | GET route with receipt_date OR query               |
| Match / unlink                        | Yes                   | PATCH match route, inline MatchPicker              |
| Delete + storage cleanup              | Yes                   | DELETE route removes storage object                |
| Monthly summary                       | Yes                   | MonthlySummary component                           |
| Bookkeeper accordion                  | Yes (scoped to month) | BookkeeperView component                           |
| Auth on all routes                    | Yes                   | requireUser on GET, POST, DELETE, PATCH            |
| New columns (ocr_source, vendor_key)  | Yes                   | Migration 0169 + POST handler writes both          |

**What's missing:** F18 event logging, morning_digest receipts tile, full-year bookkeeper view, email import, statement reconciliation.

**Estimated post-merge %:** Core capture + list + match workflows are complete. Missing: observability and advanced views. Reasonable post-merge claim: **50–60%** (up from 5%), contingent on passing smoke test (AC-4 manual upload test).

**Query to confirm current DB state before merge:**

```sql
SELECT value FROM harness_config WHERE key = 'receipts_component_pct';
-- or
SELECT slug, completion_pct FROM harness_components WHERE slug ILIKE '%receipt%';
```

---

## FLAGS — must be addressed or explicitly deferred before sign-off

**F1 — BookkeeperView scope limitation (deferred, document it)**
`BookkeeperView` receives the `receipts` prop, which is the current selected month's data. Its "group by month" loop will always produce exactly one accordion panel (the selected month). The Streamlit bookkeeper view shows all months YTD in a single view. This diverges from the acceptance doc's "Bookkeeper month view" feature.

The component still adds value (category breakdown per month when you navigate to that month), but it's not a true multi-month accordion. Must be explicitly acknowledged in the acceptance doc as "v1 = single-month accordion; YTD accordion = v1.1."

**F2 — Dead link: `/api/receipts/[id]/image` (must fix or remove before merge)**
`BookkeeperView` renders `<a href={`/api/receipts/${r.id}/image`}>Receipt</a>` when `storage_path` is set. This route does **not exist** (`app/api/receipts/` contains only `route.ts`, `scan/route.ts`, `[id]/route.ts`, `[id]/match/route.ts`). Clicking the link returns 404.

**Options:**

1. Add `app/api/receipts/[id]/image/route.ts` that reads from Supabase Storage and redirects to a signed URL. (Correct fix.)
2. Remove the link from BookkeeperView and replace with nothing until the image route is built.

This is a **merge blocker** — the link is visible and will 404 for any receipt with an image.

**F3 — F18 agent_events logging not implemented (defer with doc update)**
The acceptance doc §F18 commits to logging `receipt.ocr.success`, `receipt.ocr.failed`, and `receipt.saved` events to `agent_events`. None of these exist in the route handlers. Either implement them before merge or update the acceptance doc to explicitly defer to v1.1 with a queued task.

---

## Pre-merge checklist

- [ ] **F2 fix:** Either add `/api/receipts/[id]/image` route OR remove the dead link from BookkeeperView
- [ ] **F1 acknowledge:** Update acceptance doc to note single-month scope of BookkeeperView v1
- [ ] **F3 decision:** Implement F18 logging OR defer to v1.1 with explicit task queue entry
- [ ] **AC-4 manual smoke test:** Upload a real JPEG receipt, confirm OCR prefills vendor/date/amount, save, verify in list
- [ ] **AC-8 migration apply:** Apply 0169 to prod via Supabase MCP at merge time
- [ ] **Harness rollup update:** After merge, bump `harness_components` for Receipts from 5% to verified post-merge %
- [ ] **Vercel deploy confirm:** List deployments after merge, confirm new build landed on main
