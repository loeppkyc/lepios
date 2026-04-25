# Gmail Scanner — Acceptance Doc

Coordinator: Phase 1d
Date: 2026-04-24
Study doc: `docs/sprint-5/gmail-scanner-study.md`
Builder target: ship all items below in one commit

---

## Scope

v1 is the **statement-arrivals classifier only**.
Bills, receipts, ops correspondence, personal mail are deferred to separate chunks.
Build the scanner infrastructure reusable: future classifiers plug into it without
re-architecture — they add a new classifier module and a new output table.

---

## New Files

```
lib/gmail/client.ts
lib/gmail/scan.ts
lib/gmail/senders.ts
lib/gmail/classifiers/statement-arrivals.ts
app/api/cron/gmail-scan/route.ts
supabase/migrations/0022_add_gmail_tables.sql
tests/gmail-scanner.test.ts
```

---

## 1 — Auth (`lib/gmail/client.ts`)

**Package:** add `googleapis` to `package.json` dependencies.

**Function:** `createGmailService(): Promise<gmail_v1.Gmail>`

Implementation:

- Read `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` from `process.env`
- If any of the three are missing: throw `GmailNotConfiguredError` (typed class, message: `'Gmail env vars not set: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'`)
- Build `google.auth.OAuth2(clientId, clientSecret)`, call `setCredentials({refresh_token})`
- Return `google.gmail({version: 'v1', auth: oauthClient})`
- Server-side only — no client imports

**Export:** `GmailNotConfiguredError` class alongside `createGmailService`.

---

## 2 — Schema (`supabase/migrations/0022_add_gmail_tables.sql`)

### `gmail_known_senders`

```sql
CREATE TABLE gmail_known_senders (
  email_address  text        PRIMARY KEY,
  sender_type    text        NOT NULL DEFAULT 'other'
                             CHECK (sender_type IN ('invoice','inline_receipt','statement_arrival','other')),
  trust_level    text        NOT NULL DEFAULT 'review'
                             CHECK (trust_level IN ('trusted','review','ignore')),
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  notes          text,
  created_by     text        NOT NULL DEFAULT 'auto_detected'
                             CHECK (created_by IN ('migrated_from_sheets','auto_detected','colin_added'))
);
```

Seed rows from `utils/gmail.py` constants (all `created_by = 'migrated_from_sheets'`,
`trust_level = 'trusted'`):

- All 20 `KNOWN_INVOICE_SENDERS` domains → `sender_type = 'invoice'`
- All 40 `KNOWN_INLINE_SENDERS` domains → `sender_type = 'inline_receipt'`

Use `INSERT INTO gmail_known_senders (...) VALUES ... ON CONFLICT (email_address) DO NOTHING`
so re-running migration is safe.

Note: the seed values are domain strings (e.g. `td.com`, `amazon.ca`). The table stores
either full addresses or domains — both are valid keys for FROM-header matching.

### `gmail_messages`

Central store for all scanned messages across all classifiers.

```sql
CREATE TABLE gmail_messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   text        UNIQUE NOT NULL,   -- Gmail message ID (opaque string)
  from_address text        NOT NULL,
  subject      text        NOT NULL DEFAULT '',
  sent_at      timestamptz,
  has_attachment boolean   NOT NULL DEFAULT false,
  scanned_at   timestamptz NOT NULL DEFAULT now(),
  scan_labels  text[]      NOT NULL DEFAULT '{}'  -- classifiers that have processed this message
);

CREATE INDEX gmail_messages_message_id_idx ON gmail_messages (message_id);
CREATE INDEX gmail_messages_sent_at_idx    ON gmail_messages (sent_at DESC);
CREATE INDEX gmail_messages_from_idx       ON gmail_messages (from_address);
```

### `gmail_statement_arrivals`

Output table for the statement-arrivals classifier.

