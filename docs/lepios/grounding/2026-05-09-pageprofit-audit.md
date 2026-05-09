# Phase 0 Audit — PageProfit / Amazon Scanner

**Date:** 2026-05-09  
**Source:** `docs/leverage-targets.md T-004` (revised 2026-05-08)  
**Status:** AWAITING "go" — no code written

---

## 1 — What Sprint 3 already shipped (the 10%)

Sprint 3 built the core scan pipeline. These files are live in prod:

### DB (all applied, RLS enforced)

| Migration                                   | Table(s)                                                                  | Status      |
| ------------------------------------------- | ------------------------------------------------------------------------- | ----------- |
| `0004_add_scan_results.sql`                 | `scan_results`                                                            | **SHIPPED** |
| `0006_add_keepa_fields_to_scan_results.sql` | adds `bsr`, `bsr_source`, `rank_drops_30`, `monthly_sold`, `avg_rank_90d` | **SHIPPED** |
| `0007_add_ebay_fields_to_scan_results.sql`  | adds `ebay_listing_median_cad`, `ebay_listing_count`, `ebay_profit_cad`   | **SHIPPED** |
| `0008_add_keepa_history_cache.sql`          | `keepa_history_cache` (ASIN → BSR points JSONB)                           | **SHIPPED** |
| `0010_add_hit_lists.sql`                    | `hit_lists`, `hit_list_items`                                             | **SHIPPED** |

### API routes (all auth-gated via inline `auth.getUser()`)

| Route                                            | LOC | Notes                                                                       |
| ------------------------------------------------ | --- | --------------------------------------------------------------------------- |
| `app/api/scan/route.ts`                          | 211 | Full pipeline: ISBN→ASIN→catalog→buybox→FBA fees→Keepa→eBay→profit→DB write |
| `app/api/bsr-history/route.ts`                   | 43  | Sparkline data for scan card                                                |
| `app/api/hit-lists/route.ts`                     | 85  | List CRUD                                                                   |
| `app/api/hit-lists/[id]/route.ts`                | 27  |                                                                             |
| `app/api/hit-lists/[id]/items/route.ts`          | 108 |                                                                             |
| `app/api/hit-lists/[id]/items/[itemId]/route.ts` | 32  |                                                                             |

### UI pages

| Path                                                    | LOC | Notes                                                                              |
| ------------------------------------------------------- | --- | ---------------------------------------------------------------------------------- |
| `app/(cockpit)/scan/_components/ScannerClient.tsx`      | 720 | ISBNentry, scan result card with BSR sparkline, Keepa/eBay panels, hit-list assign |
| `app/(cockpit)/hit-lists/_components/HitListClient.tsx` | 483 | List management, item status tracking                                              |

### Lib ecosystem (all used by `/api/scan`)

| File                       | LOC | Notes                                                                  |
| -------------------------- | --- | ---------------------------------------------------------------------- |
| `lib/keepa/client.ts`      | 66  | Keepa API client                                                       |
| `lib/keepa/history.ts`     | 143 | BSR point parsing + `keepa_history_cache` read/write                   |
| `lib/keepa/product.ts`     | 56  | Velocity badge computation                                             |
| `lib/ebay/client.ts`       | 65  | eBay Browse API client (Finding API sunset Jan 2025 — already handled) |
| `lib/ebay/fees.ts`         | 33  | eBay fee estimation                                                    |
| `lib/ebay/listings.ts`     | 79  | Active listing fetch + median/range calc                               |
| `lib/profit/calculator.ts` | 17  | `calcProfit`, `calcRoi`, `getDecision`                                 |
| `lib/amazon/catalog.ts`    | —   | `findAsin`, `getCatalogData`                                           |
| `lib/amazon/isbn.ts`       | —   | `normalizeIsbn`, `isIsbn`                                              |
| `lib/amazon/pricing.ts`    | —   | `getUsedBuyBox`                                                        |
| `lib/amazon/fees.ts`       | —   | `getFbaFees`                                                           |

### Cockpit integration

