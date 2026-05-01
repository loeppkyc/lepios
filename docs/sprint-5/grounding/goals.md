# Grounding Doc — Goals & Habits (68_Goals.py)

**Prepared:** 2026-04-27  
**Status:** Pre-staged. Do NOT fire until ec1d00c7 outcome confirmed and Keepa (rank 1) queued or in-flight.  
**Overlap category:** GREENFIELD  
**Migration slots:** 0043 (goals), 0044 (habits)  
_(Assumes keepa takes 0041–0042. Recount from actual last migration before firing.)_

---

## 1. What Already Exists in LepiOS

**Nothing.** No `goals`, `habits`, goal-related lib, or `/cockpit/goals` route. Confirmed via Grep on `app/` — zero matches for "goal", "habit". This is a clean 2-table greenfield build.

---

## 2. Streamlit Source Analysis

Source: `pages/68_Goals.py` (330 lines, 3 tabs)

### Data domains

Two distinct domains — goals and habits — each with their own Google Sheets tab.

```python
GOALS_SHEET = "🎯 Goals"
HABITS_SHEET = "🎯 Habits"
GOALS_HEADERS  = ["Goal", "Category", "Target Date", "Status", "Progress", "Notes"]
HABITS_HEADERS = ["Habit", "Frequency", "Streak", "Last Done", "Total"]
CATEGORIES  = ["Financial", "Health", "Family", "Business", "Personal"]
STATUSES    = ["Not Started", "In Progress", "Complete"]
FREQUENCIES = ["Daily", "Weekly", "Monthly"]
```

### Tab 1 — Active Goals

```python
# Source lines 145–195
# Add goal form: goal text, category, target_date, notes
# _save_goal: appends row to Sheets with status="Not Started", progress="0"
# Active goals = goals where Status != "Complete"
# Per-goal card: styled div with goal name, category, target date
# Inline progress slider (0–100) + status dropdown + Save button
# _update_goal_row: batch_update to Sheets row (Status + Progress columns)
```

### Tab 2 — Daily Habits

```python
# Source lines 199–258
# Add habit form: habit name, frequency
# _save_habit: appends row with Streak=0, Last Done="", Total=0
# Per-habit row: checkbox (disabled if done today), streak display, Check In button
# _check_in_habit:
#   - If last_done == today → return False (already done)
#   - If last_done == yesterday → new_streak = current_streak + 1
#   - Else → new_streak = 1 (streak broken)
#   - new_total = current_total + 1
#   - Updates Streak, Last Done, Total in Sheets
```

**Critical streak logic (grounded from source lines 110–128):**

```python
if last_done == today_str:          # already done — no-op
    return False
try:
    last_dt = datetime.strptime(last_done, "%Y-%m-%d").date()
except ValueError:
    last_dt = None

if last_dt and (date.today() - last_dt).days == 1:
    new_streak = current_streak + 1  # yesterday → continue streak
elif last_dt and (date.today() - last_dt).days == 0:
    return False                     # same day — shouldn't happen given first guard
else:
    new_streak = 1                   # gap or first check-in → reset to 1
```

### Tab 3 — Review

```python
# Source lines 263–325
# Goal completion: count completed goals by this month / this year (from Target Date, not completion date)
# NOTE: if Target Date is unparseable, counts toward year_count anyway (line 284)
# Habit streaks: sort by Streak desc, show longest streak + total check-ins
# Today's completion rate: habits done today / total habits
```

**Data quirk (grounded — source line 284):** goals with unparseable Target Date are counted toward year_count. Coordinator should decide: replicate or treat null target_date as "no target" (exclude from counts). Recommendation: replicate for parity.

---

## 3. Decisions (Resolved Pre-fire)

| Decision                                      | Resolution                                        | Rationale                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streak computation: render-time vs DB trigger | **DB trigger (20% Better)**                       | Render-time is fragile on Supabase (concurrent writes). A `BEFORE UPDATE` trigger on `habits.last_done_at` computes streak instantly, stores result.                 |
| Sheets → Supabase                             | **Supabase (standard)**                           | No Google Sheets in LepiOS                                                                                                                                           |
| One-time data migration                       | **Note in acceptance doc; not a blocker**         | If Colin has goals/habits in Sheets, coordinator adds a migration note. The LepiOS tables start empty — not a launch blocker.                                        |
| Auth                                          | **Standard LepiOS Supabase auth**                 | Goals/habits are personal data; existing auth pattern applies. No password gate.                                                                                     |
| Goal completion date                          | **Use `completed_at` timestamp, NOT Target Date** | Target Date is a planning field, not a completion record. Completion rate query should use `completed_at`. (This is a 20% Better fix — Streamlit conflates the two.) |
| Grounding checkpoint                          | **None needed**                                   | No financial data. No external source of truth to match.                                                                                                             |

---

## 4. What to Port / Skip / Rebuild

