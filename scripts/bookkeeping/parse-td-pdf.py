"""
Parse a TD Unlimited Chequing PDF statement → CSV in 3-column signed format
(Date,Description,Amount). The output is a drop-in for ingest-bank-csv.py.

Layout (TD Unlimited Chequing, observed 2026):
  Header row x-positions:
    Description (~108) | Withdrawals (~229-288) | Deposits (~339-381) | Date (~420) | Balance (~480)
  Transaction rows: amount appears in either the W column (right edge ~306) or
  the D column (right edge ~405). Date is "MMMDD" e.g. "APR02".
  Last transaction of each day also has a running balance in the Balance column.

Usage:
  python parse-td-pdf.py path/to/statement.pdf > out.csv
  python parse-td-pdf.py path/to/statement.pdf --check          # validate against statement totals only
  python parse-td-pdf.py path/to/statement.pdf -o out.csv

Then feed the CSV into the existing ingester:
  python ingest-bank-csv.py --source "TD CHEQUING (9150)" out.csv
"""

import argparse
import csv
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import pdfplumber

# ---------- Config ----------

# x-coordinate threshold separating Withdrawals from Deposits column.
# Anything with x1 (right edge) below ~340 is a withdrawal; above is a deposit.
W_D_SPLIT_X = 340.0

# Skip rows whose description contains any of these tokens (header/footer/totals).
# Stored without spaces — we strip whitespace from the row text before checking,
# because some TD statement variants render words concatenated.
SKIP_TOKENS_NORMALIZED = (
    "STARTINGBALANCE",
    "BALANCEFORWARD",
    "Total",  # subtotal row
    "Account/Transaction",
    "Description",  # header row
    "Page",
    "ACCOUNTISSUED",
    "Pleaseensure",
)

MONTH_TO_NUM = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

# Period regex: "MAR 31/26 - APR 30/26"
PERIOD_RE = re.compile(
    r"([A-Z]{3})\s*(\d{1,2})/(\d{2})\s*-\s*([A-Z]{3})\s*(\d{1,2})/(\d{2})"
)
# Date token within transaction rows: APR02, DEC31, etc.
TXN_DATE_RE = re.compile(r"^([A-Z]{3})(\d{1,2})$")
AMOUNT_RE = re.compile(r"^[\d,]+\.\d{2}$")


# ---------- Period parsing ----------

def parse_period(text: str) -> tuple[date, date] | None:
    m = PERIOD_RE.search(text)
    if not m:
        return None
    sm, sd, sy, em, ed, ey = m.groups()
    start = date(2000 + int(sy), MONTH_TO_NUM[sm], int(sd))
    end = date(2000 + int(ey), MONTH_TO_NUM[em], int(ed))
    return start, end


def resolve_txn_date(month: str, day: int, period_start: date, period_end: date) -> date:
    """Pick the year for a transaction date based on the statement period.

    For statements spanning a year boundary (e.g. DEC/JAN), use start year for
    months >= start month, else end year.
    """
    mnum = MONTH_TO_NUM[month]
    if period_start.year == period_end.year:
        return date(period_start.year, mnum, day)
    # cross-year statement
    if mnum >= period_start.month:
        return date(period_start.year, mnum, day)
    return date(period_end.year, mnum, day)


# ---------- Row extraction ----------

def group_words_by_row(words, tol: float = 2.0) -> dict[int, list[dict]]:
    """Group words into rows keyed by quantized top coordinate."""
    rows: dict[int, list[dict]] = defaultdict(list)
    for w in words:
        key = round(w["top"])
        # bucket near-equal tops together
        merged = False
        for existing in list(rows.keys()):
            if abs(existing - key) <= tol:
                rows[existing].append(w)
                merged = True
                break
        if not merged:
            rows[key].append(w)
    for k in rows:
        rows[k].sort(key=lambda w: w["x0"])
    return dict(sorted(rows.items()))


def parse_amount(s: str) -> float:
    return float(s.replace(",", ""))


