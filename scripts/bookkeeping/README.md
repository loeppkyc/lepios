# LepiOS Bookkeeping Pipeline

Replaces manual bookkeeper data entry. Statements come in → JEs auto-created → review queue for low-confidence items → copy/paste or push to QuickBooks.

## Architecture

```
Bank/CC CSV ─────┐
Hubdoc PDFs ─────┼──► ingest-bank-csv.py ──► pending_transactions ──┬──► (auto-approved) journal_entries
Amazon SP-API ───┘                                                  └──► (needs_review) review queue
                                                                              │
                                                                              ▼
                                                                       /bookkeeping/reconcile UI
                                                                              │
                                                                              ▼
                                                                        QB CSV/IIF export
```

## Tables

| Table                                     | Purpose                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| `chart_of_accounts`                       | Mirrors QB account hierarchy (114 accounts)           |
| `vendor_rules`                            | Pattern → expense_account map (auto-learned + manual) |
| `bank_imports`                            | Audit trail: every CSV that's been ingested           |
| `pending_transactions`                    | Staging table for parsed CSV rows pre-JE-creation     |
| `journal_entries` + `journal_entry_lines` | Final double-entry ledger                             |
| `gst_hst_filings`                         | Quarterly GST data                                    |

## Scripts

### `ingest-journal.py`

One-off ingest of QB Journal CSV (e.g., quarterly close from bookkeeper).

```bash
SUPABASE_URL=https://xpanlbcjueimeofgsara.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=$SVCKEY \
python3 ingest-journal.py "Colin Loeppky_Journal.csv"
```

Output: 263 JEs / 698 lines (Q1 2026 example).

### `ingest-bank-csv.py`

Per-statement ingest. Auto-detects format. Matches against `vendor_rules`, creates JEs for high-confidence matches.

```bash
SUPABASE_URL=https://xpanlbcjueimeofgsara.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=$SVCKEY \
PYTHONIOENCODING=utf-8 \
python3 ingest-bank-csv.py \
  --source "TD CHEQUING (9150)" \
  --auto-threshold 90 \
  --dry-run \
  /path/to/statement.csv
```

Drop `--dry-run` to actually write.

#### Source account names (must match `chart_of_accounts.full_name` exactly)

- `TD CHEQUING (9150)`
- `TD USD CHEQUING (9924)`
- `TD Visa`
- `Business Platinum Card from American Express(1007)`
- `Amex Marriot Bonvoy`
- `CaptialOne MC 3583`
- `Costco Credit Card`
- `CndTire MC 3253`

#### Supported CSV formats (auto-detected by header)

- TD Chequing v1: `Date | Description | Withdrawals | Deposits | Balance`
- TD Chequing v2: `Date | Description | CAD$ Out | CAD$ In | Running Balance`
- 3-column signed: `Date | Description | Amount`
- Amex CA: `Transaction Date | Description | Amount` (variations)
- Generic 4-col: `Date | Description | Amount | Balance`

If your CSV doesn't auto-detect, add a branch in `detect_format()` and `parse_csv()`.

## Monthly workflow

1. **Get statements** (start of each month). For TD Chequing the PDF in
   Dropbox/Hubdoc works directly — no online-banking CSV download needed:

   ```bash
   python3 parse-td-pdf.py /path/to/TD_UNLIMITED_CHEQUING_*.pdf -o april-td.csv
   # validation summary prints to stderr; CSV goes to file (or stdout if -o omitted)
   ```

   Other accounts still use CSV downloads:
   - TD Visa → online → Activity → CSV
   - Amex Business 1007 → online → Statements → CSV
   - Amex Marriot Bonvoy → similar
   - CapitalOne MC → similar
   - CIBC Costco MC → similar
   - Canadian Tire MC → triangle.com → CSV

2. **Run ingest** for each:

   ```bash
   python3 ingest-bank-csv.py --source "TD CHEQUING (9150)" april-td.csv
   for csv in ~/Downloads/*.csv; do
     python3 ingest-bank-csv.py --source "<the right account>" "$csv"
   done
   ```

