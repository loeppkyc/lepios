# Sprint 3 — Close

**Closed:** 2026-04-19
**Kill criterion:** PASS

---

## What Shipped

| Chunk | Feature | Commit |
|-------|---------|--------|
| A | Amazon CA scan: ISBN → ASIN → buy box → FBA fees → profit/ROI/decision | `70b2e3f` |
| B | Keepa velocity signal (rankDrops30, monthlySold, avgRank90d, velocityBadge) | `b3e482c` |
| C | eBay CA active listing comps (median/low/high, est. profit) | `b3e482c` |
| C.5 | BSR sparkline (tap-to-load, on-demand, Supabase cache) | `b3e482c` |
| E.1 | Hit list create + populate (ISBNs via textarea, idempotent upsert, 200-ISBN max) | `b2e05b7` |
| E.2 | Hit list view + item management (× per item, Delete list, ownership verified) | `6630c72` |
| E.3 | Batch scan (single cost, sequential loop, progressive results, graceful error handling) | `9515ff4` |
| E.4 | Save-from-scan-card (lazy list fetch, existing list or new inline, no re-scan) | `3af313d` |
| BACKLOG-7 | Cockpit nav: email indicator + Sign out button (supabase.auth.signOut → /login) | `764542f` |

**Chunk D (buyback pricing):** Deferred — no active buyback vendor. Preserved as BACKLOG-6.

---

## Migrations Applied

| Migration | Description |
|-----------|-------------|
| `0010_add_hit_lists` | `hit_lists` + `hit_list_items` tables, RLS enabled, unique(hit_list_id,isbn) |

---

## API Surface Added

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/hit-lists` | Fetch all lists with item counts |
| POST | `/api/hit-lists` | Create list |
| DELETE | `/api/hit-lists/[id]` | Delete list (CASCADE to items) |
| GET | `/api/hit-lists/[id]/items` | Fetch items for list |
| POST | `/api/hit-lists/[id]/items` | Add ISBNs to list (idempotent) |
| DELETE | `/api/hit-lists/[id]/items/[itemId]` | Delete item |
| POST | `/api/scan` | Extended: optional `hit_list_item_id`; returns `scanResultId` |

---

## Test Count

127 passing (vitest). No regressions introduced.

---

## Open Items at Close

| Item | Type | Notes |
|------|------|-------|
| BACKLOG-3 | GitHub remote | No remote configured; Vercel CLI is deploy path — add before Sprint 4 |
| BACKLOG-5 | React #418 on /scan | Test incognito first; likely extension artifact |
| BACKLOG-6 | Buyback pricing | Gate: active vendor + Colin approval |
| BACKLOG-8 | scan_result_id linkage on save-from-scan | Additive; not blocking any current feature |
| BACKLOG-8 (root redirect) | / → /scan redirect | Starter page shows at root |
| BACKLOG-9 | Nav logout contrast | Email near-unreadable on dark bg; cosmetic |

---

## Sprint 4 Gate

**Do not start Sprint 4 until:** Colin completes one real-world sourcing session using E.3 batch scan and reports back. Field test is the only meaningful validation of the scanner workflow.

**Retrospective:** `docs/sprint-3-retrospective.md`
