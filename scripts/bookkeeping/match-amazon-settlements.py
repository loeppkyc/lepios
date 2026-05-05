"""
Match AMAZON MSP deposits in `pending_transactions` to their corresponding
`amazon_settlements` rows by net_payout amount + nearby period_end_at.

A typical TD Chequing deposit lands 1-2 business days after the SP-API
period_end_at. We look back up to 7 calendar days from the deposit date
and find a settlement whose net_payout matches the deposit amount within
1 cent.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
    python match-amazon-settlements.py [--dry-run] [--days 7] [--from YYYY-MM-DD]

Output:
  Per-deposit decision (matched / ambiguous / no match) and a summary line.
  Sets pending_transactions.amazon_settlement_id on matched rows.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta


def supabase_request(method: str, path: str, payload=None, params=None):
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{base}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        return e.code, body


def fetch_unmatched_amazon_deposits(date_from: str | None) -> list[dict]:
    """Find AMAZON MSP deposits in pending_transactions with no settlement linked."""
    params = {
        "select": "id,txn_date,description,amount_signed,source_account,amazon_settlement_id,status",
        "source_account": "eq.TD CHEQUING (9150)",
        "description": "ilike.AMAZON MSP*",
        "amount_signed": "gt.0",
        "amazon_settlement_id": "is.null",
        "order": "txn_date.asc",
    }
    if date_from:
        params["txn_date"] = f"gte.{date_from}"
    status, body = supabase_request("GET", "/rest/v1/pending_transactions", params=params)
    if status != 200 or not isinstance(body, list):
        print(f"ERROR: failed to fetch deposits — status={status} body={body}", file=sys.stderr)
        sys.exit(2)
    return body


def fetch_settlements_in_window(start: date, end: date) -> list[dict]:
    """Fetch settlements whose period_end_at falls between start and end (inclusive)."""
    params = {
        "select": "id,period_start_at,period_end_at,net_payout,currency,fund_transfer_status",
        "period_end_at": f"gte.{start.isoformat()}T00:00:00Z",
        # period_end_at < end+1 day to make end-inclusive
        "order": "period_end_at.asc",
        "currency": "eq.CAD",
    }
    end_exclusive = (end + timedelta(days=1)).isoformat()
    # supabase REST doesn't accept two filters on the same column via duplicate keys in a dict;
    # use explicit string concat
    qs = urllib.parse.urlencode(params)
    qs += f"&period_end_at=lt.{end_exclusive}T00:00:00Z"
    url = f"/rest/v1/amazon_settlements?{qs}"
    status, body = supabase_request("GET", url)
    if status != 200 or not isinstance(body, list):
        print(f"ERROR: failed to fetch settlements — status={status} body={body}", file=sys.stderr)
        sys.exit(2)
    return body


def parse_iso_date(s: str) -> date:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).date()


def find_match(deposit: dict, settlements: list[dict], lookback_days: int) -> tuple[str | None, list[dict]]:
    """Return (settlement_id, candidates) or (None, ambiguous_or_empty_candidates)."""
    deposit_date = date.fromisoformat(deposit["txn_date"])
    deposit_amount = round(float(deposit["amount_signed"]), 2)
    candidates = []
    for s in settlements:
        if s.get("fund_transfer_status") not in ("Succeeded", "Released"):
            continue
        s_period_end = parse_iso_date(s["period_end_at"])
        if not (deposit_date - timedelta(days=lookback_days) <= s_period_end <= deposit_date):
            continue
        if abs(round(float(s["net_payout"]), 2) - deposit_amount) > 0.01:
            continue
        candidates.append(s)
    if len(candidates) == 1:
        return candidates[0]["id"], candidates
    return None, candidates


def link(deposit_id: str, settlement_id: str, dry_run: bool) -> bool:
    if dry_run:
        return True
    status, body = supabase_request(
        "PATCH",
        f"/rest/v1/pending_transactions?id=eq.{deposit_id}",
        payload={"amazon_settlement_id": settlement_id},
    )
    if status not in (200, 204):
        print(f"  WARN: link failed for {deposit_id} → {settlement_id}: status={status} body={body}", file=sys.stderr)
        return False
    return True


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--days", type=int, default=7, help="Lookback window from deposit date (default 7)")
    p.add_argument("--from", dest="date_from", help="Only consider deposits on or after this date (YYYY-MM-DD)")
    args = p.parse_args()

    deposits = fetch_unmatched_amazon_deposits(args.date_from)
    if not deposits:
        print("No unmatched AMAZON MSP deposits to process.")
        return 0

    earliest = min(date.fromisoformat(d["txn_date"]) for d in deposits)
    latest = max(date.fromisoformat(d["txn_date"]) for d in deposits)
    settlements = fetch_settlements_in_window(earliest - timedelta(days=args.days), latest)

    print(f"Unmatched deposits: {len(deposits)} ({earliest} → {latest})")
    print(f"Settlements in window: {len(settlements)}")
    print()

    matched = ambiguous = no_match = link_failed = 0
    for d in deposits:
        sid, candidates = find_match(d, settlements, args.days)
        amount = float(d["amount_signed"])
        if sid:
            ok = link(d["id"], sid, args.dry_run)
            if ok:
                matched += 1
                tag = "MATCH (dry-run)" if args.dry_run else "MATCH"
                print(f"  {tag:18s} {d['txn_date']}  ${amount:>9,.2f}  → settlement {sid[:16]}…")
            else:
                link_failed += 1
        elif len(candidates) > 1:
            ambiguous += 1
            print(f"  AMBIGUOUS         {d['txn_date']}  ${amount:>9,.2f}  → {len(candidates)} candidates")
            for c in candidates:
                print(f"    candidate: settlement {c['id'][:16]}…  net_payout=${float(c['net_payout']):,.2f}  end={parse_iso_date(c['period_end_at'])}")
        else:
            no_match += 1
            print(f"  NO MATCH          {d['txn_date']}  ${amount:>9,.2f}")

    print()
    print(f"Matched:    {matched}")
    print(f"Ambiguous:  {ambiguous}")
    print(f"No match:   {no_match}")
    if link_failed:
        print(f"Link write failed: {link_failed}")
    if args.dry_run:
        print("(dry-run — no DB writes)")

    return 0 if (ambiguous + link_failed) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