```sql
CREATE TABLE gmail_statement_arrivals (
  id                     uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id             text  NOT NULL REFERENCES gmail_messages(message_id),
  account_name           text  NOT NULL,
  statement_period_start date,
  statement_period_end   date,
  arrival_date           date  NOT NULL,
  attachment_name        text,              -- PDF filename if present, else null
  confidence             text  NOT NULL DEFAULT 'high'
                               CHECK (confidence IN ('high','medium')),
  detected_at            timestamptz NOT NULL DEFAULT now(),
  notes                  text,

  UNIQUE (message_id)  -- one arrival record per message
);

CREATE INDEX gmail_statement_arrivals_account_idx  ON gmail_statement_arrivals (account_name);
CREATE INDEX gmail_statement_arrivals_arrival_idx  ON gmail_statement_arrivals (arrival_date DESC);
```

**Confidence rules:**

- `high` — FROM address matches a known sender domain AND subject matches a pattern
- `medium` — subject matches a pattern but FROM address is not in `gmail_known_senders`

---

## 3 — Sender Constants (`lib/gmail/senders.ts`)

Export the two static lists verbatim from `utils/gmail.py`:

```typescript
export const KNOWN_INVOICE_SENDERS: string[] // 20 domains
export const KNOWN_INLINE_SENDERS: string[] // 40 domains
```

No logic. No imports. Pure constants. Consumed by `scan.ts` and `classifiers/`.

---

## 4 — Scanner (`lib/gmail/scan.ts`)

### `scanMessages(service, afterDate: Date, maxResults = 500): Promise<GmailMessage[]>`

Type `GmailMessage = { messageId: string; fromAddress: string; subject: string; sentAt: Date | null; hasAttachment: boolean }`

Two-pass query (identical to Streamlit):

- Pass 1: `after:{afterDate} subject:(invoice OR receipt OR bill OR statement OR confirmation OR order)`
- Pass 2: `after:{afterDate} (from:domain1 OR from:domain2 ...)` — from `KNOWN_INVOICE_SENDERS` + `KNOWN_INLINE_SENDERS`

Dedup by `messageId` across both passes. Return flat array, no DB writes.

### `filterNewMessages(messages: GmailMessage[], db: SupabaseClient): Promise<GmailMessage[]>`

SELECT `message_id` from `gmail_messages` WHERE `message_id = ANY(messageIds)`.
Return only messages NOT already present. This is the dedup gate.

### `insertMessages(messages: GmailMessage[], db: SupabaseClient): Promise<void>`

Batch INSERT into `gmail_messages`. `onConflict: 'message_id'` → ignore (idempotent).

---

## 5 — Statement-Arrivals Classifier (`lib/gmail/classifiers/statement-arrivals.ts`)

### Config type

```typescript
interface StatementArrivalAccount {
  account_name: string // e.g. 'TD Chequing'
  sender_domains: string[] // e.g. ['td.com', 'tdbank.com']
  subject_patterns: RegExp[] // e.g. [/e-?statement/i, /statement is ready/i]
}
```

### Placeholder accounts (Colin replaces with real accounts before v1 launch)

```typescript
const STATEMENT_ACCOUNTS: StatementArrivalAccount[] = [
  {
    account_name: 'TD Chequing',
    sender_domains: ['td.com', 'tdbank.com'],
    subject_patterns: [/e-?statement/i, /statement.*ready/i, /account statement/i],
  },
  {
    account_name: 'RBC Visa',
    sender_domains: ['rbc.com', 'rbcroyalbank.com'],
    subject_patterns: [/e-?statement/i, /statement.*available/i],
  },
  {
    account_name: 'AMEX',
    sender_domains: ['americanexpress.com', 'aexp.com'],
    subject_patterns: [/statement/i, /your.*statement/i],
  },
]
```

### `classifyStatementArrival(message: GmailMessage, knownSenders: Set<string>): StatementArrivalResult | null`