def extract_transactions(pdf_path: Path) -> tuple[list[dict], dict]:
    """Returns (transactions, meta).

    transactions: list of {date: str ISO, description: str, amount_signed: float, raw_row: list[str]}
    meta: {period: (start, end), starting_balance: float|None, ending_balance: float|None}
    """
    txns: list[dict] = []
    period: tuple[date, date] | None = None
    starting_balance: float | None = None
    ending_balance: float | None = None

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if period is None:
                period = parse_period(text)
            words = page.extract_words()
            rows = group_words_by_row(words)

            for top, row_words in rows.items():
                texts = [w["text"] for w in row_words]
                joined = " ".join(texts)
                joined_nospace = re.sub(r"\s+", "", joined)

                # Capture STARTING BALANCE (only on page 1, before first txn).
                if starting_balance is None and "STARTINGBALANCE" in joined_nospace:
                    for w in row_words:
                        if AMOUNT_RE.match(w["text"]) and w["x1"] >= 470:
                            starting_balance = parse_amount(w["text"])
                            break

                # Skip header / footer / totals
                if any(tok in joined_nospace for tok in SKIP_TOKENS_NORMALIZED):
                    continue

                # Find the date token (APR02 etc.)
                date_word = None
                for w in row_words:
                    if TXN_DATE_RE.match(w["text"]):
                        date_word = w
                        break
                if date_word is None:
                    continue

                # Find amount(s) in W or D column.  An amount is any text matching N,NNN.NN
                # whose x1 falls within W (≤ split) or D (> split, but ≤ Balance column start ~470).
                amt_word = None
                for w in row_words:
                    if not AMOUNT_RE.match(w["text"]):
                        continue
                    if w["x1"] >= 470:  # Balance column → ignore
                        continue
                    amt_word = w
                    break  # first amount is the W or D amount; balance comes after date

                if amt_word is None:
                    continue

                amount = parse_amount(amt_word["text"])
                is_deposit = amt_word["x1"] > W_D_SPLIT_X
                amount_signed = amount if is_deposit else -amount

                # Track the running balance if present (last column, x1 >= 470).
                for bw in row_words:
                    if AMOUNT_RE.match(bw["text"]) and bw["x1"] >= 470:
                        ending_balance = parse_amount(bw["text"])
                        break

                # Description = all words before the amount in this row
                desc_words = [w["text"] for w in row_words if w["x0"] < amt_word["x0"]]
                description = " ".join(desc_words).strip()
                if not description:
                    continue

                # Resolve date
                m = TXN_DATE_RE.match(date_word["text"])
                assert m and period is not None
                txn_date = resolve_txn_date(m.group(1), int(m.group(2)), period[0], period[1])

                txns.append({
                    "date": txn_date.isoformat(),
                    "description": description,
                    "amount_signed": amount_signed,
                    "raw_row": [w["text"] for w in row_words],
                })

    meta = {
        "period": period,
        "starting_balance": starting_balance,
        "ending_balance": ending_balance,
    }
    return txns, meta


# ---------- Output ----------

def write_csv(txns: list[dict], out) -> None:
    writer = csv.writer(out)
    writer.writerow(["Date", "Description", "Amount"])
    for t in txns:
        writer.writerow([t["date"], t["description"], f"{t['amount_signed']:.2f}"])


def validate(txns: list[dict], meta: dict) -> tuple[bool, str]:
    actual_w = round(sum(-t["amount_signed"] for t in txns if t["amount_signed"] < 0), 2)
    actual_d = round(sum(t["amount_signed"] for t in txns if t["amount_signed"] > 0), 2)
    net = round(actual_d - actual_w, 2)
    start = meta.get("starting_balance")
    end = meta.get("ending_balance")

    msg_lines = [
        f"Period:                 {meta['period'][0]} -> {meta['period'][1]}" if meta.get("period") else "Period:                 (not detected)",
        f"Transactions parsed:    {len(txns)}",
        f"Withdrawals (parsed):   {actual_w:>12,.2f}",
        f"Deposits    (parsed):   {actual_d:>12,.2f}",
        f"Net change  (parsed):   {net:>+12,.2f}",
    ]
    if start is not None:
        msg_lines.append(f"Starting balance:       {start:>12,.2f}")
    if end is not None:
        msg_lines.append(f"Ending balance:         {end:>12,.2f}")

    ok = True
    if start is not None and end is not None:
        expected = round(end - start, 2)
        diff = round(net - expected, 2)
        msg_lines.append(f"Expected net (end-start):{expected:>+12,.2f}  diff={diff:+.2f}")
        if abs(diff) > 0.01:
            ok = False
    return ok, "\n".join(msg_lines)


# ---------- Main ----------

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("pdf_path", type=Path)
    p.add_argument("-o", "--output", type=Path, help="Write CSV to this path (default: stdout)")
    p.add_argument("--check", action="store_true", help="Validate against statement totals; do not emit CSV")
    args = p.parse_args()

    if not args.pdf_path.exists():
        print(f"ERROR: PDF not found: {args.pdf_path}", file=sys.stderr)
        return 2

    txns, meta = extract_transactions(args.pdf_path)
    ok, report = validate(txns, meta)

    print(report, file=sys.stderr)
    if not ok:
        print("WARNING: parsed totals do not match reported totals — review CSV before ingesting", file=sys.stderr)

    if args.check:
        return 0 if ok else 1

    if args.output:
        with args.output.open("w", encoding="utf-8", newline="") as f:
            write_csv(txns, f)
        print(f"Wrote {len(txns)} transactions → {args.output}", file=sys.stderr)
    else:
        write_csv(txns, sys.stdout)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
