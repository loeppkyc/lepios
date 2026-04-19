# Sprint 4 Brief — Business Review Trust Layer (Tier 1)

## Kill-criterion

Every visible number on LepiOS Business Review matches its source system (Seller Central, Dropbox statement folder) to the penny, with zero approximations carried forward from the Streamlit prototype.

## What this sprint is for

Colin doesn't trust LepiOS yet because the Streamlit prototype has structural honesty problems (hardcoded 65% payout approximations in 5 places, fee back-fills that insert `revenue * 0.35` into zero cells, silently-swallowed Life P&L errors, dead Weekly/Monthly toggles). Until LepiOS demonstrably tells the truth about what Amazon is doing today, everything downstream — listing tools, shipment workflows, tax layer — is premature.

Sprint 4 ports only the Streamlit BR sections that are already honest: they read live data from real APIs (SP-API Orders, SP-API Finances, Dropbox statement folder, n8n statement coverage), and they show real numbers without hardcoded approximations. Sections that currently depend on sheet-spine data or contain approximations are explicitly deferred to Sprints 5–8 per ARCHITECTURE §7.1.

When this ships, Colin checks LepiOS instead of Seller Central for daily sales for a week. If he's never pulled to the source system to verify, the trust layer holds. If he is, that section failed grounding and we rollback.

## Seed chunk list

- **Chunk A — Today Live + Yesterday.** SP-API Orders integration. Orders, revenue, estimated payout (from SP-API only — not hardcoded rate), units. Today + yesterday side-by-side.
- **Chunk B — What You're Owed.** SP-API Finances integration. Amazon pending settlement balance, FBA unit count, average cost per unit. Manual override path preserved.
- **Chunk C — Recent Days table.** Last 10 days of Amazon sales from SP-API. Honest zeros — if fee or payout data is unavailable for a day, the cell shows zero/blank, not a back-filled estimate. Column labels explicit about source.
- **Chunk D — Statement Coverage grid.** Dropbox folder listing + n8n webhook → per-account × per-month grid showing which statements are present. Green/red, no fabrication.
- **Chunk E — BR page shell.** Next.js page at `/business-review` (or project convention) that composes A–D. Includes refresh control, last-updated timestamp, honest loading/error states.

## Known grounding surfaces

- **Chunk A:** Colin pulls up Seller Central on his phone, checks today's orders/revenue, compares to LepiOS Today Live. Must match to the penny.
- **Chunk B:** Colin checks Seller Central Payments → Statement View for pending settlement. Must match LepiOS What You're Owed to the penny.
- **Chunk C:** Spot-check 3 days from the last 10 against Seller Central Business Reports. Numbers match, zeros show as zeros (not fake estimates).
- **Chunk D:** Colin opens his Dropbox statement folder, counts present months per account, compares to the LepiOS grid. Must match exactly.
- **Chunk E:** Full page loads, no silent error swallowing, all four sections render with real data or honest empty states.

## Reference files

- `streamlit_app/Business_Review.py` (treat as prototype, not spec; Principle 8)
- Existing LepiOS SP-API integration from Sprint 3 PageProfit (reuse credentials and client)

## Out of scope (deferred, not abandoned)

- **Life P&L summary** — Tier 2, Sprint 6. Needs error surfacing rethink.
- **Monthly Expenses** — Tier 3, Sprint 8. Has NameError bug and sheet-spine dependency.
- **Inventory Potential Profit** — Tier 2, Sprint 6. Needs real referral fee logic to replace 65% hardcode.
- **Financial Snapshot / Net Worth** — Tier 2, Sprint 6. Needs bookkeeping ledger (Sprint 7).
- **Trading, Health, Sports Betting sections** — not earning-adjacent, defer to v2+ queue.
- **AI Daily Briefing / AI Review** — scope creep, defer.
- **Sales Chart** — goes to Sprint 9 reporting sprint.
- **Weekly / Monthly view toggles** — Tier 3, Sprint 8. Dead code in Streamlit, rebuild rather than port.
- **Google Sheets adapter** — explicitly rejected. If a number can't come from a live API or file source today, that section doesn't ship Sprint 4.

## Notes

- Cache-match is disabled for Sprint 4 per rollout plan (runbook Appendix B). Every acceptance doc escalates to Colin. This is by design — Sprint 4 is also the baseline calibration run for the autonomous loop.
- Principle 6 (honest labels) is the dominant governing rule for this sprint. If a number can't be sourced honestly, the section shows empty state, not fabrication.
- Any hardcoded approximation from Streamlit (65% payout, 35% fee backfill, hardcoded defaults) is explicitly banned from porting. Flag in acceptance docs if encountered.
- Sprint-done test: one full day of sourcing/selling where Colin checks LepiOS BR instead of logging into Seller Central for daily numbers. If he opens Seller Central to verify anything, that section failed its grounding check.