```typescript
interface StatementArrivalResult {
  account_name: string
  arrival_date: Date
  statement_period_start: Date | null // null — not extractable from subject alone
  statement_period_end: Date | null // null — not extractable from subject alone
  attachment_name: string | null
  confidence: 'high' | 'medium'
}
```

Match logic:

1. For each `StatementArrivalAccount`, check if `fromAddress` contains any `sender_domain`
2. Check if `subject` matches any `subject_pattern`
3. `high` = sender domain match AND subject pattern match
4. `medium` = subject pattern match only (sender not in `STATEMENT_ACCOUNTS` sender_domains)
5. `null` = no match

`statement_period_start` / `statement_period_end`: set to `null` in v1 — subject-line
date extraction is deferred. Chunk D v2 computes coverage from `arrival_date` only.

`attachment_name`: pass through from `GmailMessage.hasAttachment` — if true, the actual
filename requires a second Gmail API call. For v1, record `null` and note that attachment
names are deferred (Chunk D v2 can hydrate them from `message_id`).

### Insert

```typescript
insertStatementArrivals(results: StatementArrivalResult[], db: SupabaseClient): Promise<void>
```

Batch INSERT into `gmail_statement_arrivals`. `onConflict: 'message_id'` → ignore.
After insert, UPDATE `gmail_messages.scan_labels` to include `'statement_arrival'` for
each processed message_id.

---

## 6 — Cron Route (`app/api/cron/gmail-scan/route.ts`)

**Auth:** CRON_SECRET (same pattern as all cron routes in this codebase)
**Method:** GET only
**Schedule:** `"0 * * * *"` — add to `vercel.json`

Execution sequence:

1. `createGmailService()` — if `GmailNotConfiguredError`, log `agent_events` warning, return 200 (never crash cron)
2. `afterDate = new Date(Date.now() - 25 * 60 * 60 * 1000)` — 25h window for hourly cron overlap
3. `scanMessages(service, afterDate)` → raw message list
4. `filterNewMessages(messages, db)` → new messages only
5. `insertMessages(newMessages, db)`
6. For each new message: run `classifyStatementArrival(message, knownSendersSet)`
7. Collect results, `insertStatementArrivals(results, db)`
8. Log `agent_events`:
   ```
   action: 'gmail.scan'
   status: 'success'
   meta: {
     scanned: rawMessages.length,
     new_messages: newMessages.length,
     dedup_hits: rawMessages.length - newMessages.length,
     statement_arrivals_classified: results.length,
     duration_ms: <elapsed>
   }
   ```
9. `recordAttribution({actor_type: 'cron', actor_id: 'gmail-scan-cron'}, {entity_type: 'gmail_scan', entity_id: runId}, 'scan_completed', {scanned: n, classified: m})`
10. Return `{ok: true, scanned, new_messages, classified}`

On any Gmail API error mid-scan: log `agent_events` with `status: 'failure'`, return 200
(never 500 — cron retries on 5xx in Vercel).

`knownSendersSet`: load from `gmail_known_senders` WHERE `trust_level != 'ignore'` at cron
start. Used for confidence scoring only (not for filtering — all messages get classified).

---

## 7 — F17 Signal

- `gmail.scan` events in `agent_events` → utterance source for behavioral spec
- `gmail_statement_arrivals` rows → financial state signal: statement arrived = account active,
  `arrival_date` = reconciliation trigger date for Chunk D v2
- `gmail_known_senders.sender_type` → vendor activity correlation for path engine
  (Anthropic invoice = AI spend active; Shopify invoice = store active)

Declare in the route: `// F17: gmail.scan events feed behavioral ingestion; statement_arrivals feed financial state`

---

## 8 — F18 Measurement

