# Phase 1a Study + v1 Acceptance — Diet / Grocery Module

**Source:** `streamlit_app/pages/83_Grocery_Tracker.py` (1,556 lines).
**Prepared:** 2026-05-07
**Branch:** `feat/diet-port`
**Migration slots:** 0154–0158 (five tables)

---

## 1. What Already Exists in LepiOS

**Nothing.** No `grocery_*`, `meal_*`, `weight_*`, `biomarkers` tables. No `/diet` route, no `lib/diet/`. Confirmed via Grep.

Closest neighbours:

- `/health` (just shipped) — vitals/symptoms/meds/visits/workouts/cycle. Single-person system; this is single-person too (Colin only — no `person_handle` here).
- `oura_daily` — sleep/HRV. Adjacent metric domain but separate.

---

## 2. Streamlit Source Analysis

### 8 Tabs (line 585-588)

| Tab            | Function                                                        | v1 verdict                          |
| -------------- | --------------------------------------------------------------- | ----------------------------------- |
| Receipts       | Photo OCR + manual add + spending summary + category bar chart  | **PORT minus OCR**                  |
| Price Tracker  | Per-item store comparison + Flipp flyer integration             | **DEFER v1.1**                      |
| Product Lookup | Open Food Facts barcode/search + Nutri-Score + NOVA + additives | **DEFER v1.1**                      |
| Meal Log       | Manual log + AI nutrition estimation (Claude Haiku)             | **PORT minus AI**                   |
| Nutrition      | Daily totals + macro chart                                      | **PORT (basic)**                    |
| Weight & Body  | Weight log + TDEE projection + deficit/surplus visual bar       | **PORT log only; defer projection** |
| Biomarkers     | Manual log with reference ranges + status badges                | **PORT**                            |
| Health Flags   | UPC-based deep-dive health analysis                             | **DEFER v1.1** (depends on OFF)     |

### Sheet schemas (lines 113-119)

```
INVENTORY: Item, Category, Qty, Unit, Purchased, Expires, Status, Added
MEAL:      Date, Meal, Description, Calories, Protein (g), Carbs (g), Fat (g), Notes
RECEIPT:   Date, Store, Item, Price, Category, Qty, Unit, Calories, Protein_g, Carbs_g, Fat_g, Notes
WEIGHT:    Date, Weight_lbs, Notes
BIOMARKER: Date, Marker, Value, Unit, Ref_Low, Ref_High, Status, Notes
```

### Domain rules

