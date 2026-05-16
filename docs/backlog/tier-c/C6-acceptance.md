# C6 — Currency-aware balances on Net Worth

**task_id:** e464f0f3-89af-4c0c-802d-e8e7e3e97775
**Coordinator invocation:** 2026-05-16
**Status:** awaiting Colin approval

---

## Scope

Add a `currency` column (`CAD` | `USD`) to `balance_sheet_entries`. Convert USD rows to CAD at
display time using the Bank of Canada Valet API rate (FXUSDCAD). Show the native USD amount and
CA$ equivalent inline on the Net Worth page. Update the snapshot route so saved snapshots use
the FX-adjusted CAD total.

**One acceptance criterion:** On the Net Worth page, the TD USD Chequing row displays its balance
as "US$312.00" with the CAD equivalent inline (e.g. "≈ CA$431"), and Total Assets increases by
the FX delta vs. the prior (treating USD as par-CAD) value.

---

## Out of scope

- Tracking the PayPal USD $46.29 as a separate balance entry (data-entry gap; out of scope for C6)
- Auto-fetching or syncing USD account balances from any external source
- Supporting currencies other than CAD and USD
- Historical snapshot recomputation (old snapshots remain as-is; only new snapshots use FX)
- Editing `currency` from the Balance Sheet page edit form (Colin can set it in Supabase; UI
  currency selector deferred to C7)

---

## Check-Before-Build findings

| Item | Finding |
|------|---------|
| `currency` column on `balance_sheet_entries` | **Does not exist.** Only id, name, account_type, category, balance, as_of_date, notes, sort_order, updated_at, source. |
| FX utility in `lib/` | **None found.** No existing BoC Valet wrapper, no FX rate cache table. |
| Existing USD rows in production | **One confirmed:** `TD USD Chequing (9924)` (sort_order=5). Notes: "USD value $312.00 — stored as USD numeric, convert at display time if needed." |
| PayPal Business USD | Notes say "PayPal CAD $16.88 + PayPal USD $46.29" but the stored balance (16.88) is the CAD portion only. The USD $46.29 is not tracked in the balance entry — out of scope. |
| FX npm library | Not warranted. BoC Valet API call is ~10 lines. No dependency needed. |
| Bank of Canada Valet API | Free, no auth required. Endpoint: `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1`. Returns `observations[0].FXUSDCAD.v` (string, USDCAD rate). Fallback: `1.38` hardcoded constant if API unreachable. |
| Snapshot route | **Also affected.** `/api/net-worth/snapshot/route.ts` sums balances without FX conversion. Must be updated so saved snapshots record correct CAD totals. |

---

## GitHub prior art

- **Bank of Canada Valet API wrapper:** 10-line inline fetch — no open-source library needed. Build-new (trivial).
- **`lib/amazon/client.ts`** — used as pattern for fetch-with-timeout utility.
- **Decision:** Build-new `lib/boc-valet.ts` (15 lines max). No external dependency.

---

## External deps tested

| Endpoint | Status | Notes |
|----------|--------|-------|
| `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1` | Unreachable from coordinator sandbox (outbound policy) | Response shape documented below from public docs. Vercel production will reach it. |

**BoC Valet API response shape (from public documentation):**
```json
{
  "observations": [
    { "d": "2026-05-15", "FXUSDCAD": { "v": "1.3827" } }
  ]
}
```

Rate = `parseFloat(observations[0].FXUSDCAD.v)`. Fallback = `1.38` if fetch fails or value is
not a finite number.

---

## Files expected to change

| File | Change |
|------|--------|
| `supabase/migrations/0219_balance_sheet_currency.sql` | NEW — ADD COLUMN + UPDATE USD rows + GRANT |
| `lib/boc-valet.ts` | NEW — fetches USDCAD rate from BoC Valet API with fallback |
| `app/api/net-worth/route.ts` | Fetch FX rate; convert USD rows; add `currency` + `cadBalance` to `BalanceSheetEntryLite`; add `usdToCad` to `NetWorthResponse` |
| `app/api/net-worth/snapshot/route.ts` | Fetch FX rate; convert USD rows before summing; store FX-adjusted totals |
| `app/(cockpit)/net-worth/_components/NetWorthPage.tsx` | Show "US$X" badge + "≈ CA$Y" sub-label on USD rows in the table |

**Note:** `BalanceSheetPage.tsx` is NOT changed. The balance sheet page shows raw stored values (what you typed in). Net Worth is the display-time-conversion surface.

---

## Migration spec (0219)

```sql
-- migration 0219_balance_sheet_currency.sql

ALTER TABLE balance_sheet_entries
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'CAD'
  CHECK (currency IN ('CAD', 'USD'));

-- Mark the confirmed USD row
UPDATE balance_sheet_entries
  SET currency = 'USD'
  WHERE name = 'TD USD Chequing (9924)';

-- F24: GRANT for service_role (table already exists, column addition only)
-- No new table — F24 GRANT applies to table creation; column addition is exempt.
-- AD7-exempt: column addition to existing table, not a new CREATE TABLE.
```

**Migration note:** `ALTER TABLE ... ADD COLUMN ... DEFAULT 'CAD'` is safe on Postgres 17 for
any table size — the default is stored in the catalog, no full-table rewrite occurs. Zero
downtime.

