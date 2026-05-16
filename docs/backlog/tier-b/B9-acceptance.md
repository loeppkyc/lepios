# B9 — Hardware Component Tracker: `/systems/hardware`

**Task ID:** `7ca3e75f-e84e-4495-83ff-6a7426584668`
**Item ID:** B9 | **Tier:** B | **Sprint:** Backlog
**Date:** 2026-05-16
**Coordinator invocation:** `cab2fe76-8c1f-40ed-8775-4882e3a7d44a`

---

## Scope

Create a `hardware_components` table and a `/systems/hardware` cockpit page that lets Colin track every component in his PC build — category, acquisition status, planned budget vs actual spend, and a product URL.

**Acceptance criterion:** A component can be added, edited, and deleted at `/systems/hardware`. Each row displays category, status badge, budget vs actual (in CAD), and a product URL link. The page is reachable from the System section in the sidebar.

---

## Out of scope

- Integration with any price-tracking API (Keepa, Amazon) — v2
- Automatic currency conversion — CAD only in v1
- Multi-user hardware budgets — SPRINT5-GATE
- Total build cost vs budget gauge on the `/systems` overview page — v2
- Purchase receipt attachment — v2

---

## Check-Before-Build findings

| Check | Finding |
|---|---|
| `hardware_components` table | Does not exist — create fresh |
| `/systems/hardware` route | Does not exist — `app/(cockpit)/systems/hardware/` to be created |
| `/api/systems/hardware` | Does not exist — create route for mutations |
| `harness_components` table | Exists but is for harness tracking — unrelated |
| `product_components` table | Exists — unrelated (reselling module) |
| CockpitSidebar.tsx System section | Has items array — `Hardware` nav link to be appended |
| Similar pattern reference | `app/(cockpit)/hit-lists/` — table view with client component |

No existing prior art to extend. Greenfield build.

---

## Files expected to change

**New files:**
- `supabase/migrations/0219_hardware_components.sql`
- `app/(cockpit)/systems/hardware/page.tsx`
- `app/(cockpit)/systems/hardware/_components/HardwareShell.tsx`
- `app/api/systems/hardware/route.ts`
- `tests/api/systems/hardware.test.ts`

**Modified files:**
- `app/(cockpit)/_components/CockpitSidebar.tsx` — add `{ label: 'Hardware', href: '/systems/hardware' }` to System items array

---

## Schema: `hardware_components`

```sql
CREATE TABLE hardware_components (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN (
                'cpu','gpu','ram','storage','motherboard',
                'case','cooling','psu','monitor','peripheral','other'
              )),
  status      TEXT NOT NULL DEFAULT 'wishlist' CHECK (status IN (
                'wishlist','ordered','owned','installed'
              )),
  budget_cad  NUMERIC(10,2),
  actual_cad  NUMERIC(10,2),
  product_url TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT INSERT, UPDATE, DELETE ON hardware_components TO service_role;
```

**Principle 4 compliance:** Only four status values with live write paths (wishlist → ordered → owned → installed). No future-speculative values.

**F24 compliance:** `GRANT INSERT, UPDATE, DELETE ON hardware_components TO service_role` included.

---

## API: `GET /api/systems/hardware` and mutations

- `GET` — returns all rows ordered by `category ASC, name ASC`
- `POST` — insert new row, returns created row
- `PATCH ?id=<uuid>` — update row by ID
- `DELETE ?id=<uuid>` — delete row by ID

Auth: `requireUser({ minRole: 'business' })` on all verbs.

---

## Page: `/systems/hardware`

**Layout:** Two-panel.

Top: summary strip — total `budget_cad` sum, total `actual_cad` sum, variance (actual − budget), count by status.

Body: sortable table with columns:
- Component name
- Category (text, no badge needed)
- Status (badge: wishlist=muted, ordered=amber, owned=blue, installed=green)
- Budget CAD (monospace)
- Actual CAD (monospace, em-dash if null)
- Variance (actual − budget, red if over, green if under, blank if no actual)
- Product URL (external link icon, opens in new tab)
- Actions (edit / delete)

Footer row: **Totals** — budget sum, actual sum, variance sum.

Add/Edit form: inline below the table header row (collapsed by default, expanded on "Add component" click) or a slide-over panel — builder's choice, must use shadcn/ui `Sheet` or inline form, no custom modals.

**F20 compliance:** shadcn/ui components only. No `style={}` attributes. Tailwind utility classes only.

---

## Design decisions (coordinator-cached, reversible)

