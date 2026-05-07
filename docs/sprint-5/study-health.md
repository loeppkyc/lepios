# Phase 1a Study + v1 Acceptance — Health Module

**Source:** `streamlit_app/pages/8_Health.py` (1,577 lines) and the `health_metrics` / `health_events` schemas sketched in `streamlit_app/utils/data_layer.py:483-535`.
**Prepared:** 2026-05-07
**Branch:** `feat/health-port`
**Migration slots:** 0142–0147 (six tables)

---

## 1. What Already Exists in LepiOS

- **Oura Ring data** — `oura_daily` table + `/api/cron/oura-sync` + `/oura` page (just shipped). Single-person (Colin), full-featured.
- **`person_handle` pattern** — established TEXT column with default `'colin'` (`supabase/migrations/0010_add_hit_lists.sql:5`). Used in `lib/amazon/orders-sync.ts`, `lib/schemas/bet.ts`, etc. Lower-case handles.
- **Auth pattern** — Supabase auth (single user = Colin). RLS gives Colin everything; multi-person handled via `person_handle` column at query time, not separate Supabase users.
- **Cockpit shell** — `app/(cockpit)/layout.tsx`, `CockpitSidebar.tsx`. "Life › Health" entry exists with `href: null`.

**Nothing else** — no `vitals`, `symptoms`, `medications`, `doctor_visits`, `workouts`, `cycle_entries` tables. No `lib/health/`, no `/health` route. Confirmed via Grep.

---

## 2. Streamlit Source Analysis

### Tabs (8) — what they do

| Tab           | Lines     | Function                                                                                                    |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| Dashboard     | 692-777   | Overview cards: active meds, active symptoms, visits, Oura days; latest Oura scores; muscle fitness summary |
| Oura          | 784-962   | CSV/ZIP upload (Gen 2 + Gen 3), filter by date, charts (Scores, Sleep, HR), AI analysis (Claude)            |
| Fitness       | 969-1086  | Workout log + supercompensation muscle gauge (`calc_muscle_fitness`) + 30d trend                            |
| Vitals        | 1093-1150 | Log + per-type chart (BP, Weight, Temp, HR, Glucose, O2)                                                    |
| Symptoms      | 1157-1231 | Log + active/resolved + mark-resolved button                                                                |
| Medications   | 1238-1328 | Log + active/inactive + Stop + Delete                                                                       |
| Doctor Visits | 1335-1418 | Log + expandable history (diagnosis, outcome)                                                               |
| Cycle & Endo  | 1425-1509 | Log daily entry (cycle day, pain, mood, foods, supps) + 30d trend                                           |
| Export        | 1516-1572 | Per-section CSV + combined CSV download                                                                     |

### Sheet schemas (HEADERS dict, lines 47-73)

```
SH_VITALS:   Date, Person, Type, Value, Unit, Notes
SH_SYMPTOMS: Date, Person, Symptom, Severity (1-10), Duration, Resolved Date, Notes
SH_MEDS:     Person, Medication, Dosage, Frequency, Start Date, End Date,
             Prescribing Doctor, Pharmacy, Active (Y/N), Notes
SH_VISITS:   Date, Person, Doctor Name, Specialty, Clinic, Reason, Diagnosis,
             Outcome, Follow-up Date, Notes
SH_WORKOUTS: Date, Person, Exercise, Muscle Groups, Intensity, Notes
SH_ENDO:     Date, Person, Cycle Day, Pain Level (0-10), Pain Location,
             Bloating (0-10), Energy (0-10), Mood, Sleep Quality (0-10),
             Bowel Status, Foods, Supplements Taken, Notes
SH_OURA:     (15 cols — already covered by oura_daily; not ported here)
```

### Domain rules

- **PEOPLE** = `["Colin", "Megan", "Cora", "Sharon"]`. Person filter persists across all tabs via `st.radio` (line 462).
- **VITAL_TYPES** (line 123-135) — a fixed list of 11 types. Each maps to a unit via `_UNIT_MAP` (line 141-152). "Other" type allows free-text unit. BP is always logged as 2 separate rows (Systolic + Diastolic). Value is text-parsed via regex `r"([\d.]+)"` for charting (line 1135).
- **MUSCLE_GROUPS** (line 75) — 7 groups: Chest, Back, Legs, Shoulders, Arms, Core, Cardio. Each has a recovery window (54h–84h, line 115-118).
- **EXERCISE_MAP** (line 77-111) — 30 named exercises mapped to muscle groups. Plus "Other (type below)".
- **Supercompensation model** (line 613-663):
  - Stimulus = (intensity/10) × 15 × 0.85 (age multiplier)
  - If next session within 50% of recovery window → stimulus × 0.75
  - For elapsed time ≤ 72h: linear ramp `stimulus × (h/72)`
  - For elapsed > 72h: exponential decay `stimulus × exp(-days/12)`
  - Sum of all session contributions, capped at [0, 100]
