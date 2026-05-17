# IBKR Flex Query API — Research + Recommendation
## E10 Part 3

task_id: f6b7bfdb-5563-40cf-b31b-17abb7b5ab3f  
Produced by: coordinator  
Date: 2026-05-17

---

## Question

Colin uses Interactive Brokers (IBKR) for real trades. How should LepiOS pull P&L data automatically? Polling vs webhook?

---

## Answer: Polling only (IBKR does not offer webhooks)

IBKR provides two data APIs relevant to trade history:

### Option A — IBKR Flex Web Service (recommended)

**What it is:** A scheduled-report query service. You define a Flex Query in IBKR Account Management (Reports → Flex Queries), assign a query ID, and query it via REST.

**Endpoint:** `https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest`

**Auth:** Flex token (long-lived string, ~2000 chars, generated in Account Management → Reports → Flex Queries → Tokens). Token + query_id are the only credentials needed — no OAuth, no session management.

**Two-step flow:**
```
Step 1: POST ?v=3&t={token}&q={query_id}&f=xml
Response: <FlexStatementResponse Status="Success"><ReferenceCode>1234567</ReferenceCode>...
```
```
Step 2 (after ~30s delay): POST ?v=3&t={token}&q={query_id}&s={referenceCode}
Response: full XML report
```

**Rate limit:** 1 request per 30 minutes per token. Do not retry step 1 rapidly — use the reference code from step 1.

**Report contents (TradeConfirm or ActivityStatement):**
- `datetime`, `symbol`, `description`, `conid`
- `exchange`, `currency`
- `tradePrice`, `quantity`, `tradeMoney` (total value)
- `buySell` (BUY/SELL), `commission`, `netCash`
- `openCloseIndicator` (O=open, C=close)
- `fifoPnlRealized` (realized P&L per close)

**Mapping to LepiOS:**
```
symbol     → ticker (e.g. "MESM5" → normalize to "ES=F")
tradePrice → price_in (BUY) or price_out (SELL)
tradeMoney → dollar_pl input
fifoPnlRealized → dollar_pnl (for closed trades)
commission → cost info (store in comments or separate col)
datetime   → trade_date
```

### Option B — TWS API (websocket-based, real-time)

**What it is:** TWS (Trader Workstation) must be running locally and logged in. Programmatic connection via ibapi Python/Java SDK or similar.

**Verdict: not recommended.** Requires TWS running 24/7. Not viable for a server-side cron. No headless option without IB Gateway (a separate app).

### Option C — Client Portal API (REST)

IBKR's newer REST API with OAuth2. Available but:
- Requires periodic re-auth (sessions expire ~24h)
- More complex than Flex for historical data
- Rate limits more restrictive

**Verdict: not recommended for batch P&L sync.** Better for real-time order status.

---

## Recommendation

**Use IBKR Flex Web Service (Option A).**

**Implementation plan:**
1. Colin creates a Flex Query in IBKR Account Management → Reports → Flex Queries. Recommended query type: `TradeConfirm` for individual fills. Include: `datetime, symbol, tradePrice, quantity, tradeMoney, buySell, commission, fifoPnlRealized`.
2. Colin saves `IBKR_FLEX_TOKEN` and `IBKR_FLEX_QUERY_ID` to `harness_config`.
3. New cron `/api/cron/ibkr-sync` runs daily at 9pm MT (3am UTC next day — well after 3:30pm ET close + 5h buffer):
   - Step 1: request report → get reference code
   - Sleep 30s → Step 2: retrieve report
   - Parse XML → upsert into `trading_journal` with `_source='ibkr'`
4. Dedup key: `(datetime, symbol, tradePrice, quantity)` — IBKR executions are unique on these four fields.

**Why 9pm MT:** IBKR only includes completed sessions. Real-time is not the use case — daily reconciliation is. By 9pm MT, any day's fills are settled in the report.

**Handling MES contracts:**
IBKR reports MES as `MESM5`, `MESU5` etc. (expiry-coded). Normalize on ingest: strip expiry suffix, map to `ES=F` for LepiOS ticker. Builder should add a `normalizeIbkrTicker()` helper.

---

## Config keys needed

| Key | Where | Value |
|---|---|---|
| `IBKR_FLEX_TOKEN` | harness_config | ~2000-char token from IBKR Account Management |
| `IBKR_FLEX_QUERY_ID` | harness_config | 5–8 digit query ID |

Both are sensitive credentials. Store in `harness_config`, not Vercel env (consistent with `CRON_SECRET` pattern — F-L2 prevention).

---

## Polling vs webhook verdict

**Polling.** IBKR has no webhook/push mechanism for Flex Queries. Client Portal API supports streaming for live order status (different use case). For P&L reconciliation: polling once per day is correct.

---

## Grounding checkpoint for this research

Before building the IBKR sync route:
1. Colin creates a Flex Query in IBKR Account Management and confirms the query ID.
2. Colin runs a manual test query via curl:
   ```
   curl "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?v=3&t={TOKEN}&q={QUERY_ID}&f=xml"
   ```
   Confirms response contains `<ReferenceCode>`.
3. Colin confirms `tradeMoney`/`fifoPnlRealized` fields are present in the returned XML.

Without step 2–3 verified live, the builder is writing against an untested API.