| Item                                 | Action                    | Reason                                                        |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------- |
| Goals CRUD (add, status, progress)   | **PORT**                  | Direct translation                                            |
| Habits CRUD (add, check-in)          | **PORT**                  | Direct translation                                            |
| Streak logic                         | **REBUILD** as DB trigger | 20% Better; render-time is fragile                            |
| Category filter on goals             | **PORT**                  | Simple enum filter                                            |
| Review tab: completion counts        | **PORT** with fix         | Fix: use `completed_at` not Target Date for month/year counts |
| Review tab: habit streak leaderboard | **PORT**                  | Direct translation                                            |
| Today's completion rate              | **PORT**                  | Simple ratio                                                  |
| Goal card styled div                 | **PORT** (Design Council) | Replace inline Streamlit HTML with shadcn/ui Card + Tailwind  |
| Sheets persistence                   | **SKIP / REPLACE**        | All reads/writes go to Supabase                               |

---

## 5. New Schema (Coordinator Must Spec)

### `goals` (migration 0043)

```sql
id uuid primary key default gen_random_uuid(),
user_id uuid references auth.users(id),        -- for future multi-user; Colin is single user
goal text not null,
category text not null check (category in ('Financial','Health','Family','Business','Personal')),
target_date date,
status text not null default 'Not Started'
  check (status in ('Not Started','In Progress','Complete')),
progress_pct int not null default 0 check (progress_pct between 0 and 100),
notes text,
completed_at timestamptz,                      -- set when status changes to Complete
created_at timestamptz default now()
```

### `habits` (migration 0044)

```sql
id uuid primary key default gen_random_uuid(),
user_id uuid references auth.users(id),
name text not null,
frequency text not null check (frequency in ('Daily','Weekly','Monthly')),
streak_count int not null default 0,
last_done_at date,                             -- date only (no time), for streak math
total_count int not null default 0,
created_at timestamptz default now()
```

**DB trigger spec (in migration 0044):**

```sql
-- BEFORE UPDATE ON habits
-- IF NEW.last_done_at != OLD.last_done_at:
--   IF NEW.last_done_at = OLD.last_done_at + 1 → NEW.streak_count = OLD.streak_count + 1
--   ELSE                                        → NEW.streak_count = 1
--   NEW.total_count = OLD.total_count + 1
```

---

## 6. New Route / Page Structure

```
app/(cockpit)/goals/page.tsx           — main page, 3 tabs (Goals | Habits | Review)
app/(cockpit)/goals/_components/
  GoalsList.tsx                        — active goals with progress sliders
  GoalCard.tsx                         — per-goal card component
  HabitsList.tsx                       — daily habit check-in list
  HabitRow.tsx                         — per-habit row with streak badge
  GoalsReview.tsx                      — completion counts + streak leaderboard
app/api/goals/route.ts                 — GET (list) / POST (add)
app/api/goals/[id]/route.ts            — PATCH (update status/progress)
app/api/habits/route.ts                — GET (list) / POST (add)
app/api/habits/[id]/check-in/route.ts  — POST (set last_done_at → trigger fires)
```

---

## 7. 20% Better Opportunities

1. **Streak DB trigger** (spec above): removes render-time computation fragility. Atomic, correct under concurrent writes.
2. **`completed_at` field**: enables accurate "goals completed this month" query using a real timestamp, not the planning target date.
3. **Habit check-in history table** (optional, Phase 2): `habit_checkins(habit_id, done_at)` — enables streak charts and calendar heatmaps. Streamlit has no history; Supabase makes it easy.
4. **Weekly/monthly habit frequency logic**: Streamlit tracks streaks for all habits identically regardless of frequency. A daily habit should reset after 1 missed day; a weekly habit after 7. Coordinator should spec this correctly — it's a 20% Better fix that prevents streak corruption for non-daily habits.

---

## 8. Blockers / Open Questions

| Item                                                             | Status                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does Colin have existing goals/habits data in Sheets to migrate? | Unknown — note in acceptance doc; coordinator should ask Twin or flag for Colin                                                                                              |
| Weekly/monthly habit streak logic                                | Streamlit treats all frequencies the same (streak resets if last_done != yesterday). Coordinator should resolve: keep parity or fix frequency-aware streak? Twin can advise. |
| RLS on goals/habits tables                                       | Single user app — RLS can be `auth.uid() = user_id` or disabled (same as other LepiOS tables)                                                                                |

---

## 9. Grounding Manifest

| Claim                                          | Evidence                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| No goals/habits in LepiOS app/                 | Grounded — Grep on app/ for "goal", "habit" returned no matches 2026-04-27 |
| Streak logic: 1-day gap = streak+1, else reset | Grounded — source lines 110–128, read 2026-04-27                           |
| Target Date conflation in Review tab           | Grounded — source line 284: unparseable dates count toward year_count      |
| CATEGORIES, STATUSES, FREQUENCIES constants    | Grounded — source lines 27–29, read 2026-04-27                             |
| 3 tabs: Active Goals, Daily Habits, Review     | Grounded — source line 140, read 2026-04-27                                |
