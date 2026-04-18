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
