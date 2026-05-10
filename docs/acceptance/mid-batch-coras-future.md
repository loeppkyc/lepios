# Cora's Future — Programs, Scholarships & Planning Hub

**Status:** approved
**Owner branch:** `feat/mid-batch-family`
**Migration slot:** `0182_cora_future.sql`

---

## 1 — Why this exists

Colin tracks educational programs and scholarships for Cora (First Nations status, Edmonton,
currently ~Grade 6). Deadlines are years away but require awareness now. The Streamlit version
stores everything in Google Sheets — LepiOS version gets a proper Supabase table, typed schema,
and deadline countdown.

---

## 2 — Scope

### 2.1 Route

`/coras-future` — full CRUD page.

### 2.2 Schema — migration 0182

```sql
CREATE TABLE cora_future_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category    TEXT NOT NULL CHECK (category IN ('program','scholarship','note')),
  name        TEXT NOT NULL,
  provider    TEXT,
  eligibility TEXT,
  value       TEXT,
  timeline    TEXT CHECK (timeline IN ('Grade 11','Grade 12','Post-secondary',NULL)),
  dates       TEXT,
  url         TEXT,
  status      TEXT NOT NULL DEFAULT 'upcoming'
              CHECK (status IN ('upcoming','open','applied','accepted','missed','rejected')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

GRANT INSERT, UPDATE, DELETE ON cora_future_items TO service_role;
```

Seed with the 4 rows from Streamlit `SEED_DATA` (WISEST, HYRS, RBC Future Launch,
Aboriginal Futures).

### 2.3 API

`/api/coras-future`
- `GET` — list all items, ordered by: `status = 'upcoming'` first, then by `timeline` asc
- `POST` — insert new item, return created row
- `PATCH ?id=` — update `status` + `updated_at` only
- `DELETE ?id=` — delete a row

### 2.4 Page layout

**Header:** page title + subtitle from Streamlit.

**Tabs (4):**
1. **Programs & Scholarships** — grouped by timeline (Grade 11 / Grade 12 / Post-secondary).
   Each item is an expandable card showing: eligibility, value, dates, URL button, status badge,
   and inline status-update select + save button.
   Below list: "Add program" form (same fields as Streamlit).

2. **Deadlines** — items that have a non-empty `dates` field, sorted by `timeline` then name.
   Quick Reference static markdown block (same as Streamlit).

3. **Notes** — items with `category = 'note'`. Add note form below list.

4. **Cora's World** — static info block from Streamlit (3 project cards: Godot 3D Game,
   React Web App, Streamlit App). Remove the file-system `souls_dir` lookup (can't run on
   server). Keep the Health & Wellness bullet list.

### 2.5 20% improvement over Streamlit

**Deadline countdown**: next to each item's dates text, compute days until the target date
(if parseable) and show:
- `> 365 days` → green badge
- `90–365 days` → amber badge  
- `< 90 days` → red badge
- `past` → muted "missed window" label

Parse heuristic: if `dates` contains a 4-digit year, try to extract a March/April target date.
Show countdown only when parse succeeds; silently skip otherwise.

### 2.6 Design

- shadcn `Tabs`, `Card`, `Badge`, `Button`, `Select`, `Input`, `Textarea`
- Status badge colours: upcoming→blue, open→green, applied→violet, accepted→yellow,
  missed→red, rejected→orange
- No `style={}` inline attributes

---

## 3 — Acceptance criteria

- [ ] `/coras-future` returns 200
- [ ] All 4 tabs render
- [ ] 4 seed rows visible in Programs tab on first load
- [ ] Add program form inserts row, re-fetches list
- [ ] Status update PATCH reflects immediately
- [ ] At least one item shows a countdown badge (WISEST dates contain "March")
- [ ] Migration 0182 applied and verified via `list_migrations`
- [ ] `GRANT INSERT, UPDATE, DELETE ON cora_future_items TO service_role` present
- [ ] No `style=` in new TSX files
- [ ] TypeScript: `tsc --noEmit` clean

---

## 4 — Out of scope

- File-system NPC soul file listing
- Recurring reminders / cron alerts
- Edit existing item (add + delete + status-update is sufficient for v1)