| Decision | Value | Reversibility |
|---|---|---|
| Currency | CAD only | `ALTER TABLE hardware_components ADD COLUMN currency TEXT DEFAULT 'CAD'` if multi-currency needed |
| Categories enum | 11 values (cpu…other) | `ALTER TABLE ADD CHECK` can expand — non-destructive |
| Status enum | 4 values | `ALTER TABLE ADD CHECK` can expand |
| Budget per-component | Not a total-budget field | Total derivable by SUM — no schema change needed |
| Mutations via API route | Not Server Actions | Reversible (pattern consistent with existing `/api/systems/metrics`) |

---

## F17 — Behavioral ingestion justification

Hardware purchase tracking is a **Money pillar** signal:
- `actual_cad` captures real spend for Colin's PC build budget
- `status` changes (wishlist → ordered → owned) track purchase decisions
- Budget variance surfaces in `agent_events` on each insert/update (builder to log `action='hardware_component_added'` with `meta.variance_cad`)

---

## F18 — Measurement + benchmark

| Metric | Source | Benchmark |
|---|---|---|
| Total build budget | `SUM(budget_cad)` | Colin's stated target (open question — flag in page) |
| Total actual spend | `SUM(actual_cad)` | Same target |
| Budget variance | `SUM(actual_cad) - SUM(budget_cad)` | 0 (on-budget) |
| Component count by status | `GROUP BY status` | All components reach `installed` before GPU Day |

Surface path: morning digest hardware line once `actual_cad` total > 0.

---

## Grounding checkpoint

Colin verifies in browser at `/systems/hardware`:
1. Add one component (e.g., CPU — AMD Ryzen 9 9950X — $700 budget — ordered)
2. Confirm row appears with correct status badge color (amber for ordered)
3. Edit actual_cad to $689 — confirm variance shows −$11 in green
4. Delete the row — confirm row disappears

No DB query needed — UI verification is sufficient for CRUD completeness.

---

## Open questions (twin unreachable — escalate to Colin)

1. **Category list** — the acceptance doc proposes 11 categories. Are any missing or wrong for Colin's actual build? (e.g., is `nvme` better than `storage`? Should `gpu` be `video-card`?)
2. **Budget totals** — does Colin have a total build budget in mind that should appear as a target on the page? If so, what is it (or should it be a configurable `harness_config` key)?
3. **Status labels** — `wishlist / ordered / owned / installed` assumes a linear purchase flow. Does this match Colin's mental model?

These questions do not block the schema or page design. The coordinator has made sensible defaults; Colin can redirect any of the three at approval time.

---

## Kill signals

- Colin rejects the category enum as entirely wrong → redesign acceptance doc
- Colin wants price-watch API integration in v1 → re-scope as Chunk B (separate acceptance doc)
- Colin wants this under a different URL pattern → rename (free)

---

## Cached-principle decisions

| Principle | Applied decision |
|---|---|
| P3 (FK over copy) | No FK needed — standalone table |
| P4 (enum hygiene) | 4 status values with live write paths only |
| P6 (honest labels) | `budget_cad` / `actual_cad` — not "cost" (which implies settled) |
| F24 (migration grants) | GRANT block included |
| F20 (design system) | shadcn/ui components only, Tailwind utility classes |

---

## META-C cache-match log

```
2026-05-16 coordinator sprint=backlog chunk=B9 doc=docs/backlog/tier-b/B9-acceptance.md
cited_principles: [3, 4, 6, F20, F24, META-C]
trigger_match_evidence: |
  P4 trigger: "Proposed enum with 'maybe useful later' values"
  → status enum ships 4 values (wishlist/ordered/owned/installed), all with live write paths; no speculative additions.
  P6 trigger: "Labels or UI text that could imply data we don't have"
  → budget_cad (planned) vs actual_cad (paid) — labels match data semantics exactly.
  F24 trigger: "Every CREATE TABLE migration must include GRANT INSERT, UPDATE, DELETE ON <table> TO service_role"
  → GRANT block included in schema block above.
reversibility_check: |
  schema: CREATE TABLE — reversible via DROP TABLE (destructive, but table is new and empty)
  category enum CHECK: ALTER TABLE MODIFY CHECK — reversible
  status enum CHECK: ALTER TABLE MODIFY CHECK — reversible
  nav link: remove one item from array — reversible with grep
  API route: delete file — reversible
  All decisions are reversible or low-cost.
confidence: high
```

Path C evaluation: **Not applicable** — twin endpoint unreachable (all questions → pending_colin_qs). Falling through to META-C (above). META-C confidence = high → doc is approved-by-cache pending Colin's Telegram approval for the three open questions.

**Since twin was unreachable for all questions:** sending Telegram approval button with open questions flagged. Colin can approve (accept defaults) or reject (with redirect reason).
