# Session Handoff — 2026-04-18 Night

## Sprint 3 Status

### Shipped and live at lepios-one.vercel.app/scan

| Chunk | Feature | Verified |
|-------|---------|---------|
| A | ISBN → ASIN lookup via SP-API (Amazon CA) | ✓ Real book scanned |
| B | Keepa velocity: avg_rank_90d, rank_drops_30, velocity badge | ✓ |
| C | eBay sold listings (3 comps, median price, margin) | ✓ |
| C.5 | BSR sparkline: tap-to-load, 6h Supabase cache, on-demand only | ✓ Real book: HeartSmart Cooking, BSR 2,065 |

All four chunks committed, deployed to Vercel, smoke-tested with a real scan.

---

### Deferred / Backlog

**BACKLOG-6 — Buyback pricing (was Chunk D)**
- No active buyback outlet. Deferred.
- Acceptance doc preserved at `docs/sprint-3/chunk-d-acceptance.md`.
- When built: multi-vendor (BookScouter, Ziffit, WeBuyBooks), surface at hit-list time, no env-var fixed-price hack.
- Hard rule: no work without active buyback relationship + Colin approval.

**BACKLOG-5 — React #418 on /scan**
- Hydration mismatch fires on hard refresh. Cosmetic — no features blocked.
- Suspected cause: browser extension DOM injection (safeParseJson / NodeList(0) pattern).
- To investigate: test in clean incognito session. If #418 gone → close. If persists → deeper dig.
- Not blocking any sprint work.

---

### Chunk E.1 — Hit List (create + populate)

**Status:** Acceptance doc written. Awaiting Colin review before build starts.

**Doc:** `docs/sprint-3/chunk-e1-acceptance.md`

**Key design decisions locked:**
- Schema: `hit_lists` + `hit_list_items` (thin — no duplicated profit/title columns)
- `hit_list_items.scan_result_id UUID FK → scan_results(id) ON DELETE SET NULL` — view joins on this, no data duplication
- `cost_paid_cad` nullable at add time, populated at scan time (E.3)
- Duplicate ISBNs in same list: silently skipped, `skipped` count returned
- Max 200 ISBNs per request
- Chunk decomposition confirmed: E.1 (create/populate) → E.2 (view/manage) → E.3 (batch scan) → E.4 (save-to-list from scan card)

**Two open questions Colin deferred to morning:**
1. Nav label: "Hit Lists" or shorter?
2. `person_handle` default `'colin'` with SPRINT5-GATE comment — confirm consistent with rest of app

**Do not build until Colin pastes the doc for review and approves.**

---

## Resume Instructions

1. Colin will paste `chunk-e1-acceptance.md` for review
2. He'll approve or request corrections
3. On approval: build E.1 in order (migration → API routes → UI → nav link → tests → smoke test)
4. Do not touch BACKLOG-5 or BACKLOG-6

---

## Infrastructure Notes

- Vercel project: `lepios-one` — pushes to `master` auto-deploy
- Supabase project: `xpanlbcjueimeofgsara`
- Migration applied: `0008_add_keepa_history_cache` (keepa_history_cache table, RLS enabled)
- Migration pending (E.1): `0010_add_hit_lists` — not applied yet
- Pre-commit hook requires `ANTHROPIC_API_KEY`. Bypass: `SKIP_AI_REVIEW=1 git commit --no-verify` + log to `docs/review-skips.md`
