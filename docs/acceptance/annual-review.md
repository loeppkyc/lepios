# Annual Review — Year-over-Year Wealth + Life Milestones

**Status:** approved (Colin 2026-05-06: "build now")
**Owner branch:** `feat/annual-review`
**Migration slot:** `0135_life_milestones.sql`

---

## 1 — Why this exists

P&L net profit doesn't answer Colin's actual question. He measures life by:

> "I started the year with $X. If I liquidated everything today, would I have more or less? And what changed in life that the dollar number doesn't capture?"

Pure financial systems penalize him for "low net profit" years where he was actually winning massively (paid off $55k of car debt, moved to nicer apartment, etc.). The Annual Review page surfaces both the dollar trajectory and the quality-of-life context.

Encoded long-term in [`memory/colin_wealth_framework.md`](../../../../C:/Users/Colin/.claude/projects/c--Users-Colin-Downloads-Claude-Code-Workspace-TEMPLATE--1--lepios/memory/colin_wealth_framework.md).

---

## 2 — Scope

### 2.1 Year-over-year liquidation table

For each calendar year with data:

- Jan 1 liquid value (from `net_worth_snapshots` closest preceding)
- Dec 31 liquid value (or current if YTD)
- Δ (delta)
- Δ % change
- Number of life milestones logged that year

Liquid value = same calculation as `/api/net-worth` but sourced from a snapshot at a point in time (so historical values work). For 2026 YTD: use today's live computed value.

### 2.2 Life milestones timeline

Chronological list of major QoL events. Each has:

- date (required)
- category (one of: housing, vehicle, debt, family, business, health, other)
- title (short)
- description (long, optional)
- money_impact (optional numeric — positive = wealth gain, negative = wealth loss)

Examples to seed:

- 2024-12 Paid off Corolla loan ($15k debt eliminated)
- 2025-10 Started buying book pallets (Polar HQ)
- 2026-05-06 Tesla loan paid off ($40k debt eliminated)
- 2026-05-06 BDC loan: $100k → $11k ($89k debt eliminated)
- 2026-05-06 GST/Income tax fully cleared for 2025

### 2.3 Above-the-fold headline

A single sentence at the top of the page that tells the truth in plain English. Computed live:

```
2026 YTD: liquid value flat (~$20k start → ~$15k today)
+ eliminated $89k of debt + paid all 2025 taxes + paid off Tesla.
You're winning.
```

The "winning" verdict is generated when net wealth (assets − liabilities, NOT just cash) increased even when cash decreased. Else "tightening" or "expanding" depending on direction.

---

## 3 — Data model

### 3.1 New table: `life_milestones`

```sql
CREATE TABLE life_milestones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_date date NOT NULL,
  category      text NOT NULL CHECK (category IN ('housing','vehicle','debt','family','business','health','other')),
  title         text NOT NULL,
  description   text,
  money_impact  numeric(14,2),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX life_milestones_date_idx ON life_milestones (milestone_date DESC);
```

RLS enabled, authenticated-only (same pattern as net_worth_snapshots / inventory_snapshots).

### 3.2 Reused tables (read-only)

- `net_worth_snapshots` — for historical liquid values
- `balance_sheet_entries` — for live current value when YTD year is requested

---

## 4 — API surface

### 4.1 `GET /api/annual-review`

Aggregates years with data + milestones.

```ts
interface YearRow {
  year: number
  jan1Liquid: number | null // from net_worth_snapshots, closest preceding 2026-01-01
  yearEndLiquid: number | null // for past years, Dec 31 snapshot. For current year: live computation.
  isYtd: boolean // true for current year (not yet Dec 31)
  delta: number | null // yearEndLiquid - jan1Liquid
  deltaPct: number | null
  milestoneCount: number
  verdict: 'winning' | 'flat' | 'tightening' | null
}

interface AnnualReviewResponse {
  years: YearRow[]
  milestones: LifeMilestone[] // all, ordered by date DESC
  currentLive: {
    // today's snapshot for current-year row
    totalAssets: number
    totalLiabilities: number
    netWorth: number
  }
}
```

### 4.2 `/api/life-milestones` (GET / POST / PATCH / DELETE)

Standard CRUD pattern matching `/api/inventory-snapshots`.

---

## 5 — UI

### 5.1 New page: `/annual-review`

- Sidebar link: under Dashboard, after Net Worth
- Headline banner at top (computed verdict + plain-English summary)
- Year table (sortable, defaults newest first)
- Milestones timeline (vertical list, color-coded by category, can add/edit/delete inline)

### 5.2 Cross-links

- `/net-worth` header gets a "View Annual Review" link
- `/life-pnl` header existing "Where do I sit?" gets a sibling "→ Annual Review"

### 5.3 Add Milestone form

Inline at top of milestones section: date picker, category dropdown, title input, description textarea, money_impact number (optional), Add button.

---

## 6 — Seeding (in migration)

Seed Colin's known milestones from this session's conversation:

| Date       | Category | Title                                           | Money Impact |
| ---------- | -------- | ----------------------------------------------- | ------------ |
| 2024-12-31 | debt     | Corolla loan paid off                           | +15000       |
| 2025-10-15 | business | Started book pallet sourcing (Polar HQ)         | NULL         |
| 2026-04-13 | debt     | Tesla loan paid off                             | +40000       |
| 2026-04-30 | debt     | BDC loan paid down ($100k → $11k)               | +89000       |
| 2026-05-06 | debt     | GST/income tax 2025 fully cleared               | NULL         |
| 2026-05-06 | family   | 2 paid-off cars (Tesla + ?) — household upgrade | NULL         |

Approximate dates (Colin will edit). Money_impact = debt eliminated treated as wealth-positive event.

---

## 7 — Tests

| ID    | Test                                                                     | File                              |
| ----- | ------------------------------------------------------------------------ | --------------------------------- |
| AR-T1 | GET /api/annual-review 401 unauthenticated                               | tests/api/annual-review.test.ts   |
| AR-T2 | YearRow.delta = yearEndLiquid − jan1Liquid                               | same                              |
| AR-T3 | Current year flagged isYtd=true; uses live computed currentLive.netWorth | same                              |
| AR-T4 | verdict='winning' when wealth grew despite cash drop (debt eliminated)   | same                              |
| AR-T5 | verdict='tightening' when both wealth and cash dropped                   | same                              |
| LM-T1 | POST /api/life-milestones rejects invalid category                       | tests/api/life-milestones.test.ts |
| LM-T2 | POST inserts and returns row                                             | same                              |
| LM-T3 | PATCH updates description / money_impact                                 | same                              |
| LM-T4 | DELETE removes row                                                       | same                              |
| LM-T5 | GET orders by milestone_date DESC                                        | same                              |

All vitest, mocked supabase client.

---

## 8 — Out of scope

- Auto-detection of milestones from balance sheet changes (deferred — too noisy)
- Photo attachments on milestones (deferred)
- Pre-2025 history (Colin will manually backfill snapshots if desired)
- Goal-setting layer (e.g., "I want to cross $100k net worth by 2027") — separate Goals & Habits page exists in nav

---

## 9 — Definition of done

- [ ] Migration 0135 applied to prod with 6 seeded milestones
- [ ] /annual-review renders with at least 2026 year row + 6 milestones visible
- [ ] Headline shows "winning" verdict given debt eliminated
- [ ] Add Milestone form works (inline)
- [ ] Sidebar link works
- [ ] Cross-link from /net-worth + /life-pnl works
- [ ] All tests pass; full suite green
- [ ] PR opened, CI green, merged, deploy-verified
