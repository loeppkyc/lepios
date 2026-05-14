# Acceptance Doc — T-005 Net Worth: manual_assets + cron snapshot

**Status:** approved (delegated, autonomous execution)
**Task ID:** ca9f3e22-1ca9-4b4e-9555-1e948b1beedc
**Branch:** harness/task-ca9f3e22-net-worth
**Migration:** 0205

---

## Phase 1 Study — What Already Exists

The net-worth module is partially shipped (T-005 current% = 20). Before writing any code the builder MUST understand the existing state:

| File                                                   | Status      | Notes                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/0133_net_worth_snapshots.sql`     | **shipped** | Adapts pre-existing table: adds `breakdown jsonb`, enables RLS, drops UNIQUE on `snapshot_date`. Columns: `id, snapshot_date, total_assets, total_liabilities, net_worth, breakdown, notes, created_at, person_handle`. |
| `app/api/net-worth/route.ts`                           | **shipped** | `GET /api/net-worth` — live computation from `balance_sheet_entries`. Returns full `NetWorthResponse` shape.                                                                                                            |
| `app/api/net-worth/history/route.ts`                   | **shipped** | `GET /api/net-worth/history?limit=N` — returns last N snapshots.                                                                                                                                                        |
| `app/api/net-worth/snapshot/route.ts`                  | **partial** | `POST /api/net-worth/snapshot` — user-auth, NOT idempotent. Missing: cron-secret `GET` handler for daily idempotency.                                                                                                   |
| `app/(cockpit)/net-worth/page.tsx`                     | **shipped** | Thin wrapper → `NetWorthPage`.                                                                                                                                                                                          |
| `app/(cockpit)/net-worth/_components/NetWorthPage.tsx` | **partial** | Full chart + KPI + breakdown table. Missing: `manual_assets` CRUD section. Uses inline styles (pre-existing F20 debt — builder adds only Tailwind-based new sections).                                                  |
| `manual_assets` table                                  | **missing** | Not in any migration. This is the primary schema gap.                                                                                                                                                                   |

---

## What This Task Builds (Delta Only)

1. **Migration 0205** — `manual_assets` table + seed data
2. **Cron snapshot GET handler** — add `GET` to `app/api/net-worth/snapshot/route.ts` (cron-secret, idempotent on today's date)
3. **ManualAssetsSection component** — new `_components/ManualAssetsSection.tsx` using Tailwind (F20-clean), wired into NetWorthPage
4. **Tests** — add GET snapshot idempotency tests to `tests/api/net-worth.test.ts`

---

## Schema

### `manual_assets` (new table — migration 0205)

```sql
CREATE TABLE public.manual_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  asset_class text NOT NULL CHECK (asset_class IN (
    'vehicle', 'real_estate', 'cash', 'investment', 'other'
  )),
  value_cad   numeric(14,2) NOT NULL DEFAULT 0,
  notes       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
```

RLS: enabled, authenticated SELECT + service_role INSERT/UPDATE/DELETE.

GRANT INSERT, UPDATE, DELETE ON manual_assets TO service_role; (F24)

**Seed rows (in migration, ON CONFLICT DO NOTHING on label):**

| label                | asset_class | value_cad |
| -------------------- | ----------- | --------- |
| Vehicle #1 (primary) | vehicle     | 20000     |
| Vehicle #2           | vehicle     | 15000     |
| Real Estate Equity   | real_estate | 0         |

---

## Route — GET /api/net-worth/snapshot

Add a `GET` export to the existing `app/api/net-worth/snapshot/route.ts`.

**Auth:** `requireCronSecret(request)` (F22). Fail-closed.

**Idempotency:** Check whether a snapshot already exists for today (UTC date). If yes, return it (200). If no, compute totals from `balance_sheet_entries` (same math as POST) and insert a new row.

**No body required.** Returns `{ snapshot, created: boolean }`.

The existing `POST` handler is not changed — it stays as the user-triggered manual snapshot from the UI.

---

## Page — app/(cockpit)/net-worth/page.tsx

The page shell and NetWorthPage already exist. The builder adds:

1. A `ManualAssetsSection` component in `_components/ManualAssetsSection.tsx`
2. An API route `app/api/net-worth/manual-assets/route.ts` with:
   - `GET` (user auth) — list all manual_assets rows
   - `PATCH` (user auth) — update a single row's `value_cad` and `notes`
3. Wire the section into `NetWorthPage.tsx` below the trend chart

`ManualAssetsSection` renders:

- Header: "Manual Assets"
- Editable table: label | asset_class | value_cad (editable inline) | updated_at | Edit/Save buttons
- Edit flow: click Edit → inline number input → Save → PATCH → reload
- Uses Tailwind utility classes only (no inline `style={}` — F20 clean)

The existing NetWorthPage inline styles are NOT refactored in this task — they are pre-existing debt. Only new code added by this task must comply with F20.

---

## Acceptance Criteria

- [ ] `manual_assets` table created, service_role grants applied (F24)
- [ ] Seed rows present: Vehicle #1 ($20k), Vehicle #2 ($15k), Real Estate Equity ($0)
- [ ] `GET /api/net-worth/snapshot` returns 200 with valid snapshot when called with Bearer CRON_SECRET
- [ ] Second call same day returns same snapshot row (idempotent — same `id`)
- [ ] `/net-worth` page loads (no 5xx in browser console)
- [ ] Manual Assets section visible below trend chart
- [ ] Editing a vehicle value → Save → value persists on reload
- [ ] `tests/api/net-worth.test.ts` passes including new idempotency tests
- [ ] No `style=` attributes in any new `.tsx` files (F20)

---

## F-Rule Compliance

| Rule | How                                                                                     |
| ---- | --------------------------------------------------------------------------------------- |
| F22  | GET /api/net-worth/snapshot calls `requireCronSecret(request)`                          |
| F24  | Migration 0205 includes `GRANT INSERT, UPDATE, DELETE ON manual_assets TO service_role` |
| F20  | ManualAssetsSection and manual-assets route use Tailwind classes only                   |

---

## Migration Claim

- 0204 is in use on `harness/task-582c5d5f-ai-dispatcher` (not yet merged to main)
- 0205 claimed by this task on `harness/task-ca9f3e22-net-worth`

---

## GitHub Prior Art (Check-Before-Build §8.4)

- `balance_sheet_entries` + `net_worth_snapshots` are LepiOS-native — no open-source equivalent needed
- Manual asset CRUD: pattern matches existing `EditableRow` in NetWorthPage.tsx — reference, don't duplicate the component
- No external library needed
