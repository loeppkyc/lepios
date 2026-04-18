# LepiOS Migration Notes

Running list of implementation requirements surfaced during audit and tech debt review.
These are not Sprint 2 items — they are sprint-tagged for when the relevant tile is built.

---

## MN-1 — Vendor Rules Auto-Learning Integration Test (Expenses Sprint)

**Sprint:** Expenses tile (Sprint 5 or later)
**Source bug:** Streamlit OS `auto_reconcile.py:67` emoji mismatch (`🏪` vs `🏷️`)

When the Expenses tile sprint happens, the `vendor_rules` auto-learning loop needs an integration test that proves a write-then-read round-trip works end-to-end with matching schemas.

**Test requirement:**

```
Given: a vendor name and category
When:  learn_vendor_rule(vendor, category) is called
Then:  load_vendor_rules() returns that vendor→category mapping
```

The Streamlit OS had this loop silently broken for its entire lifetime because `learn_vendor_rule()` wrote to a tab named `🏪 Vendor Rules` while `_load_vendor_rules()` read from `🏷️ Vendor Rules` — a one-character emoji difference that was never caught because there was no integration test.

In LepiOS, the read and write paths must both target the same Supabase `vendor_rules` table and the same column set (`vendor_key`, `category`, `gst_applicable`). Do not write to a different table or subset of columns than what the loader reads.

**Reference:** Streamlit OS `auto_reconcile.py:67`, full audit in `streamlit_app/docs/vendor-rules-audit.md`, SD-4 in `audits/data-report.md`.

---

## MN-2 — Split 'passed' Status into 'passed' (human) + 'rejected' (automated)

**Sprint:** Deals tile refinement (Sprint 3 or later)
**Source:** Noted during Sprint 1 write-path verification (2026-04-18)

The `deals.status` CHECK constraint currently allows: `found, watching, bought, passed, expired, test`.

`'passed'` is semantically overloaded — it currently covers two distinct states:

- **Human dismissed:** Colin saw the deal card (via Telegram or /money) and chose not to buy.
- **Automated rejection:** The brand filter, ROI threshold, or rank filter eliminated the product before it ever reached Colin.

These are different signals. Human-passed deals are actionable intelligence (Colin saw it, made a decision). Automated-rejected deals are noise (never surfaced). Mixing them makes deal quality analysis unreliable.

**Future migration:**

```sql
ALTER TABLE deals DROP CONSTRAINT deals_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_status_check
    CHECK (status IN ('found', 'watching', 'bought', 'passed', 'rejected', 'expired', 'test'));
```

Update `deal_scan.py` to write `status='rejected'` when brand/ROI/rank filter eliminates a deal (currently deals that fail filters are simply not saved). Update Telegram buy/skip handler to write `status='passed'` on Skip.

**Not a v1 change.** Do not implement until the Telegram buy/skip workflow is wired.

---

## MN-3 — Multi-User RLS Gate (Sprint 5 Hard Prerequisite)

**Sprint:** Sprint 5 (auth + multi-user) — HARD GATE, see ARCHITECTURE.md §7.3
**Source:** RLS verification checks run 2026-04-18, session before Chunk 3

The current RLS policy on `bets` (and all other person-scoped tables) is:

```sql
-- Current — permissive: allows any authenticated user to read/write all rows
CREATE POLICY bets_authenticated ON bets
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
```

This is safe today (auth.users = 0), but will break multi-user isolation the moment a second user is created. Before any second user is added:

**Step 1 — Create profiles table:**

```sql
CREATE TABLE profiles (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  person_handle text NOT NULL UNIQUE
);

-- Seed for Colin's account once created
-- INSERT INTO profiles (user_id, person_handle) VALUES ('<colin_auth_uid>', 'colin');
```

**Step 2 — Update RLS on all person-scoped tables** (`bets`, `trades`, `transactions`, `products`, `deals`, `net_worth_snapshots`, `agent_events`):

```sql
-- Drop permissive policy
DROP POLICY bets_authenticated ON bets;

-- SELECT: own rows only
CREATE POLICY bets_select ON bets FOR SELECT
  USING (
    person_handle = (SELECT person_handle FROM profiles WHERE user_id = auth.uid())
  );

-- INSERT: own rows only
CREATE POLICY bets_insert ON bets FOR INSERT
  WITH CHECK (
    person_handle = (SELECT person_handle FROM profiles WHERE user_id = auth.uid())
  );

-- UPDATE: own rows only
CREATE POLICY bets_update ON bets FOR UPDATE
  USING (
    person_handle = (SELECT person_handle FROM profiles WHERE user_id = auth.uid())
  );
```

Repeat for all person-scoped tables.

**Step 3 — Remove hardcoded person_handle from routes:**
All routes tagged with `// SPRINT5-GATE` must be updated to derive `person_handle` via:

```typescript
const { data: profile } = await supabase
  .from('profiles')
  .select('person_handle')
  .eq('user_id', user.id)
  .single()
const personHandle = profile?.person_handle
```

**Verification:** Log in as a second auth user. Attempt SELECT and INSERT on rows owned by 'colin'. Both must return 0 rows / RLS violation.
