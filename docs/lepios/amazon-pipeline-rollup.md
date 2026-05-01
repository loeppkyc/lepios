# LepiOS Amazon Pipeline — Component Rollup

Last recomputed: 2026-04-30 (updated)
Owner: Colin
Cadence: recompute after each PR merge or meaningful state change

## Purpose

Trustworthy Amazon books and taxes. Six-week pipeline:
COGS → Gmail scanner → financial events → reconciliation → tax outputs → anomaly detection.

Reconciliation is the keystone — without it the pipeline is disconnected ingestion.

## Rollup

| # | Component | Weight | % Complete | Contribution | Evidence |
|---|---|---|---|---|---|
| 1 | COGS backend (table, API, lib, actions) | 8 | 70% | 5.60 | PR #42 open, 7 files, 561 lines, tests pass |
| 2 | COGS UI (page.tsx, nav, form) | 6 | 0% | 0.00 | not started |
| 3 | COGS recompute / backfill | 4 | 70% | 2.80 | endpoint shipped in PR #42, untested on prod |
| 4 | Gmail invoice classifier | 6 | 70% | 4.20 | PR #40 open, 41 tests pass, prod validation deferred |
| 5 | Gmail receipt classifier | 6 | 70% | 4.20 | shipped with #40 |
| 6 | Gmail OAuth + Vercel env wiring | 4 | 0% | 0.00 | blocker for #40 validation |
| 7 | Gmail daily scanner (cron + ingest) | 8 | 60% | 4.80 | PR #44 open (audit + watermark), statement classifier already on main |
| 8 | SP-API financial events parser | 8 | 70% | 5.60 | PR #43 open, 34 tests pass |
| 9 | SP-API backfill script | 4 | 70% | 2.80 | shipped in PR #43, $0.01 gate |
| 10 | Financial events migration (0057) | 2 | 70% | 1.40 | shipped in PR #43, pure DDL |
| 11 | Reconciliation engine (orders ↔ events ↔ COGS) | 10 | 0% | 0.00 | keystone — not started |
| 12 | Reconciliation UI / drift report | 6 | 0% | 0.00 | not started |
| 13 | GST calc module | 6 | 70% | 4.20 | PR #39 open, 68 tests, $0 drift |
| 14 | GST UI / business-review surfacing | 4 | 10% | 0.40 | partial — /business-review exists, low-contrast bug |
| 15 | Income tax / CPP projection | 6 | 0% | 0.00 | baseline ~$2,100, no module |
| 16 | Tax export / filing outputs | 4 | 0% | 0.00 | not started |
| 17 | Anomaly detection (refunds, fees, missing COGS) | 8 | 0% | 0.00 | not started |
| 18 | Historical product intel (SP-API + Keepa re-source) | 6 | 0% | 0.00 | backlog |
| 19 | Per-component metrics + benchmarks (F18) | 4 | 20% | 0.80 | build_metrics shipped, Amazon-specific not wired |
| **Total** | | **110** | | **37.00** | |

**Rollup: 33.6% complete · 73.00 points remaining**

## Notes

- Weights reflect leverage, not effort. Reconciliation is 10 because it makes everything else trustworthy.
- "% complete" caps at 70 for any component still in open-PR state — not merged means not shipped.
- F18 audit: every Amazon component must ship with metrics + benchmark + surfacing path. Row 19 tracks the shared metrics layer.
- F19 audit: every component evaluated for 20% faster/cheaper/better at quarterly review.
- Audit-first pattern: every external integration (SP-API, Gmail, Keepa) requires a Streamlit cross-check before "% complete" exceeds 50. SP-API financial events is greenfield — no Streamlit baseline; backfill $0.01 gate is the verification mechanism.

## History

- 2026-04-30: v1 created. 29.3% rollup. PRs #38/#39/#40/#42/#43 open, none merged.
- 2026-04-30 (later): row 7 corrected from 0% (was missing pre-existing statement classifier) + PR #44 audit/watermark = 60%. Rollup 33.6%.