- `CockpitSidebar` has a "PageProfit" section with "Arbitrage Scanner" (`/scan`) and "Hit Lists" (`/hit-lists`) links
- `CockpitNav` has "Scan" and "Lists" entries
- **No cockpit tile** on the main cockpit dashboard (no ScoreTile showing today's scan count or acceptance rate)

---

## 2 — What T-004 done_state requires (the remaining 90%)

The revised T-004 contract (2026-05-08) is not a Streamlit port — it's a pallet-aware scanning station. The 10 sub-modules:

| #   | Sub-module                                                                               | Sprint 3 state                                              | Status                                           |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| 1   | **Pallet intake** — form, `pallets` table extension                                      | `/pallets` exists for invoices                              | Needs AP integration, scanner link               |
| 2   | **AP / accounts-payable table** — batch end-of-month payment                             | Absent                                                      | NOT BUILT                                        |
| 3   | **Scanner station revamp** — pallet-aware, 3-way routing (GO/BBV/DONATE)                 | `/scan` is basic ISBN→result; no pallet context, no routing | PARTIAL                                          |
| 4   | **Tier classifier** — high-demand / collectible / standard rule engine                   | Absent                                                      | NOT BUILT — **BLOCKED on Q-002**                 |
| 5   | **Condition grading** — Claude Vision OCR vs Amazon standards                            | Absent                                                      | NOT BUILT                                        |
| 6   | **One-click FBA list** — open-shipment lookup, auto-price/condition, SP-API push         | Absent                                                      | NOT BUILT                                        |
| 7   | **BBV dual-write** — `lib/bbv/client.ts` + BBV-side `POST /api/inventory/upsert-by-isbn` | Absent                                                      | NOT BUILT — **needs BBV-side endpoint (~1 day)** |
| 8   | **Donate logger** — `scans.outcome='donate'`                                             | Absent                                                      | NOT BUILT (trivial)                              |
| 9   | **Per-pallet analytics** — acceptance rate, P&L, sourcing channel ranking                | `/pallets` shows invoice spend                              | Needs scan-linked P&L layer                      |
| 10  | **Active-pallet morning_digest line**                                                    | Absent                                                      | NOT BUILT                                        |

Plus one missing from the Sprint 3 scope:

- **Cockpit tile** — scan count today, acceptance rate, active pallet — not on main cockpit dashboard

---

## 3 — Streamlit baseline (top 5 by LOC)

All grounded against `pages/21_PageProfit.py` (3,373 LOC) + supporting utils.

| #   | Feature                                         | Streamlit LOC | LepiOS state                                                                              |
| --- | ----------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| 1   | Multi-marketplace lookup + caching              | ~800          | **80% done** — `/api/scan` pipeline complete; missing pallet context and 3-way routing    |
| 2   | Batch listing / TurboLister (SKU, FBA shipment) | ~700          | **0%** — becomes sub-modules 1+2+6 in T-004                                               |
| 3   | Phone relay + QR + settings persistence         | ~500          | **0%** — architecture differs; Sprint 5 grounding doc exists                              |
| 4   | Analytics + hit lists                           | ~400          | **60%** — hit-lists built; analytics page and cockpit tile absent                         |
| 5   | Decision gates + scoring badges                 | ~200          | **90%** — `lib/profit/calculator.ts` + scan route; missing tier classifier (sub-module 4) |

---

## 4 — Data deps

| Dependency                               | State                         | Notes                                                                                       |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| SP-API (ASIN, catalog, buybox, FBA fees) | ✅ LIVE                       | `lib/amazon/` fully wired                                                                   |
| Keepa API                                | ✅ LIVE (assumed)             | Used in Sprint 3; `gpu-day-readiness.md` gives 50% confidence — no recent verification      |
| eBay Browse API                          | ✅ LIVE                       | `lib/ebay/` wired; Finding API → Browse handled                                             |
| Open Library API                         | ✅ (public)                   | No auth; used in Streamlit via `utils/book_lookup.py`                                       |
| Supabase tables                          | ✅ for scan_results/hit_lists | Pallets + AP tables need new migrations                                                     |
| Receipts table                           | ✅ LIVE                       | PR #175 merged today                                                                        |
| Business Review data                     | ✅ Not required               | T-004 is independent                                                                        |
| **BBV API endpoint**                     | ❌ ABSENT                     | Needs `POST /api/inventory/upsert-by-isbn` in BBV repo (~1 day); decided Option B per Q-001 |
| **Colin's tier rules (Q-002)**           | ❌ ABSENT                     | Tier classifier (sub-module 4) blocked until Colin provides rules                           |

---

## 5 — Blockers (stop and flag)

**BLOCKER 1 — Q-002: Tier classifier rules**  
Sub-module #4 (Tier classifier: high-demand / collectible / standard) cannot be built without Colin's rules. `leverage-targets.md` explicitly says "ASK COLIN at Phase 1b." This must be captured at Phase 1b Q&A before the acceptance doc is written.

**BLOCKER 2 — BBV-side endpoint**  
Sub-module #7 (BBV dual-write) requires a new route in the BBV repo. Q-001 is decided (Option B). The ~1-day BBV work can run in parallel with Phase 1 of the scanner, but the integration test cannot pass until the BBV endpoint exists.

**NON-BLOCKER: Condition grading (sub-module 5)**  
Claude Vision quota implications noted in T-004. Run `/api/budget` before designing the batch grading flow. Can be deferred to a follow-up chunk if budget is tight.

---

## 6 — 20%-better evaluation (F19)

T-004 is already 20%+ better than Streamlit on several axes:

| Dimension                | Streamlit                                                                     | T-004 LepiOS                                                                    | Delta                                                   |
| ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Costing accuracy**     | Simple per-item cost input; no pallet-level tracking                          | AP table → landed cost per pallet → cost allocated per scan                     | Structural improvement — enables actual per-book margin |
| **Tier classification**  | None (binary BUY/SKIP)                                                        | Rule-based 3-way routing (Amazon GO / BBV / DONATE)                             | New capability                                          |
| **Condition grading**    | Optional Hugging Face VQA (low accuracy)                                      | Claude Vision vs Amazon condition standards                                     | Significant quality lift                                |
| **Data persistence**     | 24h JSON cache on shared filesystem; lost on process restart                  | Supabase `keepa_history_cache`; survives restarts, visible to other windows     | Reliability improvement                                 |
| **Stale-data surfacing** | Silent; no cache-age indicator                                                | `fetched_at` on every cache row; scan card can surface "Keepa data X hours old" | F18 observability                                       |
| **Dedup**                | Shared filesystem race condition (Streamlit Cloud warning in source comments) | `WHERE NOT EXISTS` on (ISBN/ASIN, pallet_id, cost) — idempotent                 | Correctness improvement                                 |

---

## 7 — Recommendation

**Unblocked sub-modules (can start Phase 1 immediately):**

- Sub-modules 1, 2, 3, 8, 9, 10 and the cockpit tile
- BBV dual-write client side (lib/bbv/client.ts) — stub it, wire up when BBV endpoint ships

**Phase 1b Q&A must capture (before acceptance doc):**

- Q-002: Colin's tier classification rules (precise conditions for high-demand / collectible / standard)
- Condition grading: is this in scope for this sprint or deferred?
- Keepa key: confirm `KEEPA_API_KEY` is current in Vercel prod (50% confidence from readiness tracker)
- eBay key: confirm eBay App ID is in Vercel prod (not checked in readiness tracker)

**Migration slots needed:** Next available is 0170 range (check `scripts/next-migration-number.mjs` at Phase 1 start).

**Estimated scope:** Sub-modules 1+2+3+8+9+10 + cockpit tile = 2-3 migration files + ~800 LOC new code + ~400 LOC revisions to existing scan/pallets pages.

---

_Grounded against: `app/api/scan/route.ts`, `app/(cockpit)/scan/_components/ScannerClient.tsx`, `app/(cockpit)/hit-lists/`, `lib/keepa/`, `lib/ebay/`, `lib/profit/`, `supabase/migrations/000{4,6,7,8,10}_.sql`, `docs/leverage-targets.md T-004`, `docs/sprint-3/state-final.md`\*
