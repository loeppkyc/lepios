# Sprint 6 — Chunk C: Scan History Page

**Status:** APPROVED — Colin explicit delegation 2026-05-10
**Migration:** none (scan_results table already exists)
**Branch:** feat/sprint6-chunk-C-scan-history

## Scope

Add a `/scan/history` cockpit page that shows Colin's last 100 scan results in a filterable table — ISBN, title, profit, ROI, decision (BUY/SKIP), cost paid, and date — so he can review what he scanned today and see patterns.

**Acceptance criterion:** Navigating to `/scan/history` shows a table of recent scans from the `scan_results` table, filterable by decision (all/buy/skip). Each row shows: date, ISBN, title (truncated to 40 chars), buy box price, profit, ROI, decision badge.

## Out of scope

- Editing scan results
- Deleting scan results
- Scan analytics/charts (future sprint)
- Pagination beyond 100 rows

## Files expected to change

- NEW: `app/api/scan/history/route.ts`
- NEW: `app/(cockpit)/scan/history/page.tsx`
- NEW: `app/(cockpit)/scan/history/_components/ScanHistoryClient.tsx`

## Check-Before-Build findings

- `scan_results` table exists with columns: `id, isbn, asin, title, author, buy_box_price_cad, fba_fees_cad, profit_cad, roi_pct, decision, cost_paid_cad, bsr, tier, listed_at` (check actual column names with `SELECT column_name FROM information_schema.columns WHERE table_name = 'scan_results'` before writing SQL).
- `person_handle = 'colin'` is the user filter (SPRINT5-GATE: replace with auth).
- No existing `/scan/history` route — create fresh.
- Pattern for cockpit pages with client component: see `app/(cockpit)/scan/page.tsx` + `_components/ScannerClient.tsx`.

## API route spec: GET /api/scan/history

```typescript
// Query params:
// ?limit=100 (default 100, max 100)
// ?decision=buy|skip|all (default all)

// SQL:
SELECT id, isbn, asin, title, buy_box_price_cad, profit_cad, roi_pct, 
       decision, cost_paid_cad, bsr, tier, listed_at
FROM scan_results
WHERE person_handle = 'colin'
  AND (decision = $decision OR $decision = 'all')
ORDER BY listed_at DESC
LIMIT $limit

// Response: array of scan rows
```

Auth: require supabase session (same pattern as other API routes). Return 401 if no user.

## Page spec: app/(cockpit)/scan/history/page.tsx

```typescript
export const metadata = { title: 'Scan History' }
export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <ScanHistoryClient />
    </Suspense>
  )
}
```

## ScanHistoryClient spec

State:
```typescript
const [rows, setRows] = useState<ScanRow[]>([])
const [filter, setFilter] = useState<'all' | 'buy' | 'skip'>('all')
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)
```

On mount and on filter change: `GET /api/scan/history?decision={filter}&limit=100`

**Table columns (in order):**
1. Date — `listed_at` formatted as "May 10 · 3:42 PM" (local time)
2. ISBN — monospace, full value
3. Title — max 40 chars, truncated with "…" if longer
4. Buy Box — `$XX.XX` (buy_box_price_cad)
5. Profit — `$XX.XX` colored green if ≥ 3, red if < 3
6. ROI — `XX.X%` colored green if ≥ 50, red if < 50
7. Decision — "BUY" badge (green) or "SKIP" badge (muted)

**Filter row** above the table:
Three buttons: All / BUY / SKIP — highlights the active filter. Clicking reloads with new filter.

**Empty state:** "No scans yet — go scan some books!" with a link to /scan.

**Header row:**
```
Scan History    [All] [BUY] [SKIP]
Last N scans
```

Style: match ScannerClient.tsx patterns — `var(--color-*)`, `var(--font-*)`, `var(--text-*)`, `var(--radius-*)`. No inline `style={}` except for token references. No ad-hoc CSS files.

**Cockpit navigation:** No change needed — user can navigate via URL. Do NOT modify layout.tsx or nav components (out of scope).

## Tests

Write `tests/scan-history-api.test.ts`:
- GET with no auth returns 401
- GET with valid session returns array (mock Supabase)
- GET with `decision=buy` filters correctly (check SQL params passed to Supabase client)

## Grounding checkpoint

1. Navigate to `https://lepios-one.vercel.app/scan/history` — page loads without error.
2. Table shows scans (if any exist in `scan_results`). If table is empty, "No scans yet" message appears.
3. Click "BUY" filter — table reloads with only BUY decisions.
4. Each row's profit and ROI values match what `/scan` showed when the book was scanned.

## Kill signals

- `scan_results` column names differ from what the SQL uses → check `information_schema.columns`, fix SQL.
- Page 404 after deploy → check Next.js route file path matches `app/(cockpit)/scan/history/page.tsx`.
