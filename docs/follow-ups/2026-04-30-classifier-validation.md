# Classifier Validation — Gmail Invoice + Receipt

**Created:** 2026-04-30
**Branch:** feature/gmail-classifiers-week1
**Status:** PARTIALLY RESOLVED 2026-05-01 — OAuth configured; classifier quality check open

---

## Resolution log — 2026-05-01

**Step 1 (Gmail OAuth) — COMPLETE.**
Root cause: `client_id`, `client_secret`, `refresh_token` were stored in Vercel under the wrong
names (raw secrets.toml field names, not the `GOOGLE_` prefix the code expects). Values were
also empty. Fixed by sourcing from `streamlit_app/.streamlit/secrets.toml` and adding as
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`. F15 CRLF artifact present
(2 extra bytes per var) but `.trim()` in `lib/gmail/client.ts:19-21` handles it. Redeployed to
production (`dpl_AGZHXA3rQd2iEoeW2WGM8jWcGHNM`).

Cron smoke test: `{"ok":true,"scanned":3,"new_messages":3,"status":"ok"}` — Gmail authenticated.

**Step 2 dry-run — OPEN. Classifier quality below acceptance bar.**
Dry-run (2026-04-01 to 2026-05-01, 43 messages):
- Invoices: 0 high, 0 medium, 0 low — FAIL (bar: ≥1 high + ≥1 medium)
- Receipts: 11 high, 19 medium — count PASS; spot-check ~6/10 — FAIL (bar: ≥8/10)
- False positives in HIGH bucket: Cineplex password-reset, Walmart marketplace reactivation email
- False positives in MEDIUM bucket: Santevia shipment notification, Walmart order-on-the-way

Per the acceptance blocker rule: do NOT merge `feature/gmail-classifiers-week1` to main and
do NOT wire invoice/receipt classifiers into the production cron until false-positive patterns
are investigated. Rows 4+5 in the Amazon pipeline stay at 90%.

**Next action for Colin:** review false-positive patterns in the receipt classifier
(`lib/gmail/classifiers/receipt.ts`) — Cineplex and Walmart reactivation should not hit HIGH
confidence. Check keyword/sender rules that caused these to score high.

---

## Why this exists

The Phase C build of the Gmail invoice + receipt classifiers (migration 0055) was completed and
unit-tested (41/41 green), but the live Phase D spot-check could not be run because
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` have never been
configured in Vercel for LepiOS. Every production `gmail.scan` cron run has returned
`status='warning' / gmail_not_configured`.

**This validation is required before relying on classified data for downstream tax,
invoice-matching, or bookkeeping work.** Do not treat the gmail_invoice_classifications or
gmail_receipt_classifications tables as production-quality data until this is completed.

---

## Step 1 — Add Google OAuth credentials to Vercel

Source: `streamlit_app/.streamlit/secrets.toml` section `[gmail]`

Fields to port to Vercel env vars:

| secrets.toml field | Vercel env var name    |
| ------------------ | ---------------------- |
| `client_id`        | `GOOGLE_CLIENT_ID`     |
| `client_secret`    | `GOOGLE_CLIENT_SECRET` |
| `refresh_token`    | `GOOGLE_REFRESH_TOKEN` |

**F15 warning (Windows Vercel CLI trailing-whitespace bug):** Do NOT use `vercel env add`
interactively on Windows — it embeds `\r\n` in the stored value, causing Google to reject
the credentials as `invalid_client`. Instead:

```bash
# Write value to a temp file with no trailing newline, then pipe it in:
printf 'YOUR_VALUE_HERE' > /tmp/gval.txt
vercel env add GOOGLE_CLIENT_ID production < /tmp/gval.txt
vercel env add GOOGLE_CLIENT_SECRET production < /tmp/gval.txt
vercel env add GOOGLE_REFRESH_TOKEN production < /tmp/gval.txt
rm /tmp/gval.txt
```

After adding, pull and verify char count matches the source value:

```bash
vercel env pull .env.verify
wc -c <<< "$(grep GOOGLE_CLIENT_ID .env.verify | cut -d= -f2 | tr -d '"')"
# Must match character count of client_id in secrets.toml
rm .env.verify
```

---

## Step 2 — Run the dry-run spot-check

After pulling production env vars locally:

```bash
# Pull production env (includes the new Google creds)
npx vercel env pull .env.dryrun --environment=production

# Run dry-run (no DB writes — classification only)
npx tsx --env-file=.env.dryrun scripts/classify-dryrun.ts
rm .env.dryrun
```

The script will output:

- Classification counts by confidence tier (invoice high/medium/low, receipt high/medium)
- Skipped count (unclassified messages)
- 10 sample invoice classifications (message_id, from, subject, attachment_name, confidence)
- 10 sample receipt classifications (message_id, from, subject, body_preview, confidence)

---

## Step 3 — Acceptance criteria (from Phase A approval)

**Invoice counts — minimum signal to consider the classifier working:**

- At least 1 high-confidence invoice classified (trusted sender with PDF)
- At least 1 medium-confidence classified (review-level sender or keyword-only)
- Spot-check: 8/10 invoice samples should correctly identify a real invoice/receipt
  attachment (not a signature logo, not a promo). Reject if > 3 junk attachments in sample.

**Receipt counts — minimum signal:**

- At least 1 high-confidence receipt (walmart.ca / amazon.ca / similar trusted inline sender)
- Spot-check: 8/10 receipt samples should have body text that actually looks like a receipt
  (contains dollar amounts, vendor name, line items). Reject if body_text looks like a
  newsletter or promotional email.

**Learning loop:**

- At least 1 new sender domain written to gmail_known_senders with trust_level='review',
  created_by='classifier' (confirms the learning loop fired)

**Blocker:** if spot-check accuracy < 8/10 on either classifier, do not merge to main and
investigate the false-positive patterns before relying on this data downstream.

---

## Step 4 — After passing spot-check

1. Complete Phase D review with Colin — share counts + 10/10 sample output
2. Merge `feature/gmail-classifiers-week1` to main
3. Trigger one manual production cron run to validate end-to-end:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
        https://lepios-one.vercel.app/api/cron/gmail-scan
   ```
4. Query results:
   ```sql
   SELECT confidence, COUNT(*) FROM gmail_invoice_classifications GROUP BY confidence;
   SELECT confidence, COUNT(*) FROM gmail_receipt_classifications GROUP BY confidence;
   SELECT email_address, sender_type FROM gmail_known_senders
     WHERE created_by = 'classifier' ORDER BY last_seen_at DESC LIMIT 10;
   ```
5. If counts look reasonable: close this follow-up

---

## Notes

- `scripts/classify-dryrun.ts` runs the classifiers without any DB writes — safe to run
  multiple times
- Migration 0055 is already applied to production Supabase — tables are ready
- The 25h scan window in the cron will only catch recent emails. For a historical backfill
  of last 30 days, use the dry-run script (which scans 30 days) or temporarily extend the
  `afterDate` in the cron for one run
- `GOOGLE_REFRESH_TOKEN` does not expire unless revoked — once set, it works indefinitely
