# Sprint 3 — Chunk C.5 Acceptance Criteria

> BSR sparkline, tap-to-load. On-demand only. 24h cache required.
> Triggered by real scan signal: More HeartSmart Cooking — BSR 2,065 snapshot vs 355k avg_rank_90d.
> The 90d snapshot BSR in Chunk B is dangerously misleading without context.

---

## Why This Chunk Exists

Chunk B surfaces `avg_rank_90d` (355,484) and `rank_drops_30` (0) — both available from `stats=90`.
The velocity badge correctly said SLOW. But the scan also showed BSR 2,065 from SP-API — a single
snapshot that looks hot against a cold baseline. Without the history curve, a buyer scanning fast
could misread the signal. The sparkline closes that gap at ~6 tokens, on-demand, cached.

---

## F7 Compliance Analysis

**F7 rule:** Reserve `history=1` calls for on-demand / analysis use, never on every scan.
Set `MIN_TOKENS_TO_PROCEED = 200`.

**This chunk:**

- Scan path: unchanged — still `stats=90` only, ~1 Keepa token per scan ✓
- Sparkline tap (cache miss): `history=1&stats=90`, ~6 tokens per unique ASIN per 24h ✓
- Sparkline tap (cache hit, within 24h): 0 tokens ✓
- No pre-fetching, no background fetch — strictly on-demand ✓

**Compliant.** The 24h cache is what makes this viable. 100 scans/day on the same ASIN = 6 tokens
total, not 600.

---

## Acceptance Criterion (one sentence)

Tapping the BSR number on the scan result card triggers a fetch of Keepa BSR history via
`/product?history=1&stats=90` (or returns the cached response if fetched within 24h), renders a
90-day BSR sparkline as an inline SVG inside the result card, and logs `keepa_tokens_left` from the
Keepa response to `agent_events.meta` — while the scan-path token budget remains unchanged at ~1
token per scan.

---

## Streamlit Baseline Note (§8.4 Check-Before-Build)

Streamlit `utils/amazon.py:get_keepa_data()` calls `history=1&stats=180` and returns
`rank_history` as `[(datetime, rank), ...]` from `csv[3]` (flat Keepa minute-rank pairs).

Streamlit renders BSR chart via `https://graph.keepa.com/pricehistory.png?asin=...&salesRank=1&domain=6`
— an external image URL, no custom rendering. **LepiOS uses inline SVG instead** (Design Council
primitive requirement; external image has no style control and third-party uptime dependency).

Data extraction logic is a direct port of `get_keepa_data()`. No new logic invented.

---

## New API Route

`GET /api/bsr-history?asin={ASIN}`

**Response (cache hit or fresh fetch):**

```json
{
  "asin": "B001234567",
  "points": [
    { "t": 1704067200, "rank": 142000 },
    { "t": 1704326400, "rank": 98000 }
  ],
  "fetchedAt": "2026-04-18T20:00:00Z",
  "fromCache": true
}
```

`points` = pre-processed BSR history, last 90 days, rank > 0 only, sorted ascending by `t`
(Unix epoch seconds). Empty array = no rank data in Keepa for this ASIN.

**Auth:** Supabase session cookie required (same as `/api/scan`). Returns 401 if unauthenticated.

---

## Keepa Call Spec

```
GET https://api.keepa.com/product?key={key}&domain=6&asin={asin}&history=1&stats=90
```

- `domain=6` = Amazon.ca
- `history=1` = include price/rank CSV history
- `stats=90` = 90-day stats (also needed for tokens_left in response)
- NO `rating=1` — not needed for BSR history, saves ~1 token

**Extracting BSR history from response:**

```
csv = product.csv                        // flat arrays by price type
rank_raw = csv[3]                        // sales rank: [t0, r0, t1, r1, ...]
KEEPA_EPOCH = 2011-01-01T00:00:00Z      // Keepa minutes offset from this date
cutoff = now - 90 days

for i in 0, 2, 4, ...:
  t = rank_raw[i]          // Keepa minutes
  r = rank_raw[i+1]        // rank (-1 = out of stock, skip)
  if r > 0:
    unix_t = KEEPA_EPOCH + t*60 seconds
    if unix_t >= cutoff: include {t: unix_t, rank: r}
```

---

## Database Schema — keepa_history_cache

```sql
-- 0008_add_keepa_history_cache.sql
CREATE TABLE public.keepa_history_cache (
  asin        TEXT PRIMARY KEY,
  points      JSONB NOT NULL,          -- [{t: unix_seconds, rank: number}, ...]
  tokens_left INT,                     -- tokensLeft from Keepa response, for audit
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON public.keepa_history_cache (fetched_at);

ALTER TABLE public.keepa_history_cache ENABLE ROW LEVEL SECURITY;
-- SPRINT5-GATE: policy currently allows any authenticated user to read any ASIN's
-- cache (fine for single-operator today). Review and tighten when multi-user auth
-- lands per ARCHITECTURE.md §7.3 hard gate. BSR history is not user-sensitive data,
-- but the policy pattern must still be audited with all other RLS policies at that time.
CREATE POLICY "keepa_history_cache_authenticated" ON public.keepa_history_cache
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
```