- **Symptoms** — active = empty Resolved Date. Mark-resolved sets Resolved Date = today.
- **Medications** — active = "Y" in Active column. Stop sets Active="N" + End Date=today.
- **Cycle & Endo**: Cycle Day = 0 stored as empty (Day 1 = first day of period). Multi-select pain locations (joined with comma).

### Fragile points

- **Streamlit-specific** (not porting): `st.cache_data(ttl=60)`, `load_health.clear()`, `st.rerun()`, `st.session_state`.
- **Sheet row tracking** — every record gets `_row` index; updates use `ws.update_cell(row, col, val)`. LepiOS replaces with Supabase UUID PK + UPDATE WHERE id = ?.
- **Oura CSV parser** (lines 217-374) — handles 3 export formats (Gen 2, Gen 3 with semicolons, Gen 3 contributors as JSON or Python dict-repr). Not porting.
- **Vital "Value" column is text** — to support BP "120/80" historical entries. New writes always go through fixed VITAL_TYPES with single numeric value. We'll force NUMERIC in LepiOS schema. Migration risk: zero (no Streamlit→Supabase data migration in v1).
- **Password gate** (`require_health_password`) — Streamlit-only. Replaced by Supabase auth.

---

## 3. v1 Scope (decisions)

| Item                                     | Action         | Rationale                                                                                                    |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| Oura tab                                 | **SKIP**       | Already at `/oura` (single-person, API-driven). Streamlit's was multi-person CSV import — defer until needed |
| Vitals                                   | **PORT**       | Log + per-type line chart                                                                                    |
| Symptoms                                 | **PORT**       | Log + active/resolved + mark-resolved button                                                                 |
| Medications                              | **PORT**       | Log + active/inactive + Stop + Delete                                                                        |
| Doctor Visits                            | **PORT**       | Log + expandable history                                                                                     |
| Workouts (log+list)                      | **PORT**       | Log + history table                                                                                          |
| Workouts (gauge math)                    | **DEFER v1.1** | Supercompensation math is correctness-sensitive; ship list-only first, gauge after                           |
| Cycle & Endo                             | **PORT**       | Medical importance (endo monitoring) for Megan                                                               |
| Dashboard                                | **PORT**       | Overview cards                                                                                               |
| Export CSV                               | **PORT**       | Useful for doctor handoff                                                                                    |
| AI Health Insights                       | **SKIP v1**    | Was on Oura tab; defer with rest of Oura tab                                                                 |
| Multi-person via separate Supabase users | **SKIP**       | Use `person_handle` text column (LepiOS pattern). Colin queries all.                                         |

### Schema (6 migrations)

Common columns on all 6: `id UUID PK`, `person_handle TEXT NOT NULL DEFAULT 'colin'` (CHECK in `('colin','megan','cora','sharon')`), `created_at`, `updated_at`, `notes TEXT`.

| Migration | Table           | Domain columns                                                                                                                                                                                                                        |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0142      | `vitals`        | `recorded_on DATE`, `vital_type TEXT`, `value NUMERIC`, `unit TEXT`                                                                                                                                                                   |
| 0143      | `symptoms`      | `started_on DATE`, `symptom TEXT`, `severity INT (1-10)`, `duration TEXT`, `resolved_on DATE NULL`                                                                                                                                    |
| 0144      | `medications`   | `medication TEXT`, `dosage TEXT`, `frequency TEXT`, `start_date DATE`, `end_date DATE NULL`, `prescribing_doctor TEXT`, `pharmacy TEXT`, `active BOOLEAN DEFAULT TRUE`                                                                |
| 0145      | `doctor_visits` | `visit_date DATE`, `doctor_name TEXT`, `specialty TEXT`, `clinic TEXT`, `reason TEXT`, `diagnosis TEXT`, `outcome TEXT`, `follow_up_date DATE NULL`                                                                                   |
| 0146      | `workouts`      | `workout_date DATE`, `exercise TEXT`, `muscle_groups TEXT[]`, `intensity INT (1-10)`                                                                                                                                                  |
| 0147      | `cycle_entries` | `entry_date DATE`, `cycle_day INT NULL`, `pain_level INT (0-10)`, `pain_locations TEXT[]`, `bloating INT (0-10)`, `energy INT (0-10)`, `mood TEXT`, `sleep_quality INT (0-10)`, `bowel_status TEXT`, `foods TEXT`, `supplements TEXT` |

All tables: RLS enabled, authenticated users SELECT/INSERT/UPDATE/DELETE all rows (single-user system, RLS gates Colin only — same pattern as `oura_daily`).

Indexes: `(person_handle, <date_col> DESC)` on each.

---

## 4. 20% Better (over Streamlit baseline)