- **Receipt categories** (line 657): `Produce | Dairy | Meat | Bakery | Frozen | Pantry | Beverage | Snack | Discount | Other`
- **Discount rows** are negative `Price` values — line 754 filters them out for price tracking but includes them in spend totals (`total_saved = abs(df[Price < 0].sum())`).
- **Default weight/TDEE** (line 105-106): 197 lbs, 2800 TDEE (40yo male, ~5'10", moderately active).
- **Inventory Status**: free-text in Streamlit (e.g. "On hand", "Low", "Out", "Expired"). v1: keep as text.
- **Biomarker Status**: derived from value vs Ref_Low/Ref_High (`bio-normal`, `bio-high`, `bio-low` CSS classes).
- **Meal Log columns**: `Calories | Protein (g) | Carbs (g) | Fat (g)` — INTEGER macros.
- **Seed data** (lines 145-182): 33 receipt rows from Costco + Superstore April 7 2026. **Do NOT migrate** to LepiOS — Streamlit keeps running as backup.

### Fragile points

- Photo OCR relies on Anthropic API key in `secrets.toml`. v1 skips entirely — manual entry only.
- Flipp scraper (`utils/flyer_intel.py`) — external dependency, not portable.
- Open Food Facts API — rate-limited, slow, optional in Streamlit. v1 skips.
- TDEE math (line 517-523) — fixed body comp; not personalized. Defer until needed.

---

## 3. v1 Scope (decisions)

| Tab                      | Action         | Rationale                                                                             |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------- |
| Inventory                | **PORT**       | Add + list + expiration filter                                                        |
| Receipts (manual)        | **PORT**       | Manual add + list + spending summary cards (Total/Saved/Net/Avg) + category breakdown |
| Receipt OCR              | **DEFER v1.1** | Claude Vision pipeline = separate complex chunk                                       |
| Meal Log                 | **PORT**       | Manual add + list + daily totals roll-up                                              |
| AI Meal Estimation       | **DEFER v1.1** | Same as OCR — defer until OCR pattern is in place                                     |
| Weight Log               | **PORT**       | Add + line chart trend                                                                |
| Weight Projection / TDEE | **DEFER v1.1** | Math + body comp tuning needed                                                        |
| Biomarkers               | **PORT**       | Add + list + status badges (auto-derive from ref ranges)                              |
| Price Tracker            | **DEFER v1.1** | Per-item compare needs more receipts to be useful                                     |
| Product Lookup (OFF)     | **DEFER v1.1** | External API dependency                                                               |
| Health Flags (UPC)       | **DEFER v1.1** | Depends on OFF                                                                        |
| Export CSV               | **PORT**       | Per-section + combined                                                                |

### Schema (5 migrations)

Common: `id UUID PK`, `created_at`, `updated_at`, `notes TEXT NOT NULL DEFAULT ''`. Single-user system — RLS authenticated full-access (same pattern as `oura_daily` / `vitals`).

| Migration | Table               | Domain columns                                                                                                                                                            |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0154      | `grocery_inventory` | `item TEXT`, `category TEXT`, `qty NUMERIC`, `unit TEXT`, `purchased_on DATE`, `expires_on DATE NULL`, `status TEXT`                                                      |
| 0155      | `grocery_receipts`  | `purchased_on DATE`, `store TEXT`, `item TEXT`, `price NUMERIC`, `category TEXT`, `qty NUMERIC`, `unit TEXT`, `calories INT`, `protein_g INT`, `carbs_g INT`, `fat_g INT` |
| 0156      | `meal_log`          | `meal_date DATE`, `meal TEXT` (Breakfast/Lunch/etc), `description TEXT`, `calories INT`, `protein_g INT`, `carbs_g INT`, `fat_g INT`                                      |
| 0157      | `weight_log`        | `weighed_on DATE UNIQUE`, `weight_lbs NUMERIC`                                                                                                                            |
| 0158      | `biomarkers`        | `recorded_on DATE`, `marker TEXT`, `value NUMERIC`, `unit TEXT`, `ref_low NUMERIC NULL`, `ref_high NUMERIC NULL`, `status TEXT`                                           |

Indexes: date DESC on each. Receipt category index for filter speed. weight_log UNIQUE on `weighed_on`.

---

## 4. 20% Better

1. **Per-domain tables** vs flat sheets — type-safe queries, indexed dates, NUMERIC where it matters.
2. **Auto-derived biomarker status** — INSERT trigger or computed in lib (high if value > ref_high, low if < ref_low, normal otherwise) instead of free-text. Streamlit relied on user typing "high"/"low" manually.
3. **agent_events audit trail** — log every write under `domain='diet'`.
4. **Atomic upsert on weight** — `weighed_on` UNIQUE; second weigh-in same day overwrites cleanly (Streamlit appends duplicates).
5. **Receipt summary computed server-side** — no `pd.DataFrame` reshaping client-side; just SQL aggregates.
6. **Server component fetch** — no `st.cache_data(ttl=300)` cache invalidation dance.

---

## 5. Routes / Files

```
supabase/migrations/0154_grocery_inventory.sql
supabase/migrations/0155_grocery_receipts.sql
supabase/migrations/0156_meal_log.sql
supabase/migrations/0157_weight_log.sql
supabase/migrations/0158_biomarkers.sql

lib/diet/types.ts                       — categories, meal-of-day, biomarker statuses
lib/diet/queries.ts                     — fetch bundle (all 5 domains)
lib/diet/helpers.ts                     — pure shaping (receipts summary, daily nutrition, biomarker derive)

app/(cockpit)/diet/page.tsx             — server component
app/(cockpit)/diet/_components/
  DietShell.tsx                         — tab nav
  DietCommon.tsx                        — shared styles (mirror HealthCommon)
  InventoryTab.tsx
  ReceiptsTab.tsx
  MealLogTab.tsx
  WeightTab.tsx
  BiomarkersTab.tsx
  ExportTab.tsx

app/api/diet/inventory/route.ts         — POST
app/api/diet/inventory/[id]/route.ts    — PATCH (status), DELETE
app/api/diet/receipts/route.ts          — POST
app/api/diet/receipts/[id]/route.ts     — DELETE
app/api/diet/meals/route.ts             — POST
app/api/diet/meals/[id]/route.ts        — DELETE
app/api/diet/weight/route.ts            — POST (upsert by date)
app/api/diet/weight/[id]/route.ts       — DELETE
app/api/diet/biomarkers/route.ts        — POST
app/api/diet/biomarkers/[id]/route.ts   — DELETE

tests/diet/helpers.test.ts
```

---

## 6. Out of v1 Scope

| Item                               | Revisit when                                                            |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Claude Vision receipt OCR          | After Health module v1.1 (workouts gauge ships) — unify the AI pipeline |
| Meal AI nutrition estimation       | Same as above                                                           |
| Open Food Facts product lookup     | Colin scans a barcode in real life and asks for it                      |
| Flipp price tracker                | Receipts table has 100+ rows worth comparing                            |
| TDEE projection bar                | Weight log has 30+ data points                                          |
| Health Flags (UPC)                 | Depends on OFF                                                          |
| Person handles (Megan/Cora/Sharon) | Multi-person grocery? Probably never                                    |

---

## 7. Grounding Manifest

| Claim                          | Evidence                                              |
| ------------------------------ | ----------------------------------------------------- |
| 8 tabs                         | Source line 585-588                                   |
| 5 sheet tables                 | Source line 98-102                                    |
| Receipt categories list        | Source line 657                                       |
| Discount rows = negative price | Source line 692 (`df[df["Price"] < 0]`)               |
| Default weight/TDEE            | Source line 105-106                                   |
| Seed data 33 rows              | Source lines 145-182                                  |
| Photo OCR uses Anthropic       | Source line 219-322                                   |
| Open Food Facts integration    | Source line 357-396                                   |
| TDEE math                      | Source line 517-523 (Mifflin-St Jeor, age 40, ~5'10") |