**F24 compliance:** F24 requires GRANT on `CREATE TABLE`. This migration uses `ALTER TABLE` to
add a column — no new table. Marking `-- AD7-exempt` to satisfy linter.

---

## Implementation spec

### `lib/boc-valet.ts`

```typescript
const FALLBACK_RATE = 1.38

export async function getUsdToCadRate(): Promise<number> {
  try {
    const res = await fetch(
      'https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1',
      { next: { revalidate: 300 } }  // cache 5 min in Next.js fetch cache
    )
    if (!res.ok) return FALLBACK_RATE
    const data = await res.json() as { observations?: Array<{ FXUSDCAD?: { v?: string } }> }
    const rate = parseFloat(data.observations?.[0]?.FXUSDCAD?.v ?? '')
    return Number.isFinite(rate) && rate > 0 ? rate : FALLBACK_RATE
  } catch {
    return FALLBACK_RATE
  }
}
```

### API route changes (`/api/net-worth/route.ts`)

Add to `BalanceSheetEntryLite`:
```typescript
currency: 'CAD' | 'USD'
cadBalance: number   // balance converted to CAD (= balance * usdToCad if USD, else balance)
```

Add to `NetWorthResponse`:
```typescript
usdToCad: number   // rate used for this response (for display in UI)
```

Logic: for each row, if `currency === 'USD'`, set `cadBalance = r2(row.balance * usdToCad)`.
Use `cadBalance` in all summing (totalAssets, byCategory, byPillar). Pass `cadBalance` as the
value used in UI display, but also pass `currency` and raw `balance` so UI can show "US$312".

### API route changes (`/api/net-worth/snapshot/route.ts`)

Same pattern: fetch FX rate, convert USD rows, use CAD-equivalent in `totalAssets`/`totalLiabilities`/`netWorth` sums.

### UI changes (`NetWorthPage.tsx`)

In `EditableRow` (for USD rows):

- Balance column: show `US$312` (raw value, red-orange or muted) + `≈ CA$431` on a sub-line
- The category total (`RowGroup`) still shows CAD sum (already correct since `cadBalance` feeds it)
- The KPI banner stays CAD throughout

Use `row.currency === 'USD'` check. Format: `row.balance.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 })`.

---

## Grounding checkpoint

**What Colin will verify (NOT "tests pass"):**

1. `SELECT name, balance, currency FROM balance_sheet_entries WHERE currency = 'USD';`
   → Expect exactly one row: `TD USD Chequing (9924)`, balance=312.00, currency=USD
2. Open `/net-worth` in the browser:
   → TD USD Chequing shows "US$312" with a "≈ CA$..." sub-label
   → Total Assets is higher than the prior amount by approximately `312 * (rate - 1)` CAD
   → A `usdToCad` rate is visible somewhere on the page (KPI row footer or row tooltip)
3. Click "Save Snapshot":
   → New snapshot `net_worth` value matches the FX-adjusted total shown on screen

**Kill signal:** If the BoC API cannot be reached from Vercel in production (e.g., blocked by Vercel's outbound proxy), the fallback rate 1.38 will be used. Colin should confirm whether the rate shown matches the live BoC rate or is the fallback. If always-fallback, we need to cache the rate in `harness_config` instead.

---

## Cached-principle decisions

None cached. All decisions (additive migration, display-time conversion, BoC API fallback) are
straightforward and reversible, but this doc is being escalated to Colin for explicit approval
because:
1. The migration data-writes (marking specific rows as USD) require Colin to confirm "yes, TD
   USD Chequing is the only USD row"
2. The snapshot route change affects how future net worth history is stored

---

## Open questions

1. **Are there any other USD-denominated rows beyond TD USD Chequing?** If so, name them — builder will add them to the migration UPDATE.
2. **Should the usdToCad rate be shown on the Net Worth page?** (e.g., a small "Rate: 1 USD = 1.38 CAD" footnote.) Coordinator assumes yes — Colin can override.
3. **Fallback rate of 1.38**: Acceptable? Colin may prefer a higher number (e.g., 1.40) if the rate is typically higher. Hardcoded fallback only fires if BoC API is unreachable.

---

## Auto-proceed log entry

```
2026-05-16T00:00:00Z sprint=C6 chunk=currency-aware-balances doc=docs/backlog/tier-c/C6-acceptance.md
cited_principles: [additive-migration, display-time-conversion, external-api-fallback]
trigger_match_evidence: |
  Situation: ADD COLUMN with DEFAULT (additive, no rewrite) on existing table; no DROP/TRUNCATE.
  Pattern: standard additive migration, reversible.
  Situation: FX conversion at API route layer, not stored in DB.
  Pattern: display-time calculation is a well-grooved pattern.
reversibility_check: |
  Migration ADD COLUMN: reversible via DROP COLUMN (data loss only for currency='USD' marks — acceptable).
  lib/boc-valet.ts: new file, delete to revert.
  Route edits: additive fields on existing interfaces — revert with git.
  Snapshot route: same; old snapshots unaffected.
reversibility: LOW cost.
confidence: medium
outcome: escalated (two open data questions require Colin; confidence not high enough for cache-match)
```