3. **Review the pending queue** at `/bookkeeping/reconcile`.

4. **For each needs_review**: either approve (creates JE) or correct the categorization. Corrections become new vendor_rules (the system learns).

5. **Reconcile Amazon settlement deposits** (Phase 2 — not yet built): match `AMAZON MSP` deposits in TD Chequing to `amazon_settlements` rows.

6. **Export to QuickBooks**: download the CSV at `/bookkeeping/qb-export`,
   import it into QB, then click "Mark as exported".

## Confidence thresholds

| Confidence | Outcome                                               |
| ---------- | ----------------------------------------------------- |
| ≥ 90       | Auto-create JE, status `auto_approved`                |
| 60–89      | `needs_review` (rule matched but not high-confidence) |
| 0          | `needs_review` (no rule matched)                      |

Tune `--auto-threshold` per your tolerance for unattended automation.

## Adding new vendor rules

Manual SQL:

```sql
INSERT INTO vendor_rules (
  rule_name, match_pattern, match_type,
  expense_account, gst_rate, business_use_pct,
  vendor_display_name, source
) VALUES (
  'Some Vendor', 'SOMEVENDOR', 'contains',
  'OFFICE SUPPLIES & EXPENSES:Office expenses', 0.05, 100,
  'Some Vendor', 'manual'
);
```

Auto-learning: when you tick "Save as rule for pattern" in `/bookkeeping/reconcile`, the approval call inserts a `vendor_rules` row with `source='auto_learned'`. Next time the same pattern hits, it auto-approves.

## What's NOT yet built

- **Amazon settlement matching** — link `AMAZON MSP` TD deposits to `amazon_settlements.net_payout` for reconciliation.
- **GST collected on sales** — currently we book GST on purchases (input tax credits). Sales-side GST tracking from Amazon CSVs needed for proper GST filing.
- **Hubdoc PDF parsing for receipts** — covered for TD Chequing statements (`parse-td-pdf.py`). Receipt PDFs that don't appear on bank statements still need parsing.
- **Recurring transaction detection** — detect monthly subscriptions and auto-confirm them as expected.

## What's built

- **Approval UI** at `/bookkeeping/reconcile` — visual queue for `pending_transactions WHERE status='needs_review'`, approve/edit/reject, optional rule learning.
- **QB CSV export** at `/bookkeeping/qb-export` — exports unexported `lepios_auto` JEs in QB Online Journal Entry import format. Two-step: download → import in QB → mark exported. Filters out the `qb_import` Q1 baseline.
- **TD Chequing PDF parser** — `parse-td-pdf.py` reads Hubdoc PDF statements directly, validates parsed net change against starting/ending balance.

## Failure modes & gotchas

1. **Date format ambiguity** — `01/04/2026` could be Jan 4 or Apr 1. The parser tries multiple formats; if your bank uses an unusual format, add it to `DATE_FORMATS`.

2. **Vendor name variants** — same vendor appears as `MRS. J'S BOOKKEEPING`, `Mrs J's Bookkeeping`, `IN *MRS J'S`. The matcher normalizes punctuation/case. If a rule still misses, add another pattern.

3. **Truncation** — banks truncate long descriptions. Handled via word-prefix tolerance (`MANAGEMEN` matches `MANAGEMENT`).

4. **Sign convention** — for credit cards, the CSV often shows purchases as positive and payments as negative (opposite of bank accounts). The script auto-flips for accounts containing `Card`, `MC`, `Visa`, `Bonvoy`.

5. **Duplicate detection** — `dedup_hash` is `sha256(source_account + date + amount + description)`. Re-running an ingest on the same CSV is safe.

6. **Multi-currency** — `TD USD CHEQUING (9924)` and `Paypal USD` accounts hold USD. The script doesn't currently FX-convert. Future: pull FX rate at txn date and split base/foreign.
