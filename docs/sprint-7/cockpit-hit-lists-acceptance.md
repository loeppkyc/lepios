# Acceptance Doc — cockpit-hit-lists-ui

**Status:** awaiting_builder_assignment
**Task ID:** 5be30d29-48a2-4a8a-a7e3-92ff8bd3fa7b
**Branch:** harness/task-5be30d29-cockpit-hit-lists-ui
**Written:** 2026-05-14
**Author:** coordinator

---

## Phase 1a — What Exists (Check-Before-Build)

This is **not a Streamlit port** — no Streamlit predecessor for hit lists exists. This is a UI completion task on top of a partially-built LepiOS feature.

### Current state inventory

| Artifact | Status | Notes |
|---|---|---|
| `app/(cockpit)/hit-lists/page.tsx` | exists | Thin auth wrapper → HitListClient |
| `app/(cockpit)/hit-lists/_components/HitListClient.tsx` | **F20 violation** | 483 lines, wall-to-wall `style={}`. Functional but non-compliant |
| `app/api/hit-lists/route.ts` | exists | GET list all, POST create |
| `app/api/hit-lists/[id]/route.ts` | exists | DELETE list |
| `app/api/hit-lists/[id]/items/route.ts` | exists | GET items (incomplete), POST add ISBNs |
| `app/api/hit-lists/[id]/items/[itemId]/route.ts` | exists | DELETE item |
| `lib/hit-lists/schemas.ts` | exists | CreateListSchema, AddItemsSchema |
| `hit_lists` table | exists | id, person_handle, name, created_at |
| `hit_list_items` table | exists | id, hit_list_id, isbn, cost_paid_cad, status, scan_result_id, added_at, scanned_at |
| `scan_results` table | exists | bsr, profit_cad, roi_pct, title, decision, tier, rank_drops_30, monthly_sold, avg_rank_90d, recorded_at |

**Critical gap:** `GET /api/hit-lists/[id]/items` returns only `id, isbn, status, added_at` — does NOT join `scan_results`. Title, profit, BSR, decision are unavailable to the UI.

**F20 gap:** `HitListClient.tsx` has 50+ inline `style={}` attributes. Rule F20 requires zero `style=` in TSX files. Builder must rewrite entirely.

**Missing features (per task description):**
1. Sortable/filterable table — current is flat unsorted list
2. BSR trend sparklines — no scan_results data surfaced to UI

### Live data snapshot (2026-05-14)

```
hit_list_items: 2 total, 1 with scan_result_id, 1 pending
```

---

## Phase 1b — Twin Q&A

Twin endpoint returned empty (unreachable). Applying Colin's documented principles.

**Q1: BSR sparkline — time-series trend or current single value?**
Task says "BSR trend sparklines" → trend = time series. Decision: raw SVG sparkline of last 7 BSR readings per ISBN from `scan_results`. If only 1 data point → show BSR number only. If 0 → show `—`.

**Q2: Flat cross-list table or per-list (select → see items)?**
Current UX is per-list. Simpler, consistent with existing API structure. Decision: keep per-list UX (list tab selector + item table below). Sort/filter operates within the selected list.

---

## Phase 1c — 20% Better

| Category | Improvement |
|---|---|
| **Correctness** | Items API exposes scan_results data (title, profit, BSR) — currently absent from GET response |
| **UX** | Sortable shadcn Table replaces flat div-list; status filter tabs cut scan to find pending items |
| **Observability** | BSR sparkline shows velocity trend at a glance; scanned_at column gives recency signal |
| **F20** | Full Tailwind rewrite — required by rule, removes all 50+ inline styles |
| **Extensibility** | shadcn Table means adding a column is one line, not a custom div row pattern |

---

## What This Task Builds

1. **`app/api/hit-lists/[id]/items/route.ts`** — enhance GET to join scan_results and return BSR history
2. **`app/(cockpit)/hit-lists/_components/HitListClient.tsx`** — full F20-clean rewrite using Tailwind + shadcn/ui Table
3. **No new migration** — all tables exist

---

## File Changes

### 1 — `app/api/hit-lists/[id]/items/route.ts` (modify GET only)

Replace the current `select('id, isbn, status, added_at')` with a three-step enriched query:

