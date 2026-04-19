# LepiOS — Ideas Backlog

Long-horizon ideas that are NOT v1 scope. Each entry documents context, phases, and hard rules.
No work begins on any item without explicit Colin approval post-v1 kill-criterion.

---

## BACKLOG-6 — Buyback Pricing Integration

**Status:** NOT STARTED. Deferred from Sprint 3 Chunk D.
**Raised:** 2026-04-19

**Context:**
No active buyback outlet currently in use. Single-price env var model is too simplistic —
would pollute scan data with a fixed number that doesn't reflect vendor/category/condition
variability. Buyback decisions are more useful at hit-list / batch-review time than at scan
time.

**Natural home:** Sub-feature of the hit list (Chunk E) or a later multi-vendor sprint when
a real buyback relationship exists.

**Acceptance doc preserved at:** `docs/sprint-3/chunk-d-acceptance.md`

**When built:**
- Multi-vendor support (BookScouter, Ziffit, WeBuyBooks — condition/category-aware pricing)
- Surface at hit-list review time, not at scan time
- No env var fixed-price hack — real per-ASIN vendor quotes or a maintained price table

**Hard rules:**
- No work begins without active buyback relationship and Colin approval.

---

## BACKLOG-5 — React #418 Hydration Mystery on /scan

**Status:** NOT STARTED. Not blocking any sprint work.
**Raised:** 2026-04-19

**Context:**
React error #418 (hydration mismatch) fires on hard refresh of `/scan` even after wrapping
`ScannerClient` in `next/dynamic` with `ssr: false`. The scanner is fully client-rendered; the error
does not block any features. Suspected cause: browser extension DOM injection between server render
and React hydration (evidenced by `safeParseJson 'undefined' is not valid JSON / NodeList(0)` in the
same console session). Confirmed extension-sourced if error disappears in a clean incognito session.

**When investigated:**
- Test in incognito with all extensions disabled first. If #418 is gone → close the issue.
- If #418 persists in clean session → deeper investigation needed (root layout, Supabase SSR init).

**Hard rules:**
- Does not block Chunk D or any sprint work. Cosmetic until proven otherwise.

---

## BACKLOG-4 — Keepa Price/BSR History Chart

**Status:** NOT STARTED. Deferred from Sprint 3 Chunk B.
**Raised:** 2026-04-18

**Context:**
Chunk B uses Keepa `stats=90` only (~1 token/scan). Full BSR/price history requires `history=1`
(~6 tokens/scan) — violates F7 token budget if added to the scan path. The scan page is a
decision surface, not an exploration surface. Charts belong on a per-book detail page.

**Natural home:** Chunk F (batch/history/analytics) or a per-book detail page after Chunk E
(hit list) lands.

**When built:**

- Call Keepa `/product?history=1` on demand (tap-to-expand), NOT on every scan.
- Cache response for 24h (keyed by ASIN) to avoid re-spending tokens on repeat views.
- Render BSR history and 90-day price history as sparklines.

**Hard rules:**

- Never add `history=1` to the per-scan Keepa call. On-demand only.
- No work begins without explicit Colin approval.

---

## BACKLOG-2 — Sports Prediction Modeling Pipeline (Multi-Phase)

**Status:** NOT STARTED. Not v1. No action without Colin's explicit approval post-v1 kill-criterion.
**Raised:** 2026-04-18

**Context:**
Colin raised the idea of backtesting historical game data to build win-probability models that
could feed into the Betting tile's Kelly calculator. This is legitimate long-term work — but it is
explicitly a post-v1 initiative. The v1 betting tile uses Colin's own win-probability estimates,
which is intentional (calibration-first; build models only once you have baseline data to beat).

---

### Phase 1 — Historical Game Database Only

- NBA, NFL, MLB, NHL — 5-10 seasons of historical game data
- Sources: publicly available APIs (Retrosheet, basketball-reference, etc.) — no odds data
- Goal: queryable archive as decision support context for the Betting Agent
- Output: `game_history` table in Supabase with standardized schema
- No modeling. No odds. No Kelly. Just data.
- **Gate:** explicit Colin approval before Phase 1 starts

---

### Phase 2 — Baseline Per-Sport Win-Probability Models

- Train on 70% of Phase 1 data, test on 30% out-of-sample
- Goal: calibration, NOT beating books
- Acceptance criterion: Brier score ≤ 0.25 per sport (better than coin-flip calibration)
- Output: model files + calibration curves per sport
- **Gate:** Phase 1 complete + Colin approval

---

### Phase 3 — Historical Odds Integration + ROI Measurement

- Requires paid-tier historical odds data (The Odds API or similar)
- Retrain with closing odds as calibration benchmark
- Measure ROI against realistic vig on 3-year out-of-sample holdout
- **HARD RULE:** If ROI is not demonstrably positive after vig on the out-of-sample period,
  the model is NOT deployed. No exceptions. No "it was close."
- Output: ROI curve, calibration plots, confidence intervals
- **Gate:** Phase 2 complete + positive ROI confirmed + Colin approval

---

### Phase 4 — Live Integration

- Positive-EV flagging with Kelly sizing in the Betting tile
- Model outputs feed `implied_prob` override if confidence threshold met
- **Gate:** Phase 3 positive ROI confirmed + Colin approval

---

### Hard Rules (apply to all phases)

1. No phase ships without prior phase validation — no skipping
2. Backtest claims never trigger real-money bets — model is decision support only
3. Colin's own win-probability estimates always remain primary input; model is a secondary signal
4. No Phase 1 start without explicit Colin approval after v1 kill-criterion is met
5. Every model output is tagged **generated** by the Reality-Check Agent until Phase 3 ROI is confirmed