**Cache TTL logic (in the route, not the schema):**

- On request: query `WHERE asin = $1 AND fetched_at > now() - interval '6 hours'`
- Hit → return stored `points` with `fromCache: true`
- Miss → call Keepa, upsert row, return fresh `points`

TTL is 6 hours (not 24h): BSR can swing meaningfully within a day on spike books — the exact class
this chunk solves for. 6h caps token cost at ~24 tokens/ASIN/day worst-case, still trivial.

No per-user scoping — BSR history is the same for all users. Single row per ASIN.

---

## Inline SVG Sparkline Spec

No external chart library. Pure SVG. Rendered client-side in React from the `points` array.

**Dimensions:** `200px × 48px`

**Y axis (rank):** Inverted — lower rank (better seller) renders higher on the chart.

```
y = (1 - (rank - min_rank) / (max_rank - min_rank)) * 48
```

If all ranks are identical (flat line), render a horizontal line at y=24.

**X axis (time):** Left = oldest, right = newest.

```
x = (t - min_t) / (max_t - min_t) * 200
```

**Render as `<polyline>`:**

- Stroke: `var(--color-text-muted)` (neutral — not positive/negative, it's just history)
- Stroke width: 1.5
- Fill: none
- No axes, no labels, no tick marks — it's a sparkline

**Current BSR dot:** A filled circle at the rightmost data point.

- Radius: 3px
- Fill: `var(--color-accent-gold)`

**If `points.length === 0`:** Render nothing (hide the sparkline row entirely).

---

## UI Interaction

**Trigger:** The BSR text in the result card (`BSR {n.toLocaleString()}`) becomes a tappable element.

- Default state: BSR number with a subtle underline or `cursor: pointer`
- Loading state: BSR text + small spinner (reuse loading pattern from scan button)
- Loaded state: sparkline appears below (or replaces) the BSR line
- Tap again when loaded: collapses sparkline (toggle)
- Error state (Keepa unavailable): BSR text stays, no sparkline, no error shown to user

The sparkline does NOT appear automatically on scan — only on explicit tap.

---

## Build Sequence

1. `supabase/migrations/0008_add_keepa_history_cache.sql`
2. `lib/keepa/history.ts` — `getBsrHistory(asin)`: check cache → Keepa call → upsert cache → return points
3. `app/api/bsr-history/route.ts` — GET handler: auth guard, call `getBsrHistory`, return JSON
4. `components/cockpit/BsrSparkline.tsx` — pure SVG sparkline component; accepts `points[]`
5. Update `ScannerClient.tsx` — tap handler on BSR text; fetch `/api/bsr-history`; render `<BsrSparkline>`
6. Unit tests for `BsrSparkline` (snapshot or point calculation tests)
7. Manual smoke test on live site: scan More HeartSmart Cooking → tap BSR → verify sparkline shows the 2k spike against the 355k baseline

---

## Pass Conditions

All of the following must be true:

- [ ] Scanning any ISBN does NOT trigger a Keepa `history=1` call — scan-path token budget unchanged at ~1 token
- [ ] Tapping the BSR number triggers `GET /api/bsr-history?asin=...` and renders a sparkline
- [ ] Second tap within 24h returns `fromCache: true` (verify via Network tab or log)
- [ ] `keepa_history_cache` row exists in Supabase after first tap
- [ ] Second tap does not create a second Keepa API call (verify via `keepa_history_cache.fetched_at` unchanged)
- [ ] `agent_events.meta` contains `keepa_tokens_left` from the sparkline Keepa call (cache miss only)
- [ ] Sparkline SVG renders: line, current-BSR dot, no axes, no labels
- [ ] Y axis is inverted: lower rank number renders higher on chart (BSR 1 = top, BSR 2M = bottom)
- [ ] Tap again → sparkline collapses (toggle behavior)
- [ ] If `points` is empty, sparkline row is hidden (no broken SVG)
- [ ] `npm test` passes

## Fail Conditions (stop and escalate)

- Keepa `history=1` fires on every scan (scan-path token budget violated — F7 breach)
- 24h cache not respected — second tap within 24h hits Keepa again
- `keepa_tokens_left` missing from `agent_events.meta` on cache-miss sparkline calls
- Sparkline renders with Y axis un-inverted (rank 1 appears at bottom — misleading)

---

## Out of Scope (Chunk C.5)

- Price history sparkline (Chunk F)
- Pre-fetching sparklines at scan time
- Sparkline for avg_rank_90d or Keepa competitor data
- US domain BSR history
- Buyback pricing (Chunk D)
- Hit list (Chunk E)
- Batch mode (Chunk F)
