# Recurring Expense Template Candidates — 2026-05-05

`recurring_expense_templates` table is currently empty. The 22 active
`vendor_rules` describe known vendors but have no notion of cadence
(monthly / quarterly / annual / irregular). This doc proposes which
rules should seed `recurring_expense_templates` so the
`/recurring` cockpit page becomes useful.

## Why we can't auto-detect cadence yet

Detection of recurring patterns needs ≥3 months of consistent
transaction-level data per vendor. Right now we have:

- **263 `qb_import` JEs from Q1** — bookkeeper-summary level (one
  monthly entry per category), not per-transaction. Not useful for
  cadence detection.
- **44 `lepios_auto` JEs in April only** — one month, one observation
  per typical monthly vendor.

So algorithmic "what's recurring?" detection will be either empty-set
(too strict) or false-positive-heavy (too loose). Cadence assignments
below come from **vendor knowledge** — they're proposed for your manual
confirmation, not algorithmic output.

A re-run of this discovery in **August 2026** (~4 months of `lepios_auto`
data) should be reliable enough to auto-classify.

## Candidate templates (proposed cadence)

Sorted by certainty.

### High-certainty monthly subscriptions / bills (seed these)

| Vendor               | Account                     | Apr amt | Day | GST | Notes                    |
| -------------------- | --------------------------- | ------- | --- | --- | ------------------------ |
| Bell Mobility        | Cell phone costs            | $123.78 | 6   | 5%  | Confirm exact day        |
| Rogers               | Cell phone costs            | $115.60 | 22  | 5%  | Two cell vendors active? |
| Claude.ai            | Software Subscriptions      | $147.00 | 11  | 5%  |                          |
| Anthropic            | Software Subscriptions      | $37.54  | 6   | 5%  |                          |
| Dropbox              | Software Subscriptions      | $16.79  | 17  | 5%  |                          |
| HUBDOC.COM           | Software Subscriptions      | $15.75  | 19  | 5%  |                          |
| Google               | Software Subscriptions      | $8.87   | 12  | 5%  |                          |
| Namecheap            | SOFTWARE                    | $16.92  | 15  | 5%  | Annual renewal? confirm  |
| Pembridge Insurance  | Vehicle Insurance SGI       | $334.96 | 6   | 5%  | Vehicle policy           |
| Economical Insurance | Vehicle Insurance SGI       | $64.32  | 20  | 0%  | Second vehicle?          |
| Edge Benefits        | Owner's Equity:Owner's Draw | $29.25  | 20  | 0%  | Personal benefits        |
| Affordable Storage   | Storage Unit expense        | $367.50 | 16  | 5%  |                          |
| Rohit Management     | parking costs               | $435.00 | 2   | 5%  | Office parking           |
| BDC bus loan         | BDC Loan                    | $70.31  | 24  | 0%  | Loan payment             |
| Monthly Account Fee  | Bank charges                | $17.95  | 30  | 5%  | TD account fee           |

### Variable-amount monthly (seed but expect amount drift)

| Vendor                       | Account                | Apr observations                      | Notes                                                      |
| ---------------------------- | ---------------------- | ------------------------------------- | ---------------------------------------------------------- |
| AMEX Bill Payment (Bus Plat) | Business Platinum 1007 | $111.05 (Apr 6), $84 (Apr 29)         | CC paydown — at least monthly, multiple payments common    |
| Capital One MC payment       | Owner's Draw           | $966.36 (13), $100 (20), $632.48 (29) | Same — multiple payments per month, variable amount        |
| TFR-TO C/C → TD Visa         | TD Visa                | $240.13 (7), $111.83 (22)             | CC transfer; flagged in audit doc as ambiguous (which CC?) |

These three are recurring in the sense that "you'll pay your CC monthly" — but the **amount and frequency vary widely**, so a template's "expected amount" field would be a poor forecasting signal. Better treated as expected-presence (≥1 charge/month), not expected-amount.

### Not recurring (don't seed)

| Vendor / Pattern     | Why                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------- |
| AMAZON MSP           | Settlements every 2-3 days, not monthly cadence. Already linked to `amazon_settlements`. |
| Amazon Sponsored Ads | Irregular ad spend, varies wildly                                                        |
| AMEX CARDS           | Already demoted; ambiguous (Bonvoy vs Bus Plat) — see audit doc                          |
| GST refund           | Ad-hoc CRA refund, not on a schedule                                                     |
| CAN TIRE MC          | One April occurrence — Colin may not use this card monthly                               |
| Costco MC            | No April activity yet — observe before seeding                                           |
| Pay To: CRA          | Tax remittances, ad-hoc when due (already manually-approved JEs)                         |

## How to seed (when ready)

For each row in the "high-certainty" table you want to confirm, run:

```sql
INSERT INTO recurring_expense_templates
  (vendor, category, pretax, tax_amount, payment_method, day_of_month, frequency, business_use_pct, active, notes)
VALUES
  ('Bell Mobility', 'OFFICE SUPPLIES & EXPENSES:Cell phone costs', 117.89, 5.89, 'TD CHEQUING (9150)', 6, 'monthly', 100, true, 'Auto-debit, business phone'),
  ('Rohit Management', 'VEHICLE EXPENSES:parking costs', 414.29, 20.71, 'TD CHEQUING (9150)', 2, 'monthly', 100, true, 'Office parking');
-- etc.
```

(Pretax/tax breakdown matches the GST rate column above. e.g., Bell 5%
GST: $123.78 → pretax $117.89 + GST $5.89.)

## When to revisit

- **August 2026** — re-run discovery query with ≥4 months of
  `lepios_auto` data. Algorithmic cadence detection should work then:
  monthly subscriptions show n_obs≥3, day_of_month variance ≤3,
  amount stddev <10% of mean.
- **After Capital One/Amex card-side ingest is built** — the CC paydown
  templates change shape (the cash-side payment becomes a transfer, the
  per-charge expenses are the actual recurring entries).

## Action requested

When you're back: skim the high-certainty table, mark which to seed,
which to skip, which day-of-month to tweak (single-occurrence days are
a guess — Apr 6 might typically be Apr 5 or 7 in other months). I'll
write the INSERTs.
