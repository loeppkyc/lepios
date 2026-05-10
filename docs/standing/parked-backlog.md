# Parked Backlog — LepiOS

**Last updated:** 2026-05-10  
**Source:** T6 rollup track — parsed by `scripts/rollup/sources/t6-parked-backlog.ts`  
**Scoring:** `delivered` or `dropped` = resolved (1 pt each); `active` = in-progress (0.5 pt); `parked` = unresolved (0 pt).  
T6% = (sum of pts / total items) × 100. Currently 41 items.

<!-- Machine-readable anchor — do not remove or reformat this line -->

## Backlog Progress: 0.0 / 100

---

## How to update

1. Change an item's `[parked]` tag to `[active]`, `[delivered]`, or `[dropped]`.
2. Recompute: `resolved_pts / 41 × 100` and update the header above.
3. Run `POST /api/admin/rollup/refresh` to push new T6% into master-rollup.

---

## Tier A — Standalone Product Ideas (9 items)

| ID  | Item                                                                             | State    | Notes                                                  |
| --- | -------------------------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| A1  | AI Amazon seller legal tool — suspensions, appeals, PoA drafts                   | [parked] | High-value if business grows                           |
| A2  | AI building permit pre-screener — Edmonton zoning/bylaw lookup                   | [parked] |                                                        |
| A3  | dev_market_intel — pricing intel on Upwork/Toptal/Fiverr completed jobs          | [parked] | Hard: no public completed-job data feeds               |
| A4  | Internal status page — per-component uptime, 90-day history bars                 | [parked] |                                                        |
| A5  | AI Control Center — governance dashboard, agent audit trail, capability grant UI | [parked] |                                                        |
| A6  | GitHackers — GitHub trending / HN jobs (name only, no spec)                      | [parked] | Park until resurfaced with clearer intent              |
| A7  | Predictive behavioral engine — number-guessing widget for sports betting         | [parked] | From past chats; no spec or DB entry found             |
| A8  | Edmonton free events scanner — Open Data + Eventbrite integration                | [parked] |                                                        |
| A9  | MileIQ CSV/PDF drive analyzer — CRA mileage deduction tool                       | [parked] | Auto-categorize business vs personal; export for T2044 |

## Tier B — Data & Infrastructure (9 items)

| ID  | Item                                                                          | State    | Notes                                                                               |
| --- | ----------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| B1  | Ollama Analyst System Prompt — qwen2.5:32b hardened against sycophancy        | [parked] | Files prepared at lib/llm/ + infra/ollama/; waiting Colin go-signal                 |
| B2  | Daily Gmail Scanner — receipts/invoices/statements foundation                 | [parked] | Blocks T-003 Receipts (T-003 depends on this)                                       |
| B3  | Training pipeline — LoRA fine-tune 7B on LepiOS corpus                        | [parked] | Gates: GPU acquisition + 6-mo corpus + fine-tuning skills                           |
| B4  | Arbitrage training corpus — structured reselling decision capture             | [parked] | ~10% ad-hoc; schema not defined                                                     |
| B5  | Square webhook ingestion — in-person sales via Colin's Square terminal        | [parked] | Gates on local_sales (T3 migration 0062)                                            |
| B6  | Custom MCP server for LepiOS — Supabase schema + harness as Claude Code tools | [parked] | Closes paste-loop bottleneck; eliminates Claude Code ↔ Claude API pasting           |
| B7  | CI/CD pipeline — GitHub Actions PR-level CI                                   | [parked] | Currently ~20%: Vercel auto-deploy + husky. PR-level CI is independent of local env |
| B8  | 1Password MCP integration — secrets + credentials via MCP tool                | [parked] | No spec; would expose 1Password vault items to Claude Code sessions                 |
| B9  | PC build / hardware track — eGPU + drives + cooling (separate from B3 GPU)    | [parked] | B3 is ML training GPU; B9 is the broader PC build (eGPU chassis, NVMe, cooling)     |

## Tier C — Feature Enhancements, Post-Sprint Parked (11 items)

