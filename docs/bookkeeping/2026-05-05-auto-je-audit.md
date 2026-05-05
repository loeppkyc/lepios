# Auto-Approved JE Audit — 2026-05-05

Audited the 44 `lepios_auto` JEs created by `ingest-bank-csv.py` against
the same risk pattern that caught the Bonvoy mis-cat (same description
prefix routing to potentially-wrong account).

**None of these are exported to QB yet** — all corrections can be applied
directly with no downstream cleanup.

## Summary

| #   | Suspicion                                                                      | Risk                                                    | Needs Colin                                            |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------ |
| 1   | `TFR-TO C/C` always → `TD Visa` (rule "TFR to TD Visa")                        | Same prefix-ambiguity as AMEX CARDS                     | Confirm WR560 & HI450 are both TD Visa                 |
| 2   | `CAPTL ONE MC` → `Owner's Equity:Owner's Draw` (rule "Capital One MC payment") | Categorization choice                                   | Confirm Capital One is treated as personal-on-business |
| 3   | `Edge Benefits MSP` → `Owner's Equity:Owner's Draw` (rule "Edge Benefits")     | Same as #2                                              | Confirm benefits is personal-on-business               |
| 4   | `AMEX CARDS X9A6A9` ($14.69 Apr 20) → `Amex Marriot Bonvoy`                    | Rule already demoted; this row left untouched per scope | Confirm $14.69 is actually Bonvoy                      |

False positives ruled out:

- `PAY TO: CRA _V` → 5 entries split between `GST/HST Suspense` and `Income Tax Payable`. **Intentional**; all 5 were manually approved by you with notes ("2025 T1 NOA payment", "GST payment in April").
- All other rules: 1-2 entries each, pattern strength looks adequate.

## Detail

### 1. TFR-TO C/C → TD Visa

```
2026-04-07  WR560 TFR-TO C/C   -240.13   → TD Visa  [JE AUTO-20260407-297f28]
2026-04-22  HI450 TFR-TO C/C   -111.83   → TD Visa  [JE AUTO-20260422-c2f18c]
```

Rule `TFR to TD Visa` (id `d522a4ef-…`, pattern `TFR-TO C C`) auto-routes
_every_ "TFR-TO C/C" payment to the TD Visa card. The varying prefixes
(WR560, HI450, and seen in earlier statements: WQ203) are TD's reference
codes — they don't distinguish destination card. If you ever transfer to
a different card from chequing using TD's "transfer to credit card"
feature, this rule misclassifies it (just like AMEX CARDS misclassified
Business Platinum payments as Bonvoy).

**Recommendation:** demote `confidence_default` 95 → 60, route future
matches to `needs_review`, decide per-row in `/bookkeeping/reconcile`.

If you confirm both Apr WR560 + HI450 are TD Visa, the existing JEs
stay put.

### 2. CAPTL ONE MC → Owner's Equity:Owner's Draw

```
2026-04-13  CAPTL ONE MC U7U6X5   -966.36   → Owner's Equity:Owner's Draw  [JE AUTO-20260413-2eb3ed]
2026-04-20  CAPTL ONE MC X9A6J3   -100.00   → Owner's Equity:Owner's Draw  [JE AUTO-20260420-26ee1c]
2026-04-29  CAPTL ONE MC H2W8H9   -632.48   → Owner's Equity:Owner's Draw  [JE AUTO-20260429-d2dfac]
```

Rule `Capital One MC payment` (id `4b1f27d5-…`) routes Capital One MC
payments to **Owner's Draw**, not to the `CaptialOne MC 3583` liability
account that exists in your chart of accounts.

This means: when business chequing pays the Capital One card, the books
treat the cash as "you took the cash out of the business" rather than
"you paid down a business liability." That's the right call **if** the
Capital One card is your personal card and you never run business
expenses through it. It's wrong **if** the Capital One card carries any
business expenses — those would never get booked.

**Question for you:** is the Capital One card 3583 used for business
expenses, or is it strictly personal and these chequing-side payments
are draws?

If personal-only → rule is correct, leave as-is.
If mixed/business → rule should debit `CaptialOne MC 3583`, and a
separate process needs to ingest the Capital One CSV to capture the
expenses on the card side.

### 3. Edge Benefits MSP → Owner's Equity:Owner's Draw

```
2026-04-20  Edge Benefits MSP   -29.25   → Owner's Equity:Owner's Draw  [JE AUTO-20260420-c9ec96]
```

Rule `Edge Benefits` (id `9fc0c796-…`) treats this as a personal benefits
payment from business. Reasonable if Edge Benefits is your personal
disability/health coverage. Wrong if it's a business-side expense (e.g.,
insurance premium for business or for an employee).

**Question for you:** is Edge Benefits personal coverage paid from
business (correct as-is) or a business-claimable insurance expense
(should be `INSURANCE & PROFESSIONAL LIABILITY` or similar)?

### 4. AMEX CARDS $14.69 (Apr 20)

```
2026-04-20  AMEX CARDS X9A6A9   -14.69   → Amex Marriot Bonvoy  [JE auto_approved]
```

The rule was demoted from 95 → 60 today, so future "AMEX CARDS" rows go
to `needs_review`. This existing row was left untouched per your scope
("only $64.14 + $698.83 are wrong"). Worth a final confirmation that
$14.69 is in fact a Bonvoy payment — if you have the Apr Bonvoy
statement and the $14.69 doesn't appear on it, this is also Business
Platinum and the JE needs the same fix.

## Action requested

When you're back, check #1 → #4 in order. For each:

- Confirm the categorization is correct → no action.
- Categorization is wrong → reply with the right account name and the
  rule will be demoted + JE patched the same way the Bonvoy fix worked
  today (commits `2e49d46` and the SQL run before it).

## Data points

- Total `lepios_auto` JEs in DB: 44
- Total amount across those JEs: $26,200.75 (debits)
- Distinct rules used: 22 (plus 7 manual entries with no rule, all CRA/Polar HQ that you reviewed)
- Rules with `confidence_default ≥ 90`: 22; below 90 (will route to `needs_review`): 1 (the Bonvoy rule, demoted today)