| Metric                      | Captured where                                                          | Benchmark                                         |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| Scan latency p95            | `duration_ms` in `agent_events(action='gmail.scan')`                    | < 30s for 500 messages                            |
| Messages scanned per run    | `meta.scanned`                                                          | Baseline: first week establishes count            |
| New vs dedup ratio          | `meta.new_messages / meta.scanned`                                      | Target < 10% new after first week (stable corpus) |
| Statement arrivals per scan | `meta.statement_arrivals_classified`                                    | Alert if 0 for 7 consecutive days                 |
| Classification precision    | Manual: Colin marks false positives in `gmail_statement_arrivals.notes` | Target > 95% high-confidence correct              |

Surfacing path: Colin asks → query `agent_events WHERE action='gmail.scan' ORDER BY occurred_at DESC LIMIT 30`.

---

## 9 — Attribution

Every scan run:

```typescript
recordAttribution(
  { actor_type: 'cron', actor_id: 'gmail-scan-cron' },
  { entity_type: 'gmail_scan', entity_id: runId },
  'scan_completed',
  { scanned, classified }
)
```

Every statement arrival insertion (batch call once per cron run, not per row):

```typescript
recordAttribution(
  { actor_type: 'cron', actor_id: 'gmail-scan-cron' },
  { entity_type: 'gmail_statement_arrival', entity_id: 'batch' },
  'classified',
  { count: results.length }
)
```

Both fire-and-forget (`void`). Never throw.

---

## 10 — Tests (`tests/gmail-scanner.test.ts`)

All Gmail API calls mocked. No real network calls.

| Test                                                      | Expectation                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| New message inserted to `gmail_messages`                  | `INSERT` called with correct fields                         |
| Duplicate `message_id` skipped                            | `filterNewMessages` returns empty array for known ID        |
| `classifyStatementArrival` — sender + subject match       | Returns `StatementArrivalResult` with `confidence: 'high'`  |
| `classifyStatementArrival` — subject match only           | Returns result with `confidence: 'medium'`                  |
| `classifyStatementArrival` — no match                     | Returns `null`                                              |
| Missing env vars                                          | `createGmailService()` throws `GmailNotConfiguredError`     |
| Gmail API error mid-scan                                  | Cron logs failure to `agent_events`, returns 200 (no throw) |
| `statement_arrivals_classified` count in agent_events log | Matches number of non-null classify results                 |

---

## 11 — `vercel.json` Change

Add to crons array:

```json
{
  "path": "/api/cron/gmail-scan",
  "schedule": "0 * * * *"
}
```

---

## 12 — Commit Message

```
feat(gmail): scanner infrastructure + statement-arrivals classifier

- googleapis npm added; lib/gmail/client.ts refresh_token auth
- lib/gmail/scan.ts: two-pass message scan, dedup gate
- lib/gmail/senders.ts: KNOWN_INVOICE/INLINE_SENDERS constants
- lib/gmail/classifiers/statement-arrivals.ts: per-account config, high/medium confidence
- app/api/cron/gmail-scan: hourly cron, 25h window, F17/F18 instrumented
- migrations/0022: gmail_known_senders (seeded), gmail_messages, gmail_statement_arrivals
- Attribution on every scan run
- PLACEHOLDER accounts in statement-arrivals config — Colin to replace before launch
```

---

## 13 — Builder Notes

1. `googleapis` types are in `@types/googleapis` — check if bundled with `googleapis` package
   before adding a separate types dep.
2. `statement_period_start` / `statement_period_end` are `null` in v1. Do not attempt regex
   date extraction from subject — deferred explicitly.
3. `attachment_name` is `null` in v1. The Gmail `has:attachment` flag is captured in
   `gmail_messages.has_attachment`; the actual filename requires a second API call not in scope.
4. Placeholder accounts in `STATEMENT_ACCOUNTS` must compile and pass tests. Colin replaces
   domains/patterns with real values before declaring the feature live.
5. `knownSendersSet` passed to classifier is a `Set<string>` of email_address values from
   `gmail_known_senders`. Used for confidence scoring only.
6. Do NOT read `utils/gmail.py` for implementation patterns — it uses Python/Streamlit idioms.
   Follow the TypeScript specs above.