```typescript
// Step 1 — fetch items
const { data: items } = await supabase
  .from('hit_list_items')
  .select('id, isbn, cost_paid_cad, status, scan_result_id, added_at, scanned_at')
  .eq('hit_list_id', id)
  .order('added_at', { ascending: true })

// Step 2 — fetch latest scan_result for items that have one
const resultIds = (items ?? [])
  .filter(i => i.scan_result_id)
  .map(i => i.scan_result_id!)

const { data: scanResults } = resultIds.length > 0
  ? await supabase
      .from('scan_results')
      .select('id, title, bsr, profit_cad, roi_pct, decision, tier')
      .in('id', resultIds)
  : { data: [] }

// Step 3 — BSR history per scanned ISBN (last 7 readings each)
const scannedIsbns = [
  ...new Set((items ?? []).filter(i => i.scan_result_id).map(i => i.isbn))
]
const { data: bsrHistory } = scannedIsbns.length > 0
  ? await supabase
      .from('scan_results')
      .select('isbn, bsr, recorded_at')
      .in('isbn', scannedIsbns)
      .not('bsr', 'is', null)
      .order('recorded_at', { ascending: true })
      .limit(7 * scannedIsbns.length)
  : { data: [] }

// Assemble
const resultMap = new Map((scanResults ?? []).map(r => [r.id, r]))
const historyMap = new Map<string, { bsr: number; recorded_at: string }[]>()
for (const h of bsrHistory ?? []) {
  const arr = historyMap.get(h.isbn) ?? []
  arr.push({ bsr: h.bsr!, recorded_at: h.recorded_at })
  historyMap.set(h.isbn, arr)
}

return NextResponse.json(
  (items ?? []).map(item => {
    const sr = item.scan_result_id ? resultMap.get(item.scan_result_id) : null
    return {
      id: item.id,
      isbn: item.isbn,
      cost_paid_cad: item.cost_paid_cad ? Number(item.cost_paid_cad) : null,
      status: item.status as 'pending' | 'scanned' | 'skipped',
      added_at: item.added_at,
      scanned_at: item.scanned_at ?? null,
      title: sr?.title ?? null,
      bsr: sr?.bsr ?? null,
      profit_cad: sr?.profit_cad ? Number(sr.profit_cad) : null,
      roi_pct: sr?.roi_pct ? Number(sr.roi_pct) : null,
      decision: sr?.decision ?? null,
      tier: sr?.tier ?? null,
      bsr_history: historyMap.get(item.isbn) ?? [],
    }
  })
)
```

**POST handler is unchanged.**

### 2 — `app/(cockpit)/hit-lists/_components/HitListClient.tsx` (full rewrite)

Delete every `style={}` attribute. Rewrite using Tailwind utility classes + shadcn/ui components.

**Updated interface to match enriched API:**

```typescript
interface HitListItem {
  id: string
  isbn: string
  cost_paid_cad: number | null
  status: 'pending' | 'scanned' | 'skipped'
  added_at: string
  scanned_at: string | null
  title: string | null
  bsr: number | null
  profit_cad: number | null
  roi_pct: number | null
  decision: string | null
  tier: string | null
  bsr_history: { bsr: number; recorded_at: string }[]
}
```

**Layout structure (Tailwind only):**

```
<div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6">
  <h1>Hit Lists</h1>
  
  {/* Create list form */}
  <form className="flex gap-2 items-end">
    <CockpitInput ... />
    <button className="...">Add</button>
  </form>

  {/* List selector tabs */}
  <div className="flex gap-2 flex-wrap">
    {lists.map(l => (
      <button
        className={cn("px-3 py-1 text-sm rounded-md border transition-colors",
          selectedId === l.id
            ? "bg-[var(--color-accent-gold)] text-[var(--color-base)] border-transparent"
            : "border-[var(--color-border-accent)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        )}
      >
        {l.name}
        <span className="ml-1.5 text-xs opacity-70">{l.item_count}</span>
      </button>
    ))}
  </div>

  {/* Status filter tabs */}
  <div className="flex gap-1">
    {(['all', 'pending', 'scanned', 'skipped'] as const).map(s => (
      <button className={cn("px-3 py-1 text-xs font-semibold uppercase tracking-wide rounded", ...)}>{s}</button>
    ))}
  </div>

  {/* Items table */}
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead onClick={() => toggleSort('isbn')}>ISBN</TableHead>
        <TableHead>Title</TableHead>
        <TableHead onClick={() => toggleSort('bsr')}>BSR</TableHead>
        <TableHead onClick={() => toggleSort('profit_cad')}>Profit</TableHead>
        <TableHead onClick={() => toggleSort('roi_pct')}>ROI</TableHead>
        <TableHead>Decision</TableHead>
        <TableHead onClick={() => toggleSort('status')}>Status</TableHead>
        <TableHead onClick={() => toggleSort('added_at')}>Added</TableHead>
        <TableHead />
      </TableRow>
    </TableHeader>
    <TableBody>
      {filteredSortedItems.map(item => (
        <TableRow key={item.id}>
          <TableCell className="font-mono text-sm">{item.isbn}</TableCell>
          <TableCell className="max-w-[200px] truncate text-sm text-[var(--color-text-muted)]">
            {item.title ?? '—'}
          </TableCell>
          <TableCell>
            {item.bsr_history.length >= 2
              ? <BsrSparkline data={item.bsr_history} />
              : <span className="font-mono text-sm">{item.bsr?.toLocaleString() ?? '—'}</span>
            }
          </TableCell>
          <TableCell className="font-mono text-sm">
            {item.profit_cad !== null ? `$${item.profit_cad.toFixed(2)}` : '—'}
          </TableCell>
          <TableCell className="text-sm">
            {item.roi_pct !== null ? `${item.roi_pct.toFixed(0)}%` : '—'}
          </TableCell>
          <TableCell>
            {item.decision ? <DecisionChip decision={item.decision} /> : <span className="text-[var(--color-text-disabled)]">—</span>}
          </TableCell>
          <TableCell>
            <StatusChip status={item.status} />
          </TableCell>
          <TableCell className="text-xs text-[var(--color-text-disabled)]">
            {fmtDate(item.added_at)}
          </TableCell>
          <TableCell>
            <button onClick={() => handleDeleteItem(item.id)} aria-label={`Remove ${item.isbn}`}
              className="text-[var(--color-text-disabled)] hover:text-[var(--color-critical)] transition-colors">
              ×
            </button>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>

  {/* Add ISBNs panel */}
  ...

  {/* Batch scan panel */}
  ...
</div>
```