| ID  | Item                                                                               | State    | Notes                                                                                                                                |
| --- | ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | prompt-patterns skill at .claude/skills/prompt-patterns/                           | [parked] |                                                                                                                                      |
| C2  | Chunk D v2 — Statement Coverage Grid (Gmail-based)                                 | [parked] | task_queue #a169f782 exists (queued); acceptance doc at docs/sprint-4/chunk-d-v2-acceptance.md                                       |
| C3  | Personal Spending view — dedicated surface for personal accounts                   | [parked] | task_queue #abac1bac queued priority 5                                                                                               |
| C4  | Tesla auto-valuation button on Net Worth page                                      | [parked] | "Estimate current value" on Tesla row; currently $39,500 manual carry                                                                |
| C5  | Add/delete row on Net Worth page                                                   | [parked] | Currently SQL-only; need POST + DELETE /api/balance-sheet                                                                            |
| C6  | Currency-aware balances on Net Worth — USD positions under-report ~$163 at 1.37 FX | [parked] |                                                                                                                                      |
| C7  | FBA inventory live-pull for Net Worth (currently manual $10k entry)                | [parked] | Pull from inventory_units sum(cost)                                                                                                  |
| C8  | Amazon pending live-pull for Net Worth (stale Mar-31 values)                       | [parked] | Pull from amazon_settlements pending net_payout                                                                                      |
| C9  | Edge injury insurance follow-up                                                    | [parked] | Personal/life track                                                                                                                  |
| C10 | USA move planning — Jay Treaty path tracker                                        | [parked] | Was in L1 Life Tracks; moved here for T6 scoring. Jay Treaty = Canadian-born US citizenship path                                     |
| C11 | Cora's educational tracking                                                        | [parked] | `87_Coras_Future.py` is ported complete — verify if educational tracking is a distinct new feature beyond that scope before building |

## Tier D — Harness Automation, Queued Feature Class (6 items)

| ID  | Item                                                                 | State    | task_queue | Notes                          |
| --- | -------------------------------------------------------------------- | -------- | ---------- | ------------------------------ |
| D1  | harness_approval_listener — auto-fire builder on task_queue=approved | [parked] | #57ef5c6a  | priority 2, awaiting_grounding |
| D2  | Watchdog monitor — detect silent stalls and alert                    | [parked] | #ac4c57df  | awaiting_grounding             |
| D3  | Auto-approve acceptance docs when Twin confidence > 80%              | [parked] | #b6055674  | queued                         |
| D4  | Auto-resume continuous mode when quota refreshes after halt          | [parked] | #1fb70813  | queued                         |
| D5  | F18 ceiling metric layer — ceiling cause + lift cost per module      | [parked] | #a3de7bed  | awaiting_grounding priority 3  |
| D6  | Tesla developer API access                                           | [parked] | —          | Personal/life track            |

## Tier E — Lifestyle + Streamlit Pending Ports (6 items)

Cross-checked against `streamlit_modules` 2026-05-10. Items with `port_status='complete'` were excluded (double-count with T4). Items with `port_status='pending'` or absent are included here.

| ID  | Item                                                         | State    | T4 cross-check                                                                       | Notes                                                         |
| --- | ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| E1  | Pet Health / vet reference section                           | [parked] | `88_Pet_Health.py` — pending                                                         | Full port still needed                                        |
| E2  | Lego Vault                                                   | [parked] | `47_Lego_Vault.py` + `utils/lego_retirement.py` — pending                            | Retirement value scanner + vault tracker                      |
| E3  | Grocery photo-to-nutrition tracker                           | [parked] | `83_Grocery_Tracker.py` — pending (base tracker); photo-OCR feature is new beyond it | Camera → nutrition parse                                      |
| E4  | Household food inventory (40+ items, Supabase table planned) | [parked] | absent from streamlit_modules                                                        | Distinct from grocery tracker; structured pantry/freezer list |
| E5  | Monthly shared expenses tracker — Colin + Megan joint view   | [parked] | `4_Monthly_Expenses.py` — complete; joint-tracking angle is distinct                 | Shared bills, split tracking                                  |
| E6  | Megan-to-Colin reminder transfer tool                        | [parked] | absent from streamlit_modules                                                        | Transfer reminders/tasks from Megan's app to Colin's cockpit  |

---

_Added to T6 weighted rollup 2026-05-10. 13 items added 2026-05-10 (A7-A9, B8-B9, C10-C11, E1-E6). Prior home: master-rollup T7 (Parked/Future Products) + feature_backlog memory + PENDING_ADDITIONS.md._