1. **Per-domain tables** — vs Streamlit's polymorphic-leaning `health_events` sketch. Better queries, indexing, type safety, RLS surface.
2. **Numeric values** for vitals — Streamlit stores text and regex-parses. We use NUMERIC + fixed `vital_type` enum. No parse failures, charts render directly.
3. **Audit trail** — every write goes to `agent_events` (`domain='health'`, `action='vital.add'` etc). Streamlit has no log.
4. **Server-side queries** — RSC + `createClient` (no client-side data fetching), no `st.cache_data` TTL juggling.
5. **No password gate** — just Supabase auth. Removes a manual step Colin always hated.
6. **Mark-resolved / Stop med** — atomic UPDATE not 2-cell sheet edits (Streamlit currently does 2 sequential `update_cell` calls; race condition possible if abandoned mid-flight).
7. **Person picker on URL** — `?p=megan` query param (so a tab can be bookmarked / shared, e.g., for Megan's view). Streamlit has session-state only.

---

## 5. Routes / Files

```
supabase/migrations/0142_vitals.sql
supabase/migrations/0143_symptoms.sql
supabase/migrations/0144_medications.sql
supabase/migrations/0145_doctor_visits.sql
supabase/migrations/0146_workouts.sql
supabase/migrations/0147_cycle_entries.sql

lib/health/types.ts                    — Person handles, vital types, muscle groups, frequencies, specialties
lib/health/queries.ts                  — all 6 SELECT helpers (per person)
lib/health/helpers.ts                  — pure shaping (active/resolved split, dashboard counters)

app/(cockpit)/health/page.tsx          — server component, fetches all 6 + renders shell
app/(cockpit)/health/_components/
  HealthShell.tsx                      — client wrapper: person picker + tab nav (URL-synced)
  PersonPicker.tsx                     — Colin/Megan/Cora/Sharon radio
  HealthDashboard.tsx                  — overview cards
  VitalsTab.tsx + VitalAddForm.tsx + VitalsChart.tsx
  SymptomsTab.tsx + SymptomAddForm.tsx
  MedsTab.tsx + MedAddForm.tsx
  VisitsTab.tsx + VisitAddForm.tsx
  WorkoutsTab.tsx + WorkoutAddForm.tsx
  CycleTab.tsx + CycleAddForm.tsx + CycleTrendChart.tsx
  ExportTab.tsx                        — CSV download buttons

app/api/health/vitals/route.ts         — POST (insert)
app/api/health/symptoms/route.ts       — POST (insert)
app/api/health/symptoms/[id]/route.ts  — PATCH (resolve), DELETE
app/api/health/medications/route.ts    — POST
app/api/health/medications/[id]/route.ts — PATCH (stop/reactivate), DELETE
app/api/health/doctor-visits/route.ts  — POST
app/api/health/doctor-visits/[id]/route.ts — DELETE
app/api/health/workouts/route.ts       — POST
app/api/health/workouts/[id]/route.ts  — DELETE
app/api/health/cycle-entries/route.ts  — POST
app/api/health/export/route.ts         — GET (returns CSV per section + combined)

tests/health/queries.test.ts
tests/health/helpers.test.ts
tests/api/health-vitals.test.ts        (smoke for one route — pattern matches Amazon)
```

---

## 6. Out of v1 Scope (revisit triggers)

| Item                                             | Revisit when                                            |
| ------------------------------------------------ | ------------------------------------------------------- |
| Workout supercompensation gauge                  | Colin asks for it / has 30+ workouts logged             |
| Oura CSV/ZIP import (multi-person)               | Megan/Cora/Sharon get rings                             |
| AI Health Insights button                        | Colin requests; pair with Twin/Daily Digest integration |
| Photo/avatar per person                          | Optional polish, never blocking                         |
| Megan/Cora/Sharon Supabase logins                | Real multi-tenancy needed (e.g., Megan logs her own)    |
| Cycle pattern recognition (cross-cycle averages) | After 2-3 cycles of data                                |
| Migration of historical Streamlit Health rows    | Manual decision — Streamlit keeps running as backup     |

---

## 7. Grounding Manifest

| Claim                            | Evidence                                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 8 tabs                           | Source line 681-685                                                                                    |
| 4 PEOPLE constant                | Source line 37                                                                                         |
| 7 sheet schemas                  | Source line 47-73                                                                                      |
| Supercompensation math params    | Source line 119-121, 613-663                                                                           |
| MUSCLE_GROUPS                    | Source line 75                                                                                         |
| RECOVERY_HOURS                   | Source line 115-118                                                                                    |
| EXERCISE_MAP                     | Source line 77-111                                                                                     |
| `person_handle` LepiOS pattern   | `supabase/migrations/0010_add_hit_lists.sql:5`; `lib/amazon/orders-sync.ts:23,90`                      |
| `oura_daily` already covers Oura | `supabase/migrations/0124_oura_daily.sql` (read 2026-05-07)                                            |
| Sidebar "Health" href:null       | `app/(cockpit)/_components/CockpitSidebar.tsx:126`                                                     |
| No existing health tables        | Grep: 0 matches in `supabase/migrations/` for `vitals\|symptoms\|medications\|doctor_visits\|workouts` |