**BsrSparkline component** (inline helper, same file):

```typescript
function BsrSparkline({ data }: { data: { bsr: number }[] }) {
  const W = 44, H = 16, PAD = 2
  const bsrs = data.map(d => d.bsr)
  const min = Math.min(...bsrs), max = Math.max(...bsrs)
  const range = max - min || 1
  // Lower BSR = better = higher on chart (invert y-axis)
  const pts = bsrs.map((b, i) => {
    const x = PAD + (i / Math.max(bsrs.length - 1, 1)) * (W - PAD * 2)
    const y = PAD + ((b - min) / range) * (H - PAD * 2)  // higher bsr = higher y (worse)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <polyline points={pts} fill="none" stroke="var(--color-accent-gold)" strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}
```

> Pattern matches `QualityTrends.tsx Sparkline` — raw SVG per CLAUDE.md §8 chart conventions.

**DecisionChip / StatusChip:** inline helpers, Tailwind only. No `style={}`.

**Sort state:** `useState<{ col: keyof HitListItem | null; dir: 'asc' | 'desc' }>`. Click column header → toggle.

**Filter state:** `useState<'all' | 'pending' | 'scanned' | 'skipped'>('all')`.

**Preserved behaviors (all must still work):**
- Create list, delete list (window.confirm)
- Add ISBNs (textarea, batch)
- Delete individual item
- Batch scan (existing handleBatchScan logic, restyled with Tailwind)

---

## Acceptance Criteria

- [ ] `GET /api/hit-lists/{id}/items` returns enriched rows: `title`, `bsr`, `profit_cad`, `roi_pct`, `decision`, `tier`, `bsr_history`
- [ ] `/hit-lists` page loads with no 5xx errors
- [ ] Items render in a shadcn/ui Table (not div-based list)
- [ ] Clicking a sortable column header sorts asc → desc → asc
- [ ] Status filter tabs (All / Pending / Scanned / Skipped) correctly filter rows
- [ ] Item with ≥2 BSR readings shows SVG sparkline; item with 0 shows `—` without crashing
- [ ] Create list, add ISBNs, delete item, delete list — all still work
- [ ] `grep -r 'style=' app/\(cockpit\)/hit-lists/ --include="*.tsx"` returns **zero matches** (F20)
- [ ] `tsc --noEmit` passes on all changed files

---

## F-Rule Compliance

| Rule | How |
|---|---|
| F20 | Full rewrite — zero `style=` in HitListClient.tsx; acceptance test greps for it |
| F17 | Hit list + BSR visibility accelerates buy/skip decisions at book sales; directly feeds scanning workflow |
| F18 | Status count visible per list (pending badge); BSR sparkline is the velocity metric |

---

## GitHub Prior Art (Check-Before-Build §8.4)

- `components/ui/table.tsx` — shadcn Table already in repo. Use it.
- BSR sparkline: `QualityTrends.tsx Sparkline` function — reference raw SVG pattern
- Sort/filter: client-side useState — no library needed
- No new dependencies

---

## Risk Flags

| Risk | Severity | Mitigation |
|---|---|---|
| BSR history IN query returns too many rows | LOW | `limit(7 * scannedIsbns.length)` caps it; 50 items = 350 rows max |
| Batch scan logic regression during rewrite | MEDIUM | Keep `handleBatchScan()` logic byte-for-byte identical; only change styling |
| shadcn Table not in components/ui/ | LOW | Grep `components/ui/table.tsx` before writing import; generate if absent |

---

## Out of Scope

- Nightly scan trigger from UI (Telegram already handles this)
- Per-item cost_paid_cad inline editing
- Title lookup for unscanned ISBNs (no scan = no title)
- Telegram bot integration changes
