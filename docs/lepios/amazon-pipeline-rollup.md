# LepiOS Amazon Pipeline — Component Rollup

Last recomputed: 2026-05-01 (row 6 → 100%; row 11 → 25% acceptance doc PR #52; row 17 → 25% acceptance doc PR #55)
Owner: Colin
Cadence: recompute after each PR merge or meaningful state change

## Purpose

Trustworthy Amazon books and taxes. Six-week pipeline:
COGS → Gmail scanner → financial events → reconciliation → tax outputs → anomaly detection.

Reconciliation is the keystone — without it the pipeline is disconnected ingestion.

## Rollup

| #         | Component                                            | Weight  | % Complete | Contribution | Evidence                                                                                |
| --------- | ---------------------------------------------------- | ------- | ---------- | ------------ | --------------------------------------------------------------------------------------- |
| 1         | COGS backend (table, API, lib, actions)              | 8       | 100%       | 8.00         | PR #42 merged                                                                           |
| 2         | COGS UI (page.tsx, nav, form) — superseded by row 20 | 6       | 0%         | 0.00         | original page superseded by COGS v2 (#45)                                               |
| 3         | COGS recompute / backfill                            | 4       | 90%        | 3.60         | merged in #42, prod data untested                                                       |
| 4         | Gmail invoice classifier                             | 6       | 90%        | 5.40         | PR #40 merged, prod validation pending OAuth component #6                               |
| 5         | Gmail receipt classifier                             | 6       | 90%        | 5.40         | PR #40 merged, same as row 4                                                            |
| 6         | Gmail OAuth + Vercel env wiring                      | 4       | 100%       | 4.00         | env vars configured 2026-05-01; rows 4+5 classifier quality validation open             |
| 7         | Gmail daily scanner (cron + ingest)                  | 8       | 75%        | 6.00         | PR #44 merged (audit + watermark); invoice/receipt classifier integration still pending |
| 8         | SP-API financial events parser                       | 8       | 100%       | 8.00         | PR #43 merged, 34 tests pass                                                            |
| 9         | SP-API backfill script                               | 4       | 100%       | 4.00         | PR #43 merged, $0.01 gate                                                               |
| 10        | Financial events migration (0057)                    | 2       | 100%       | 2.00         | PR #43 merged, pure DDL                                                                 |
| 11        | Reconciliation engine (orders ↔ events ↔ COGS)       | 10      | 25%        | 2.50         | keystone — acceptance doc landed (PR #52); builder not started                          |
| 12        | Reconciliation UI / drift report                     | 6       | 0%         | 0.00         | not started                                                                             |
| 13        | GST calc module                                      | 6       | 100%       | 6.00         | PR #39 merged, 68 tests, $0 drift                                                       |
| 14        | GST UI / business-review surfacing                   | 4       | 10%        | 0.40         | partial — /business-review exists, low-contrast bug                                     |
| 15        | Income tax / CPP projection                          | 6       | 0%         | 0.00         | baseline ~$2,100, no module                                                             |
| 16        | Tax export / filing outputs                          | 4       | 0%         | 0.00         | not started                                                                             |
| 17        | Anomaly detection (refunds, fees, missing COGS)      | 8       | 25%        | 2.00         | acceptance doc landed (PR #55); builder gated on row 11 (reconciled_orders_view)        |
| 18        | Historical product intel (SP-API + Keepa re-source)  | 6       | 0%         | 0.00         | backlog                                                                                 |
| 19        | Per-component metrics + benchmarks (F18)             | 4       | 40%        | 1.60         | build_metrics on main via #38, Amazon-specific not wired                                |
| 20        | COGS v2 — Inventory page (live FBA + FIFO)           | 6       | 80%        | 4.80         | PR #45 merged; FBA QTY bug under investigation                                          |
| 21        | COGS v2 — Pallet invoices                            | 4       | 90%        | 3.60         | PR #45 merged, awaiting first prod entry                                                |
| **Total** |                                                      | **120** |            | **67.30**    |                                                                                         |

**Rollup: 56.1% complete · 52.70 points remaining**

## Notes

- Weights reflect leverage, not effort. Reconciliation is 10 because it makes everything else trustworthy.
- "% complete" caps at 70 for any component still in open-PR state — not merged means not shipped.
- Row 2 (original COGS UI) superseded by row 20 (COGS v2 inventory + FIFO). Weight retained to avoid inflating total.
- F18 audit: every Amazon component must ship with metrics + benchmark + surfacing path. Row 19 tracks the shared metrics layer.
- F19 audit: every component evaluated for 20% faster/cheaper/better at quarterly review.
- Audit-first pattern: every external integration (SP-API, Gmail, Keepa) requires a Streamlit cross-check before "% complete" exceeds 50. SP-API financial events is greenfield — no Streamlit baseline; backfill $0.01 gate is the verification mechanism.

## History

- 2026-04-30: v1 created. 29.3% rollup. PRs #38/#39/#40/#42/#43 open, none merged.
- 2026-04-30 (later): row 7 corrected from 0% (was missing pre-existing statement classifier) + PR #44 audit/watermark = 60%. Rollup 33.6%.
- 2026-04-30 (post-merge wave): #38, #39, #40, #42, #43, #44, #45 all merged. Rollup recomputed.
- 2026-05-01: row 6 (Gmail OAuth) corrected to 100% (env vars configured; was stale at 0%). row 11 (Reconciliation engine) 0% → 25% (acceptance doc landed, PR #52). Rollup 54.4%.
- 2026-05-01 (later): row 17 (Anomaly detection) 0% → 25% (acceptance doc landed, PR #55). Rollup 56.1%.
