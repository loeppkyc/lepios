# Receipts — F18 Metrics

**Domain:** `receipts`  
**F18 benchmark target:** OCR success rate ≥ 90% (confidence ≥ 0.67 = 4/6 fields extracted)

## Read query — 30-day OCR performance

```sql
SELECT
  action,
  status,
  count(*)                                                  AS events,
  round(avg((meta->>'confidence')::numeric), 2)            AS avg_confidence,
  round(avg(duration_ms))                                  AS avg_ms,
  min(created_at AT TIME ZONE 'America/Edmonton')          AS first_mt,
  max(created_at AT TIME ZONE 'America/Edmonton')          AS last_mt
FROM agent_events
WHERE domain = 'receipts'
  AND created_at > now() - interval '30 days'
GROUP BY action, status
ORDER BY action, status;
```

## Interpretation

| action                | status    | Meaning                                                                          |
| --------------------- | --------- | -------------------------------------------------------------------------------- |
| `receipt.ocr.success` | `success` | Claude extracted OCR data; `avg_confidence` = fraction of 6 fields populated     |
| `receipt.ocr.failed`  | `error`   | OCR call or JSON parse failed; `meta.error_class` = `api_error` or `parse_error` |

**Pass criterion:** `receipt.ocr.success` row count ÷ total OCR events ≥ 90% over any trailing 30-day window.

## Morning digest hook

The morning digest should surface: "Receipts OCR: X scans, Y% success, avg confidence Z."  
Reads from `agent_events WHERE domain='receipts' AND created_at > now() - interval '7 days'`.
