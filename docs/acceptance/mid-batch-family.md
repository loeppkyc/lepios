# Family Dashboard — Megan, Cora & Colin

**Status:** approved
**Owner branch:** `feat/mid-batch-family`
**Migration slot:** `0181_family.sql`

---

## 1 — Why this exists

Central view for the family's operational picture: Megan's cleaning business revenue estimate,
Cora's activity schedule and monthly cost, important family dates, and a simple household
budget surplus/deficit calculator. The Streamlit version stores everything in Google Sheets.

---

## 2 — Scope

### 2.1 Route

`/family` — full CRUD page, 4 sections.

### 2.2 Schema — migration 0181

```sql
CREATE TABLE cleaning_clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  address     TEXT,
  frequency   TEXT NOT NULL CHECK (frequency IN ('Weekly','Biweekly','Monthly','One-time')),
  rate        NUMERIC(10,2) NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive','Paused')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cora_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  day_of_week  TEXT CHECK (day_of_week IN
                 ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  time_of_day  TEXT,
  monthly_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE family_important_dates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event      TEXT NOT NULL,
  date       DATE NOT NULL,
  recurring  BOOLEAN NOT NULL DEFAULT false,
  notes      TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

GRANT INSERT, UPDATE, DELETE ON cleaning_clients TO service_role;
GRANT INSERT, UPDATE, DELETE ON cora_activities TO service_role;
GRANT INSERT, UPDATE, DELETE ON family_important_dates TO service_role;
```

### 2.3 API

Single route: `/api/family`

All resources in one handler for simplicity:
- `GET` — returns `{ clients, activities, dates }`
- `POST` body `{ resource: 'client'|'activity'|'date', data: {...} }` — insert, return created row
- `DELETE ?resource=&id=` — delete a row

### 2.4 Page layout

**Section 1: Family Overview**
Three portrait cards (Colin / Megan / Cora) — static, same as Streamlit.

**Section 2: Megan's Cleaning Business**
- `st.metric` equivalent → shadcn stat card: "Est. Monthly Income $X"
- Frequency multipliers (same as Streamlit): Weekly×4.33, Biweekly×2.17, Monthly×1.0, One-time×0.0
- Active clients only in the income calculation (`status = 'Active'`)
- Table of all clients (shadcn `Table`)
- "Add Client" form in a collapsible (shadcn `Collapsible` or `Accordion`)

**Section 3: Cora's Corner**
- Stat card: "Monthly Activity Cost $X" (active activities only)
- Table of all activities
- "Add Activity" form in collapsible

**Section 4: Family Budget Summary**
Four stat cards in a row:
1. "Colin's Monthly Income" — editable number input (client-side, not persisted)
2. "Megan's Est. Income" — computed from cleaning_clients
3. "Household Expenses" — hardcoded $5,000 in Streamlit; **20% improvement**: read from
   `recurring_expenses` table WHERE `category = 'housing'` + `category = 'utilities'`, SUM.
   Fall back to $5,000 if no data. Add a "(from recurring)" or "(hardcoded)" label so Colin
   can see which source is active.
4. "Monthly Surplus/Deficit" — Colin income + Megan income − household − Cora activities.
   Green if ≥ 0, red if < 0.

**Section 5: Important Dates**
- Table of all dates sorted by `date ASC`
- "Add Date" form in collapsible

### 2.5 Design

- shadcn `Card`, `Table`, `Collapsible`, `Input`, `Select`, `Button`, `Badge`
- Surplus/deficit stat: colour the delta via Tailwind `text-green-400` / `text-red-400`
- No `style={}` inline attributes

---

## 3 — Acceptance criteria

- [ ] `/family` returns 200
- [ ] All 5 sections render
- [ ] Add client inserts row, monthly income recalculates
- [ ] Add activity inserts row, monthly activity cost recalculates
- [ ] Add date inserts row, appears in table sorted by date
- [ ] Household expenses reads from `recurring_expenses` if rows exist; shows source label
- [ ] Surplus/deficit changes colour based on sign
- [ ] Migration 0181 applied: `cleaning_clients`, `cora_activities`, `family_important_dates` all present
- [ ] All 3 tables have `GRANT INSERT, UPDATE, DELETE … TO service_role`
- [ ] No `style=` in new TSX files
- [ ] TypeScript: `tsc --noEmit` clean

---

## 4 — Out of scope

- Delete client/activity/date (add-only is sufficient for v1)
- Edit existing rows
- Megan's cleaning app integration (separate product)
- Life P&L callouts (deferred; depends on life_pl integration)
