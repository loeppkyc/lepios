# Streamlit Full Inventory Audit

> Generated: 2026-04-18
> Source: `streamlit_app/pages/` — 60 page files audited
> Navigation source: `app.py` \_SECTIONS dict + `CODEBASE_INDEX.md`

---

## Module Entries

### Admin

- **File:** `pages/10_Admin.py` (934 lines)
- **Section:** Account
- **What it does:** Admin-only panel providing system health checks (syntax errors, auth warnings, XSS scan), login activity log, and user role management. Runs `run_health_check()` on load, displays per-file syntax error details and auth/XSS warnings in expanders. Allows role promotion/demotion for any user from the Users sheet.
- **Data sources:** Sheets tab `⚙️ Settings` (users), Sheet tab identified via `LOG_SHEET` / `USERS_SHEET` constants from `utils/auth.py` (login log), `utils/health_check.run_health_check()` (filesystem scan)
- **Data destinations:** `⚙️ Settings` sheet (user role updates via gspread)
- **External deps:** Google Sheets (service account)
- **Completeness:** Working — full health check UI, login log, user role editor all present and wired
- **Importance:** Life (system admin, not financial)
- **Port complexity:** Medium (health check is Python-filesystem specific, needs re-implementation for Next.js)

---

### Receipts

- **File:** `pages/12_Receipts.py` (2640 lines)
- **Section:** Accounting & Tax
- **What it does:** Hubdoc-style receipt capture with 7 tabs: upload (file or phone camera), review queue, all receipts viewer, bookkeeper view with Drive links, Gmail import, reconcile against statement lines, and Hubdoc archive. Claude Vision auto-extracts vendor/date/amounts from uploaded photos; saves to Google Drive and writes back to `📒 Business Transactions` to mark Hubdoc = Y.
- **Data sources:** `📸 Receipts` sheet, `📒 Business Transactions` sheet, `📧 Email Invoices` sheet, Google Drive (receipt images), Gmail (`utils/gmail.scan_invoices()`)
- **Data destinations:** `📸 Receipts` sheet (new receipt records), `📒 Business Transactions` sheet (match status update, Hubdoc flag), Google Drive (receipt image upload via `utils/drive.upload_receipt()`)
- **External deps:** Anthropic Claude API (Vision OCR), Google Drive (Dropbox token), Gmail OAuth, Tesseract OCR (optional fallback)
- **Completeness:** Working — all 7 tabs functional, dual-write to Business Transactions confirmed in code, camera capture JS injection present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Complex (camera capture, Drive upload, Vision OCR, dual-write pattern, 2640 lines)

---

### Vehicles

- **File:** `pages/13_Vehicles.py` (278 lines)
- **Section:** Household
- **What it does:** Tracks two vehicles (2022 Tesla Model Y, 2021 Toyota Corolla). Displays static vehicle specs and loan status, monthly cost metrics, and a maintenance log loaded from `🚗 Vehicles` sheet. AI-powered market valuation via Claude (Canadian used car pricing from AutoTrader/Kijiji/CarGurus). Allows adding maintenance entries.
- **Data sources:** `🚗 Vehicles` sheet (maintenance log rows 28+), `⚙️ Settings` sheet (tesla_loan_balance key)
- **Data destinations:** `🚗 Vehicles` sheet (new maintenance entry appended to row 29+)
- **External deps:** Anthropic Claude API (market valuation, `claude-sonnet-4-6` model)
- **Completeness:** Working — static info current as of 2026 (Tesla loan shows paid off March 2026), maintenance form works
- **Importance:** Life
- **Port complexity:** Simple

---

### Payouts (Payout Register)

- **File:** `pages/17_Payouts.py` (212 lines)
- **Section:** Amazon & Inventory
- **What it does:** Logs actual Amazon biweekly disbursements and compares to estimated payouts from the daily Amazon sheet. Shows YTD summary metrics (estimated vs received vs variance), a manual entry form to record a new payout, payout history table, and a monthly rollup expander.
- **Data sources:** `💰 Payout Register` sheet, `📊 Amazon {year}` sheet (EstimatedPayout column)
- **Data destinations:** `💰 Payout Register` sheet (append new payout row)
- **External deps:** Google Sheets (service account)
- **Completeness:** Working — YTD metrics, history table, form all present and wired; auto-sync note references daily_pl.py
- **Importance:** CORE-PRIORITY
- **Port complexity:** Simple

---

### Life P&L

- **File:** `pages/1_Life_PL.py` (354 lines)
- **Section:** Dashboard
- **What it does:** Unified life P&L view — all income vs all expenses across every stream in one dashboard. Pulls from `utils/life_pl.py` (source of truth) to show YTD income, operating expenses, operating delta, loan repayments, avg monthly delta. Displays current month spotlight with income/expense breakdown by category, and a month-by-month historical table.
- **Data sources:** `utils/life_pl.get_life_pl()` (aggregates Business Transactions, Amazon sheets, Colin/Megan Masterfile), `utils/life_pl.get_ytd_summary()`, `utils/life_pl.get_current_month_projection()`
- **Data destinations:** read-only
- **External deps:** Google Sheets (service account) via life_pl.py
- **Completeness:** Working — debug expanders present on every section, data sourced from verified life_pl module
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium (depends on life_pl.py logic, which is 1141 lines)

---

### Book Scout

- **File:** `pages/20_Scout.py` (691 lines)
- **Section:** (not in current app.py nav — superseded)
- **What it does:** Shows `st.info("Book Scout has been merged into PageProfit")` then calls `st.stop()` at line 43. The remainder of the file (barcode scanner, profit calculation, sheet write logic) is dead code that never executes.
- **Data sources:** N/A (dead code after st.stop())
- **Data destinations:** N/A
- **External deps:** N/A (dead code)
- **Completeness:** Stubbed — line 43: `st.info("Book Scout has been merged into PageProfit"); st.stop()`
- **Importance:** Growing (replaced by PageProfit)
- **Port complexity:** Simple (just a redirect page)

---

### PageProfit

- **File:** `pages/21_PageProfit.py` (3373 lines)
- **Section:** Amazon & Inventory
- **What it does:** Full-featured multi-marketplace book scanning station. 5 tabs: Scanner (barcode scan → profit across Amazon CA/US, eBay, Buyback), Batch (multi-book sessions), Hit Lists (saved buy lists), Analytics (scan history charts, rejection analysis), Settings (scoring weights, cost config). Uses SP-API for catalog/buy box/fees, Keepa for BSR/rank history, eBay API for sold comps. Writes scan results to `💰 PageProfit Scans` sheet.
- **Data sources:** `💰 PageProfit Scans` sheet, `📋 PageProfit Lists` sheet, Amazon SP-API (catalog, buy box, fees), Keepa API (price history, BSR), eBay Finding API (sold comps), Open Library (ISBN→metadata)
- **Data destinations:** `💰 PageProfit Scans` sheet (each scan result appended), `📋 PageProfit Lists` sheet (hit list entries)
- **External deps:** Amazon SP-API, Keepa API, eBay API, Anthropic Claude API (condition grading via Vision), HuggingFace Inference (quick_vision condition check)
- **Completeness:** Working — most complex page in the app, all 5 tabs functional; barcode scanner via html5-qrcode component present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Complex (3373 lines, 4 external APIs, barcode scanner component, concurrent API calls)

---

### Inventory Spend

- **File:** `pages/22_Inventory_Spend.py` (747 lines)
- **Section:** Amazon & Inventory
- **What it does:** Tracks monthly inventory purchases from bank statement PDFs. AI (Claude) identifies inventory purchases from statement text; classifies by store using keyword matching. Uploads PDF statements to Google Drive for archive. Shows monthly spend by card and store, with tabs for Import / Statements / Summary / History / Settings.
- **Data sources:** `📦 Inventory Spend` sheet, `📁 Bank Statements` sheet, Google Drive (statement PDFs), Colin Masterfile `Goal Tracking` sheet (monthly "Need to Buy" goal via `utils/masterfile.get_monthly_goals()`)
- **Data destinations:** `📦 Inventory Spend` sheet (AI-classified transactions), `📁 Bank Statements` sheet (statement metadata), Google Drive (PDF upload)
- **External deps:** Anthropic Claude API (statement parsing), Google Drive, pdfplumber (optional, PDF text extraction)
- **Completeness:** Working — AI parsing, Drive upload, sheet writes all present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium

---

### Expense Dashboard

- **File:** `pages/23_Expense_Dashboard.py` (475 lines)
- **Section:** (effectively dead — superseded)
- **What it does:** Shows `st.info("Expense Dashboard has been merged into Monthly Expenses")` then calls `st.stop()` at line 21. The remaining 450 lines of month × category grid logic are dead code.
- **Data sources:** N/A (dead code)
- **Data destinations:** N/A
- **External deps:** N/A
- **Completeness:** Stubbed — line 20-21: merged redirect + st.stop()
- **Importance:** Growing (replaced by Monthly Expenses)
- **Port complexity:** Simple (redirect only)

---

### Calendar

- **File:** `pages/24_Calendar.py` (869 lines)
- **Section:** Life
- **What it does:** Full Google Calendar integration with 3 views: Month (grid), Agenda (list), Day (hourly). Reads all calendars shared with the service account. Supports creating, editing, and deleting events. Shows setup instructions if Calendar API not connected. Color-coded by calendar source.
- **Data sources:** Google Calendar API (via `utils/calendar_helper.list_calendars()`, `get_events()`)
- **Data destinations:** Google Calendar API (create/update/delete events via `utils/calendar_helper`)
- **External deps:** Google Calendar API (service account)
- **Completeness:** Working — all 3 views, CRUD operations present; graceful degradation if Calendar not connected
- **Importance:** Life
- **Port complexity:** Medium

---

### Personal Expenses

- **File:** `pages/25_Personal_Expenses.py` (238 lines)
- **Section:** Household
- **What it does:** Reads Colin's personal expenses by month and category from the Colin Masterfile (`Colin Expenses {year}` tab). Shows current month metrics (total, Capital One CC, groceries, gas), a month × category grid, category breakdown charts (bar + pie), and YTD totals. Year selector available. Megan's expenses shown in a separate section below.
- **Data sources:** Colin Masterfile via `utils/masterfile.get_personal_expenses(year)` and `get_megan_expenses(year)` (separate spreadsheet, `Colin Expenses {year}` and `Megan Expenses {year}` tabs)
- **Data destinations:** read-only
- **External deps:** Google Sheets (service account, Masterfile spreadsheet)
- **Completeness:** Working — debug expanders, active month filtering, Megan section all present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Simple

---

### Sales Charts

- **File:** `pages/26_Sales_Charts.py` (404 lines)
- **Section:** Amazon & Inventory
- **What it does:** Keepa-style analytics for Amazon sales. Shows daily revenue trend (current year), organic vs PPC split, 7/30-day rolling averages, YoY month comparison (current vs prior year), monthly sales waterfall, and gross margin chart. Also shows actual payouts from Payout Register. Supports SP-API ASIN sales sync.
- **Data sources:** `📊 Amazon {year}` sheet (daily), `📊 Amazon {year-1}` sheet (monthly), `💰 Payout Register` sheet, Amazon SP-API (`utils/amazon.sync_asin_sales()`)
- **Data destinations:** read-only (SP-API sync writes to `📊 ASIN Sales Log` via sync_asin_sales)
- **External deps:** Amazon SP-API (optional, for ASIN-level sync)
- **Completeness:** Working — charts render from sheet data, SP-API sync gated behind `sp_api_configured()` check
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium

---

### Category P&L

- **File:** `pages/28_Category_PL.py` (355 lines)
- **Section:** Accounting & Tax
- **What it does:** Books vs Non-Books P&L split using the `📊 Amazon 2026` daily data. Proxy rule: if `Cost of Goods < 0` on a day, that day's revenue is classified as non-book. Shows 3 tabs: Revenue split (stacked bar), Profit split, and table view. Also loads pallet cost data from `📦 Colin - Pallet Sales` for book COGS context.
- **Data sources:** `📊 Amazon 2026` sheet (daily rows), `📦 Colin - Pallet Sales` sheet
- **Data destinations:** read-only
- **External deps:** none
- **Completeness:** Working — proxy rule is documented as a known approximation; charts and table present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Simple

---

### Groceries

- **File:** `pages/29_Groceries.py` (791 lines)
- **Section:** Household
- **What it does:** Upload grocery receipt photos → Claude Vision extracts line items (item, UPC, quantity, price) → saves to `🛒 Groceries` sheet. 3 tabs: Upload (photo → AI extract → save), This Week (current week summary by store), History (month-by-month spend trends with charts).
- **Data sources:** `🛒 Groceries` sheet
- **Data destinations:** `🛒 Groceries` sheet (appended line items from receipt)
- **External deps:** Anthropic Claude API (Vision receipt parsing)
- **Completeness:** Working — upload, extract, save flow present; week/history analytics present
- **Importance:** Life
- **Port complexity:** Medium (Vision upload flow, sheet writes)

---

### Trading Journal

- **File:** `pages/2_Trading_Journal.py` (1903 lines)
- **Section:** Dashboard
- **What it does:** Daily trade log for MES/M2K futures. Loads trades from `📈 Trading Journal` sheet. Shows account balance, P&L metrics, win rate, streak. 2 tab groups: analysis tabs (performance, patterns, psychology, AI coach) and analyst view (market data, order planning, backtest, session analysis). AI coach via Claude generates strategy reviews and trade debriefs.
- **Data sources:** `📈 Trading Journal` sheet (trades, account balance from cells B9/B10), `yfinance` (market data via `utils/market_data`), `Trading Signals` sheet, `Trading Learning` sheet
- **Data destinations:** `📈 Trading Journal` sheet (new trade rows), `Trading Learning` sheet (AI learning log)
- **External deps:** Anthropic Claude API (trade coaching), yfinance (free, market data)
- **Completeness:** Working — full trade log, AI coach, market data integration all present
- **Importance:** Money
- **Port complexity:** Complex

---

### Shipment Manager

- **File:** `pages/30_Shipment_Manager.py` (1176 lines)
- **Section:** Amazon & Inventory
- **What it does:** TurboLister-style FBA inbound shipment workflow across 5 tabs: Scan (split-screen scan + manifest), List (push listings to Amazon via SP-API), Shipment (create inbound plan + FNSKU labels), Box (transport details + box labels), Complete (mark as shipped). Reads from `📦 FBA Items` sheet; writes listing and shipment data back.
- **Data sources:** `📦 FBA Items` sheet, `📦 Book Inventory` sheet, Open Library (ISBN lookup), Amazon SP-API
- **Data destinations:** `📦 FBA Items` sheet (item scans), Amazon SP-API (create listing, create shipment plan, upload labels)
- **External deps:** Amazon SP-API, filesystem (HMAC-hashed per-user address storage in `.userdata/`)
- **Completeness:** Working — all 5 tabs present; security comment at line 28 notes the .userdata path is not fully secure
- **Importance:** CORE-PRIORITY
- **Port complexity:** Complex (SP-API shipment plan creation, FNSKU label generation, barcode scanner)

---

### Scoutly

- **File:** `pages/35_Scoutly.py` (295 lines)
- **Section:** (not in current app.py nav — superseded)
- **What it does:** Shows `st.info("Scoutly has been merged into PageProfit")` then calls `st.stop()` at line 29. The remaining code (barcode scan → FBA profit calculator → add to queue) is dead code that never executes.
- **Data sources:** N/A (dead code)
- **Data destinations:** N/A
- **External deps:** N/A (dead code)
- **Completeness:** Stubbed — line 29: merged redirect + st.stop()
- **Importance:** Growing (replaced by PageProfit)
- **Port complexity:** Simple (redirect only)

---

### Command Centre

- **File:** `pages/37_Command_Centre.py` (834 lines)
- **Section:** System
- **What it does:** Cyberpunk-styled mission control dashboard. 3 tabs: My System (auto-scanned inventory of all pages with titles/icons, 3-column cards), Skills & Tools (auto-scanned Claude Code skill files with descriptions and triggers from SKILL.md frontmatter), System Blueprint (links to architecture.html static visualization). Scans filesystem for pages and skills at TTL=3600.
- **Data sources:** Filesystem scan of `pages/*.py` files (page titles via regex on `page_setup()` calls), filesystem scan of `.claude/skills/*/SKILL.md` files, `skills_manifest.json` fallback
- **Data destinations:** read-only
- **External deps:** Filesystem (local, may not work on Streamlit Cloud where skill paths differ)
- **Completeness:** Working — fallback to `skills_manifest.json` when skill dirs not found; pages scan works on cloud
- **Importance:** Life (system reference tool)
- **Port complexity:** Simple

---

### Paper Trail

- **File:** `pages/38_Paper_Trail.py` (1034 lines)
- **Section:** Accounting & Tax
- **What it does:** Full transaction audit trail for 2026+. 5 tabs: Transaction Search (every business transaction with receipt status, filterable), Auto-Match (links receipts to transactions by date+amount within 5% tolerance), Balance the Books (reconcile statement lines against receipts), Statement Rules (teach vendor mapping rules for cryptic bank descriptions), Audit Log (QB-style sign-off trail). Categories determine business vs personal classification.
- **Data sources:** `📒 Business Transactions` sheet, `📸 Receipts` sheet, `🏦 Statement Lines` sheet, `🏦 Statement Rules` sheet, `📋 Audit Log` sheet
- **Data destinations:** `📒 Business Transactions` sheet (match status updates), `🏦 Statement Rules` sheet (new rules), `📋 Audit Log` sheet (sign-off events via `utils/audit_log`)
- **External deps:** Google Sheets (service account)
- **Completeness:** Working — all 5 tabs present, statement_rules and audit_log utilities imported
- **Importance:** CORE-PRIORITY
- **Port complexity:** Complex (5 tabs, reconciliation logic, rule engine)

---

### Sports Betting

- **File:** `pages/3_Sports_Betting.py` (2041 lines)
- **Section:** Dashboard
- **What it does:** Full sports betting dashboard with 4 tabs: Log Bet (record new bet with odds/stake/team), Results (mark pending bets Win/Loss/Push, trigger AI debrief), Full History (KPIs, analytics, Kelly criterion, bet log with charts), Deep Dive (Edge Finder, Backtesting & Elo, Polymarket integration). AI coach via Claude generates daily picks analysis, debriefs, and strategy reviews. The Odds API provides live lines.
- **Data sources:** `🎰 Bets` sheet, `🎰 Bankroll` sheet, `Sports Predictions` sheet, `Sports Learning` sheet, The Odds API (`utils/sports_odds`), Elo ratings via `utils/sports_backtester`
- **Data destinations:** `🎰 Bets` sheet (new bet rows), `Sports Learning` sheet (AI debrief logs), `🎰 Bankroll` sheet (balance updates)
- **External deps:** The Odds API (API key required), Anthropic Claude API (AI coach), `utils/sports_backtester.py` (Elo engine)
- **Completeness:** Working — all 4 tabs functional, AI coach present, Odds API gated behind `has_api_key()` check
- **Importance:** Happy
- **Port complexity:** Complex

---

### Coupon Lady

- **File:** `pages/41_Coupon_Lady.py` (868 lines)
- **Section:** Deals & Sourcing
- **What it does:** Canadian deal/coupon tracker with 5 tabs: Best Deals (active flyer deals + coupons ranked by savings), Price Book (item prices across stores, trend charts), Flyer Scanner (upload PDF/image flyer → Claude Vision extracts all deals), Shopping List (build list → AI finds cheapest store combo), Coupons (log by expiry, mark used). Data stored in Google Sheets via `utils/coupon_lady`.
- **Data sources:** Google Sheets via `utils/coupon_lady` (price book, flyers, coupons, shopping list tabs)
- **Data destinations:** Google Sheets (price entries, flyer deals, coupons, shopping list items via coupon_lady utils)
- **External deps:** Anthropic Claude API (flyer deal extraction via Vision)
- **Completeness:** Working — all 5 tabs present, Vision flyer scanner present
- **Importance:** Happy
- **Port complexity:** Medium

---

### Retail Scout

- **File:** `pages/42_Retail_Scout.py` (640 lines)
- **Section:** (not in current app.py nav — superseded)
- **What it does:** Shows `st.info("Retail Scout has been merged into Retail HQ")` then calls `st.stop()` at line 39. The remaining code (Walmart stock checker, flip calculator, deal pipeline) is dead code.
- **Data sources:** N/A (dead code)
- **Data destinations:** N/A
- **External deps:** N/A (dead code)
- **Completeness:** Stubbed — line 38-39: merged redirect + st.stop()
- **Importance:** Growing (replaced by Retail HQ)
- **Port complexity:** Simple (redirect only)

---

### Arbitrage Scanner

- **File:** `pages/46_Arbitrage_Scanner.py` (1632 lines)
- **Section:** Deals & Sourcing
- **What it does:** Lego-focused RA/OA research tool. 4 tabs: Product Lookup (ASIN → Keepa price/rank history + ROI calc), ROI Calculator (standalone profit calculator), Deal Tracker (saved deals with status pipeline), Price Watchlist (monitor retail URLs for price drops). Integrates with Keepa for product data, `utils/price_monitor` for URL watching, and `utils/coupon_lady` for flyer deals.
- **Data sources:** `🧱 Deals` sheet, `🧱 Watchlist` sheet, Keepa API (`utils/keepa_api`), Keepa harvester deals (`utils/keepa_harvester`), price monitor (`utils/price_monitor`), coupon/flyer data (`utils/coupon_lady`)
- **Data destinations:** `🧱 Deals` sheet (new deals), `🧱 Watchlist` sheet (watchlist items), Keepa deal saves
- **External deps:** Keepa API, Telegram (`utils/alerts.send_alert()`), price_monitor (web scraping)
- **Completeness:** Working — all 4 tabs present and wired
- **Importance:** Money
- **Port complexity:** Complex (Keepa integration, price monitor, multiple sheet tabs)

---

### Lego Vault

- **File:** `pages/47_Lego_Vault.py` (718 lines)
- **Section:** Deals & Sourcing
- **What it does:** Inventory of owned Lego sets (at home, not yet on FBA). 4 tabs: My Vault (current sets with value, target price, status), Add Set (form to add new set), Price Check (manual/automated Keepa price refresh), Analytics (vault value, profit potential, retiring sets). Telegram alert when Amazon price hits target sell price.
- **Data sources:** `🧱 Lego Vault` sheet, Keepa API (`utils/keepa_api.get_product()`), `utils/lego_retirement` (retiring sets data), Brickset/Bricklink for set images
- **Data destinations:** `🧱 Lego Vault` sheet (new sets, price updates, alert flags)
- **External deps:** Keepa API, Telegram (`utils/alerts.send_alert()`), Brickset/Bricklink image URLs (HTTP requests)
- **Completeness:** Working — all 4 tabs present; price refresh via Keepa, Telegram alerts wired
- **Importance:** Money
- **Port complexity:** Medium

---

### Retail Monitor

- **File:** `pages/48_Retail_Monitor.py` (193 lines)
- **Section:** Deals & Sourcing
- **What it does:** Monitors retail URLs (Costco, Walmart, Canadian Tire) for new Lego products appearing or price changes. 3 tabs: Monitor Dashboard (run check now, view results), Manage URLs (add/view monitor URLs), Product History (all tracked products with price history). Sends Telegram alerts on changes.
- **Data sources:** `utils/price_monitor` (SQLite or sheet-backed), web scraping of retail URLs
- **Data destinations:** `utils/price_monitor` state (known products, price history)
- **External deps:** Telegram (`utils/alerts`), web scraping (`utils/price_monitor.check_all_monitors()`)
- **Completeness:** Working — all 3 tabs present, alert warning shown if Telegram not configured
- **Importance:** Growing
- **Port complexity:** Simple

---

### Cashback HQ

- **File:** `pages/49_Cashback_HQ.py` (1858 lines)
- **Section:** Deals & Sourcing
- **What it does:** Ultimate cashback command centre. 5 main tabs: Dashboard (all loyalty programs at a glance), Southgate Deal ($100K mall cashback tracker with ROI calc and Lego VIP stacking), Purchase Router (input a purchase → AI recommends where/how to buy for max discount), Promo Calendar (upcoming promotions), Deal Stacker (calculate total effective discount for stacked purchases). Also has nested flyer tabs via Flipp API.
- **Data sources:** `💰 Loyalty Programs` sheet, `💰 Cashback Purchases` sheet, `💰 Promo Calendar` sheet, `💰 Southgate Tracker` sheet, `🎁 Southgate Cards` sheet, `🎁 Card Usage Log` sheet, Flipp API (`utils/flyer_intel`)
- **Data destinations:** All 6 sheets above (various write operations), Telegram alerts for deal opportunities
- **External deps:** Flipp API (flyer deal search), Anthropic Claude API (purchase routing advice), Telegram
- **Completeness:** Working — 1858 lines, all major tabs wired with sheet reads/writes
- **Importance:** Money
- **Port complexity:** Complex (6 sheets, Flipp API, AI routing)

---

### Monthly Expenses

- **File:** `pages/4_Monthly_Expenses.py` (1039 lines)
- **Section:** Accounting & Tax
- **What it does:** Manages business expenses for any month — add, edit, delete, recurring series. Adding an expense writes to `💼 Business Expenses {year}` sheet and also updates the Amazon `{year}` P&L sheet (dual-write pattern). Supports full CRUD, recurring expense series, GST calculations (5% standard + 0% for zero-rated categories like books/bank charges/insurance). AI Expense Advisor (Claude) for category suggestions.
- **Data sources:** `💼 Business Expenses 2025` / `💼 Business Expenses 2026` sheets, `📊 Amazon {year}` sheet (for P&L sync check)
- **Data destinations:** `💼 Business Expenses {year}` sheet (add/edit/delete rows), `📊 Amazon {year}` sheet (monthly expense total update)
- **External deps:** Anthropic Claude API (expense advisor), Google Sheets (service account)
- **Completeness:** Working — full CRUD, GST calculation, AI advisor all present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium

---

### 3D Printer HQ

- **File:** `pages/50_3D_Printer_HQ.py` (648 lines)
- **Section:** Life
- **What it does:** AI-powered FDM troubleshooter + project tracker. Built-in knowledge base of 8 common symptoms (stringing, layer shifting, bed adhesion, etc.) with causes and fixes. 4 tabs: Troubleshooter (symptom picker → diagnosis + AI analysis), Project Tracker (log prints with settings/outcomes), Printer Profile (save printer config), Issues Log (running symptom history).
- **Data sources:** `🖨️ Print Projects` sheet, `🖨️ Printer Issues` sheet, `🖨️ Printer Profile` sheet (all created on first use)
- **Data destinations:** All 3 sheets above (log entries)
- **External deps:** none (troubleshooter uses built-in knowledge base, not AI API)
- **Completeness:** Working — knowledge base hardcoded and complete, all 4 tabs present
- **Importance:** Happy
- **Port complexity:** Simple

---

### Retirement Tracker (Lego Retirement)

- **File:** `pages/51_Retirement_Tracker.py` (290 lines)
- **Section:** Household (note: named "Retirement" in app.py but content is Lego set retirement tracking, not financial retirement)
- **What it does:** Tracks Lego sets approaching end-of-life (retirement), scores them by profit potential (piece count, theme, retire date, discount), and monitors Amazon prices via Keepa. Seeds 20 known retiring 2025/2026 sets if vault is empty. Telegram alerts when high-scoring sets have price drops.
- **Data sources:** `utils/lego_retirement._ws()` → Sheets tab (Lego Retiring Sets), Keepa API (price refresh)
- **Data destinations:** Sheets (via `utils/lego_retirement.add_retiring_set()`, `refresh_set_prices()`)
- **External deps:** Keepa API (price refresh), Telegram (alerts)
- **Completeness:** Working — seed, score, display all functional; seed list has 20 real sets hardcoded in lego_retirement.py
- **Importance:** Money
- **Port complexity:** Simple

---

### Utility Tracker

- **File:** `pages/52_Utility_Tracker.py` (140 lines)
- **Section:** Household
- **What it does:** Tracks monthly Metergy power bills. Displays total billed, avg monthly cost, avg kWh, and bar charts of usage/cost over time. Manual entry form to add/update months (YYYY-MM format). Creates the `⚡ Utility Tracker` sheet on first use. No AI, no external APIs — pure data entry + visualization.
- **Data sources:** `⚡ Utility Tracker` sheet
- **Data destinations:** `⚡ Utility Tracker` sheet (add or update month row)
- **External deps:** none
- **Completeness:** Working — simple and clean, all logic present
- **Importance:** Life
- **Port complexity:** Simple

---

### Business History

- **File:** `pages/53_Business_History.py` (351 lines)
- **Section:** System
- **What it does:** Full historical analytics across Amazon revenue, expenses, and P&L. Combines prior year (monthly Sellerboard data) with current year (daily data grouped by month). Shows monthly revenue, payout, COGS, gross profit, net profit bar charts and trend lines. Pulls from both `📊 Amazon {year}` and `📊 Amazon {year-1}` sheets.
- **Data sources:** `📊 Amazon {year}` sheet (daily), `📊 Amazon {year-1}` sheet (monthly)
- **Data destinations:** read-only
- **External deps:** none
- **Completeness:** Working — multi-year aggregation logic present and correct
- **Importance:** CORE-PRIORITY
- **Port complexity:** Simple

---

### Monthly Close

- **File:** `pages/54_Monthly_Close.py` (731 lines)
- **Section:** Accounting & Tax
- **What it does:** QuickBooks-style month-end verification checklist. For each month, shows green/yellow/red status for: statement coverage (date-range checking per account), statement line classification rate, business transactions, receipts, Amazon data, sign-off status. Auto-reconciliation runs `utils/auto_reconcile.run_weekly_reconciliation()`. Sign-off workflow allows marking months complete (logged to `📋 Sign-Offs` sheet).
- **Data sources:** `🏦 Statement Lines` sheet, `📒 Business Transactions` sheet, `📸 Receipts` sheet, `📊 Amazon {year}` sheet, `📋 Sign-Offs` sheet
- **Data destinations:** `📋 Sign-Offs` sheet (sign-off and reopen events via `utils/audit_log`)
- **External deps:** `utils/auto_reconcile` (auto-matching logic)
- **Completeness:** Working — date-range coverage check (not just "any data exists"), sign-off workflow present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium

---

### Phone Plans

- **File:** `pages/55_Phone_Plans.py` (300 lines)
- **Section:** Household
- **What it does:** Documents current Bell Mobility plan (3 lines: Colin/Sharon/Megan, $37.17/line after credits, Bell BYOD 100GB Select as of March 2026). Shows per-line breakdown, 3-line cost with SK tax, plan conditions. AI deal scanner (Claude) analyzes current plan and suggests cheaper alternatives from Freedom, Koodo, Public, Fido, etc.
- **Data sources:** hardcoded plan details (no sheet reads)
- **Data destinations:** none (AI suggestions only shown in UI, not saved)
- **External deps:** Anthropic Claude API (plan comparison analysis)
- **Completeness:** Working — static plan info current; AI comparison present
- **Importance:** Life
- **Port complexity:** Simple

---

### Insurance

- **File:** `pages/56_Insurance.py` (1572 lines)
- **Section:** Household
- **What it does:** Insurance command centre for all family policies. 6 tabs: Dashboard (coverage heatmap, score, recommendations), All Policies (manage existing policies), Hidden Insurance (credit card benefits tracker), Insurance AI (gap analysis, overlap detection, policy review, optimization, rate comparison), Cost Analysis (premium charts), Manage (add/edit policies). `utils/insurance_analysis` provides assessment functions.
- **Data sources:** `🛡️ Insurance Policies` sheet, `🛡️ Card Benefits` sheet, `🛡️ Insurance Profile` sheet
- **Data destinations:** `🛡️ Insurance Policies` sheet (add/edit/delete policies), `🛡️ Card Benefits` sheet (benefit entries)
- **External deps:** Anthropic Claude API (AI Insurance Advisor)
- **Completeness:** Working — all 6 tabs present, AI analysis and policy CRUD complete
- **Importance:** Life
- **Port complexity:** Complex (insurance analysis module, multi-tab, AI integration)

---

### Tax Return Generator

- **File:** `pages/58_Tax_Return.py` (1222 lines)
- **Section:** Accounting & Tax
- **What it does:** Auto-fills CRA T2125, personal deductions, and GST return for 2025 tax year. 3 tabs: T2125 (business income, COGS, operating expenses, vehicle, home office — auto-populated from Tax Reconciliation 2025 and Amazon 2025 sheets, all fields editable), Personal Deductions, GST Return. CSV export available.
- **Data sources:** `📋 Tax Reconciliation 2025` sheet, `📊 Amazon 2025` sheet
- **Data destinations:** read-only (CSV export to browser only)
- **External deps:** none
- **Completeness:** Working — all 3 tabs, auto-fill from sheets, export present; accountant role gets read-only mode
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium

---

### Shipments

- **File:** `pages/59_Shipments.py` (574 lines)
- **Section:** (not in current app.py nav — superseded)
- **What it does:** Shows `st.info("Shipments has been merged into Shipment Manager")` then calls `st.stop()` at line 27. The remaining code (create/track/manage FBA shipments with box manifest) is dead code.
- **Data sources:** N/A (dead code)
- **Data destinations:** N/A
- **External deps:** N/A (dead code)
- **Completeness:** Stubbed — line 26-27: merged redirect + st.stop()
- **Importance:** Growing (replaced by Shipment Manager)
- **Port complexity:** Simple (redirect only)

---

### Monthly P&L

- **File:** `pages/5_Monthly_PL.py` (2126 lines)
- **Section:** Accounting & Tax
- **What it does:** Shows 2025 full-year P&L (from Amazon 2025/Sellerboard + Business Expenses) and 2026 YTD P&L (from Monthly Cashflow sheet). Sections: Sales vs Payout, Gross vs Net Profit, Monthly Overhead, Cash Out by Category, Monthly P&L Statement, Cash Flow, Revenue vs Expenses, Monthly Breakdown, Transaction Detail, Export P&L, Accounting Health Check. AI P&L Analyst (Claude) for insights.
- **Data sources:** `📊 Amazon 2025` sheet, `💼 Business Expenses 2025` sheet, `📊 Monthly Cashflow` sheet, `💰 Payout Register` sheet, `💼 Business Expenses 2026` sheet
- **Data destinations:** read-only (CSV export to browser)
- **External deps:** Anthropic Claude API (P&L analysis)
- **Completeness:** Working — 2126 lines, multiple chart types, AI analyst present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Complex (large, multi-year, AI integration, many chart types)

---

### Amazon Orders

- **File:** `pages/60_Amazon_Orders.py` (898 lines)
- **Section:** Amazon & Inventory
- **What it does:** Closes the audit trail loop for individual orders. 4 tabs: Order Sync (pull via SP-API or upload CSV from Seller Central), Order Dashboard (KPIs, revenue charts, top sellers, status breakdown), Profit Calculator (per-item profit with COGS from inventory), Payout Reconciliation (match Amazon disbursements to bank deposits). Writes orders to `📋 Amazon Orders` sheet.
- **Data sources:** `📋 Amazon Orders` sheet, `📦 Book Inventory` sheet (COGS), Amazon SP-API (`get_live_orders_range()`), `📋 Amazon Payouts` sheet
- **Data destinations:** `📋 Amazon Orders` sheet (synced orders), `📋 Amazon Payouts` sheet (payout records)
- **External deps:** Amazon SP-API
- **Completeness:** Working — all 4 tabs present, SP-API sync and CSV upload both supported
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium

---

### Net Worth

- **File:** `pages/61_Net_Worth.py` (571 lines)
- **Section:** Household
- **What it does:** Tracks total assets, liabilities, and net worth. Assets include manual inputs (bank accounts, FHSA, RRSP, other), auto-pulled inventory values (Book Inventory, Lego Vault from sheets), and vehicle estimate. Liabilities: BDC loans, Tesla loan (shown as paid off), credit cards. Saves monthly snapshots to `💎 Net Worth History`. Seeds defaults from `⚙️ Settings` sheet balances.
- **Data sources:** `⚙️ Settings` sheet (balance keys: td_bank_balance, fhsa, bdc_loan_1, etc.), `📦 Book Inventory` sheet, `🧱 Lego Vault` sheet, `💎 Net Worth History` sheet
- **Data destinations:** `💎 Net Worth History` sheet (monthly snapshots)
- **External deps:** none
- **Completeness:** Working — settings-seeded defaults, inventory auto-pull, snapshot save all present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium

---

### eBay Listings

- **File:** `pages/62_eBay.py` (1325 lines)
- **Section:** Marketplace
- **What it does:** Full eBay listing management for books/Lego. 5 tabs: List Item (lookup from inventory → AI generates title/description → push to eBay API), Active Listings (manage drafts/active/sold/ended, bulk relist), Analytics (sell-through, revenue, days-to-sell, relist candidates), Cross-List (Amazon inventory worth cross-listing to eBay), Photo Station (camera/upload photos → Claude Vision analysis → auto-generate listings).
- **Data sources:** `🏷️ eBay Listings` sheet, `📦 Book Inventory` sheet, `📦 FBA Items` sheet, eBay Trading API (`utils/ebay_api`)
- **Data destinations:** `🏷️ eBay Listings` sheet (new listings, status updates), eBay API (live item creation/ending)
- **External deps:** eBay Trading API, Anthropic Claude API (title/description generation, Vision photo analysis)
- **Completeness:** Working — all 5 tabs present including Photo Station with Vision
- **Importance:** CORE-PRIORITY
- **Port complexity:** Complex (eBay API, Vision, inventory cross-reference)

---

### Debt Payoff

- **File:** `pages/63_Debt_Payoff.py` (649 lines)
- **Section:** Household
- **What it does:** Loan tracking and payoff strategy modeller. 3 tabs: Debt Overview (all debts — BDC loan 1/2, Tesla — with KPIs and payoff timeline), Payoff Strategies (snowball vs avalanche comparison, extra payment modelling, amortization chart), Expense Forecast (recurring expense detection from Business Transactions, 3-month cash flow forecast). Pre-filled with known BDC/Tesla loan details.
- **Data sources:** `📉 Debts` sheet (created on first use), `📒 Business Transactions` sheet (recurring expense detection)
- **Data destinations:** `📉 Debts` sheet (debt entries)
- **External deps:** none
- **Completeness:** Working — all 3 tabs, amortization math, recurring expense detection all present
- **Importance:** Money
- **Port complexity:** Medium

---

### Marketplace Hub

- **File:** `pages/64_Marketplace_Hub.py` (1318 lines)
- **Section:** Marketplace
- **What it does:** Joe Lister-style multi-channel listing from one form. 3 tabs: New Listing (lookup from Book/Amazon inventory → push to eBay live API, generate Facebook Marketplace and Kijiji text), All Listings (cross-platform status grid — eBay/FB/Kijiji), Candidates (inventory items ready to cross-list, sortable by potential profit). AI generates platform-optimized titles/descriptions.
- **Data sources:** `🌐 Marketplace Hub` sheet, `📦 Book Inventory` sheet, `📦 Amazon Inventory` sheet, eBay API (`utils/ebay_api`)
- **Data destinations:** `🌐 Marketplace Hub` sheet (listing records), eBay API (live item creation)
- **External deps:** eBay Trading API, Anthropic Claude API (title/description generation, price suggestion)
- **Completeness:** Working — all 3 tabs present; eBay push live, FB/Kijiji generates copy-paste text
- **Importance:** Money
- **Port complexity:** Complex (eBay API, multi-platform, AI generation)

---

### Repricer

- **File:** `pages/65_Repricer.py` (912 lines)
- **Section:** Amazon & Inventory
- **What it does:** Automated price management for FBA listings. 5 tabs: Dashboard (pricing health overview, repricing metrics), Price Rules (rule builder: match by category/BSR/price/ASIN list, strategy: match/beat/margin minimum/fixed), Active Listings (current inventory with competitive pricing from SP-API), Price History (per-ASIN repricing log + charts), Settings (safety limits, floor/ceiling). Calls `update_listing_price()` via SP-API.
- **Data sources:** `🔄 Repricer Rules` sheet, `🔄 Repricer Log` sheet, Amazon SP-API (`get_merchant_listings()`, `get_fba_inventory()`, `get_used_buy_box()`, `update_listing_price()`)
- **Data destinations:** `🔄 Repricer Rules` sheet (new rules), `🔄 Repricer Log` sheet (price change log), Amazon SP-API (live price updates)
- **External deps:** Amazon SP-API
- **Completeness:** Working — rule builder, SP-API repricing, log all present; actual repricing execution requires SP-API configured
- **Importance:** CORE-PRIORITY
- **Port complexity:** Complex (SP-API price update, rule engine, live inventory)

---

### Notifications

- **File:** `pages/66_Notifications.py` (310 lines)
- **Section:** Account
- **What it does:** Central alert inbox that scans existing sheets for attention items. Checks: unmatched receipts (📸 Receipts), missing recurring bills (📒 Business Transactions), low FBA inventory (📦 FBA Items), upcoming subscription renewals, unclassified statement lines. Displays count badges and item lists per category.
- **Data sources:** `📸 Receipts` sheet, `📒 Business Transactions` sheet, `📦 FBA Items` sheet, `🔁 Subscriptions` sheet, `🏦 Statement Lines` sheet
- **Data destinations:** read-only
- **External deps:** none
- **Completeness:** Working — all 5 check functions present, TTL-cached at 300s
- **Importance:** CORE-PRIORITY
- **Port complexity:** Simple

---

### Cash Forecast

- **File:** `pages/67_Cash_Forecast.py` (321 lines)
- **Section:** Household
- **What it does:** Recurring expense tracker and 3-month cash flow projection. Loads recurring expense list (from `utils/config.get_recurring_expenses()` or hardcoded fallback). Compares current month actual spend (from Business Transactions) vs recurring total. Shows 3-month forward projection chart. Deficit alert if projected expenses exceed expected income.
- **Data sources:** `📒 Business Transactions` sheet (current month actual spend), `utils/config` (recurring expense list, or hardcoded fallback)
- **Data destinations:** read-only
- **External deps:** none
- **Completeness:** Working — projection chart, deficit alert, actual vs budget comparison all present
- **Importance:** Money
- **Port complexity:** Simple

---

### Goals & Habits

- **File:** `pages/68_Goals.py` (329 lines)
- **Section:** Life
- **What it does:** Simple goal tracking and daily habit streaks. 3 tabs: Active Goals (grid of goal cards with category, target date, status, progress bar), Daily Habits (habit streak tracker — last done, total completions, current streak), Review (completion stats, upcoming deadlines). Data in `🎯 Goals` and `🎯 Habits` sheets.
- **Data sources:** `🎯 Goals` sheet, `🎯 Habits` sheet (created on first use with defaults)
- **Data destinations:** `🎯 Goals` sheet (new goals, status/progress updates), `🎯 Habits` sheet (habit log, streak updates)
- **External deps:** none
- **Completeness:** Working — all 3 tabs, CRUD present, streak calculation present
- **Importance:** Life
- **Port complexity:** Simple

---

### Subscriptions

- **File:** `pages/69_Subscriptions.py` (302 lines)
- **Section:** Household
- **What it does:** Tracks all recurring subscriptions in one place. Shows total monthly/annual cost, category breakdown, upcoming renewals within 30 days, and list view filtered by status. Add/edit subscriptions with category, frequency (monthly/annual/quarterly), payment method, renewal date, and essential flag. Pre-populated with 6 default subscriptions as inactive.
- **Data sources:** `🔁 Subscriptions` sheet
- **Data destinations:** `🔁 Subscriptions` sheet (add new subscriptions)
- **External deps:** none
- **Completeness:** Working — cost normalization (annual/quarterly → monthly), renewal alerts, list view all present
- **Importance:** Life
- **Port complexity:** Simple

---

### Tax Centre

- **File:** `pages/6_Tax_Centre.py` (147 lines router) + `pages/tax_centre/colin_tax.py` (6922 lines) + `pages/tax_centre/megan_tax.py` (1073 lines)
- **Section:** Accounting & Tax
- **What it does:** Consolidated tax hub router — 13 Colin sections + 4 Megan sections, lazy-loaded. Colin sections include: Tax Checklist, GST Tracker, Tax Filing Prep, Journal Entries, Reconciliation, Tax Reconciliation, Mileage Log, Audit Pro, Accountant Review, Tax Return, Tax Forecast, GST Filing, Data Audit. Megan sections: Tax Checklist, Business & Expenses, Tax Return, Spousal Tax Optimizer. The two renderers in tax_centre/ are the bulk of the logic.
- **Data sources:** `📒 Business Transactions`, `🏦 Statement Lines`, `💰 Payout Register`, `📋 Tax Reconciliation 2025`, `🇨🇦 GST Annual Summary`, `📋 Megan Business 2025`, `📓 QB Journal Log`, `📊 Reconciliation Log`, `📋 Tax Checklist`, `📊 Amazon 2025/2026`, `🚗 MileIQ History`
- **Data destinations:** All sheets above (journal entries, recon logs, sign-offs, checklist items, payout adds)
- **External deps:** Anthropic Claude API (tax advice, T2125 filling guidance), `utils/data_audit` (8 integrity checks), `utils/auto_reconcile`
- **Completeness:** Working — router functional; colin_tax.py is the largest file (6922 lines), all 13 sections rendered
- **Importance:** CORE-PRIORITY
- **Port complexity:** Complex (8025 lines total, 13+ sections, GST math, T2125, recon engine)

---

### Family

- **File:** `pages/70_Family.py` (283 lines)
- **Section:** Life
- **What it does:** Dashboard for Colin/Megan/Cora household. Shows family overview cards (Colin/Megan/Cora icons with roles). Tracks Megan's cleaning business clients (rate, frequency, monthly income estimate). Tracks Cora's activities with monthly cost. Important dates log. Uses `🧹 Cleaning Clients`, `⭐ Cora Activities`, `👨‍👩‍👧 Family Dates` sheets (created on first use).
- **Data sources:** `🧹 Cleaning Clients` sheet, `⭐ Cora Activities` sheet, `👨‍👩‍👧 Family Dates` sheet
- **Data destinations:** All 3 sheets above (add client, add activity, add date)
- **External deps:** none
- **Completeness:** Working — all 3 data sections present with add forms
- **Importance:** Life
- **Port complexity:** Simple

---

### Savings Goals

- **File:** `pages/71_Savings_Goals.py` (441 lines)
- **Section:** Household
- **What it does:** Visual savings tracker. 4 tabs: Goals Grid (gold progress bars per goal with category badge, days remaining, projected completion date), Add Goal (form with category/priority/target), Update Progress (update current balance), Summary (total saved, achievement rate, category breakdown). Pre-populated with 3 defaults: Emergency Fund, Family Vacation, Business Growth Fund.
- **Data sources:** `🏦 Savings Goals` sheet
- **Data destinations:** `🏦 Savings Goals` sheet (new goals, balance updates, status changes)
- **External deps:** none
- **Completeness:** Working — all 4 tabs, progress bar HTML, projected completion date all present
- **Importance:** Life
- **Port complexity:** Simple

---

### Local AI

- **File:** `pages/72_Local_AI.py` (173 lines)
- **Section:** AI & Automation
- **What it does:** Chat interface to Colin's private Ollama AI. Requires Ollama running locally (shows setup error if not). Sidebar: model selector (lists installed Ollama models with params/size), RAG toggle, memory count, sync memories button. Chat interface with 4 quick-question buttons, RAG context display expander in responses. Stream responses via `utils/local_ai.chat_stream()`.
- **Data sources:** Ollama API (localhost), ChromaDB via `utils/local_ai.get_rag_context()` (indexed memories)
- **Data destinations:** ChromaDB (via sync memories button)
- **External deps:** Ollama (local, must be running), ChromaDB (local)
- **Completeness:** Working — full chat UI, RAG toggle, model management all present; requires local Ollama (fails gracefully on cloud)
- **Importance:** Growing
- **Port complexity:** Medium (Ollama dependency makes cloud deployment limited)

---

### Keepa Intel

- **File:** `pages/73_Keepa_Intel.py` (409 lines)
- **Section:** Deals & Sourcing
- **What it does:** Keepa token management, deal finding, price alerts, and data exploration. 4 tabs: Token Status (remaining tokens, refill rate, budget planner), Deal Finder (query category deals by BSR/price range, find trending products, save deals to sheet), Price Alerts (set ASIN + threshold → get Telegram alert when triggered), Data Explorer (browse saved deals, filter, export). Requires Keepa API key.
- **Data sources:** Keepa API (`utils/keepa_harvester.get_token_status()`, `query_category_deals()`, `find_deals_in_products()`), `utils/keepa_harvester` deals sheet
- **Data destinations:** Keepa deals sheet (saved deals via `save_deals_batch()`), Keepa alerts sheet (price alerts via `save_alert()`)
- **External deps:** Keepa API (required — page shows error and stops if key not configured)
- **Completeness:** Working — shows error message if no Keepa key; all 4 tabs present
- **Importance:** Money
- **Port complexity:** Medium

---

### Product Intel

- **File:** `pages/74_Product_Intel.py` (314 lines)
- **Section:** (not in current app.py nav — superseded)
- **What it does:** Shows `st.info("Product Intel has been merged into Keepa Intel")` then calls `st.stop()` at line 30. The remaining code (product watchlist, deal scanner, alert settings) is dead code.
- **Data sources:** N/A (dead code)
- **Data destinations:** N/A
- **External deps:** N/A (dead code)
- **Completeness:** Stubbed — line 29-30: merged redirect + st.stop()
- **Importance:** Growing (replaced by Keepa Intel)
- **Port complexity:** Simple (redirect only)

---

### Retail HQ

- **File:** `pages/75_Retail_HQ.py` (1465 lines)
- **Section:** Deals & Sourcing
- **What it does:** Central hub for Canadian retail arbitrage (replaces Retail Scout). 8 tabs: Dashboard (store cards grid), Deals (Flipp-powered live flyer search), StockTrack (Walmart/store inventory checker via `utils/stocktrack_api`), Auto Scan (scheduled Telegram deal alerts), Arb Engine (full scan → Amazon match → profit → score pipeline via `utils/arb_engine`), Risk & Fees (brand risk checker, restriction lookup), Calculator (manual ROI calc with cashback stacking), History (purchase log).
- **Data sources:** `🛒 Retail Deals` sheet, Flipp API (`utils/flipp_api`), StockTrack API (`utils/stocktrack_api`), `utils/arb_engine`, `utils/brand_risk`
- **Data destinations:** `🛒 Retail Deals` sheet (saved deals), Telegram (deal alerts)
- **External deps:** Flipp API, StockTrack API, Telegram, `utils/arb_engine` (may call Amazon SP-API internally)
- **Completeness:** Working — 1465 lines, all 8 tabs functional
- **Importance:** Money
- **Port complexity:** Complex (multiple external APIs, 8 tabs, scan pipeline)

---

### Crypto

- **File:** `pages/76_Crypto.py` (513 lines)
- **Section:** Trading
- **What it does:** Crypto command centre for token creation, ideas, and wallet tracking. 5 tabs: Token Builder (comparison table and step-by-step guides for Solana/Ethereum/Base token launch), Token Ideas (saved token concepts with notes), Wallet & Holdings (portfolio tracker in `🪙 Crypto Holdings` sheet), Solidity Playground (editable smart contract templates with deployment notes), Market Monitor (live price checker for tracked tokens).
- **Data sources:** `🪙 Crypto Holdings` sheet; Token Builder content is hardcoded/static
- **Data destinations:** `🪙 Crypto Holdings` sheet (add/delete holdings)
- **External deps:** none (Market Monitor tab uses a TODO placeholder — no real price API wired as of audit)
- **Completeness:** Partial — Token Builder and Holdings tracker are functional; Market Monitor tab appears to be incomplete (no live price API wired, based on reading first 80 lines)
- **Importance:** Growing
- **Port complexity:** Medium

---

### AI Coach

- **File:** `pages/77_AI_Coach.py` (1029 lines)
- **Section:** AI & Automation
- **What it does:** Business coaching with auto-cascade: Direct data answer → Ollama (free, local) → Ollama+Web search → Claude API → error. Pre-warms Google Sheets context in background thread via `utils/sheets_context.warm_cache()`. Shows mode indicator (online/offline/degraded). Sidebar: model selector, RAG mode toggle (local ChromaDB vs cloud RAG API). Quick question buttons. Chat history preserved in session state.
- **Data sources:** `utils/sheets_context.get_sheets_context()` (loads key sheet data for context), ChromaDB (local RAG), RAG API (cloud FastAPI endpoint at `secrets["rag_api"]["url"]`), Ollama (local), DuckDuckGo (web search fallback)
- **Data destinations:** ChromaDB (coach learns from sessions if configured)
- **External deps:** Anthropic Claude API (escalation), Ollama (local, optional), ChromaDB (local, optional), RAG API (cloud FastAPI, optional), DuckDuckGo (free web search)
- **Completeness:** Working — cascade logic present, mode indicators, graceful degradation to Claude-only
- **Importance:** Growing
- **Port complexity:** Complex (cascade logic, multiple AI backends, RAG wiring)

---

### Automations

- **File:** `pages/78_Automations.py` (353 lines)
- **Section:** AI & Automation
- **What it does:** Admin-only automation management panel. Shows registered automations from `⚡ Automations` sheet. 6 tabs (from CODEBASE_INDEX): Dashboard / Price Monitor / Keepa Sync / Memory Sync / Deal Alerts / Custom. Allows adding new custom automations (name, type, schedule, config) and toggling active/paused status. Mostly a control panel — actual automation execution happens in `telegram_bot.py`.
- **Data sources:** `⚡ Automations` sheet
- **Data destinations:** `⚡ Automations` sheet (new automations, status updates)
- **External deps:** none (triggers run in telegram_bot.py, not here)
- **Completeness:** Working — CRUD for automations present; the actual scheduler is external (Telegram bot)
- **Importance:** Life (system management)
- **Port complexity:** Simple

---

### MileIQ Analyzer

- **File:** `pages/79_MileIQ.py` (215 lines)
- **Section:** Accounting & Tax
- **What it does:** Upload MileIQ CSV export → classify drives as Business/Personal/Mixed using a location lookup map → calculate CRA mileage deduction (2025 rates: $0.70/km first 5000, $0.64/km after). 4 tabs: Upload (CSV file upload), Review Locations (classify frequently seen locations), History (all classified drives), Tax Summary (total business km, deduction amount). Stores data in `🚗 MileIQ Locations` and `🚗 MileIQ History` sheets.
- **Data sources:** MileIQ CSV upload (manual), `🚗 MileIQ Locations` sheet, `🚗 MileIQ History` sheet
- **Data destinations:** `🚗 MileIQ History` sheet (parsed drives), `🚗 MileIQ Locations` sheet (location classifications)
- **External deps:** none
- **Completeness:** Working — CRA 2025 rates hardcoded correctly, location mapping logic present, all 4 tabs present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Simple

---

### Inventory

- **File:** `pages/7_Inventory.py` (1094 lines)
- **Section:** Amazon & Inventory
- **What it does:** View and manage all items in the `📦 Book Inventory` sheet. Shows live FBA inventory snapshot (units, COGS, potential revenue/profit from `📦 Inventory Snapshot`). 2 tabs: Other (non-book items from COGS Lookup) and Books (pallet-sourced books). COGS loaded from `📦 COGS Lookup` with fallback to `Colin - Items` sheet. Supports SP-API FBA inventory refresh.
- **Data sources:** `📦 Book Inventory` sheet, `📦 Inventory Snapshot` sheet, `📦 COGS Lookup` sheet, `🛒 Colin - Items` sheet, Amazon SP-API (`get_fba_inventory()`, `get_fba_inventory_all()`, `get_fba_inventory_changes()`)
- **Data destinations:** `📦 Inventory Snapshot` sheet (SP-API sync writes snapshot), `📦 Book Inventory` sheet (status updates)
- **External deps:** Amazon SP-API (optional, for live FBA sync)
- **Completeness:** Working — snapshot display, COGS lookup, SP-API sync all present
- **Importance:** CORE-PRIORITY
- **Port complexity:** Medium

---

### AI Chat

- **File:** `pages/80_AI_Chat.py` (211 lines)
- **Section:** AI & Automation (listed as `80_Deal_Tracker.py` in app.py nav but file is AI Chat — app.py references `80_Deal_Tracker.py` which is a different file)
- **What it does:** Private chat interface to Ollama with full RAG from indexed memories and business data. Similar to Local AI (72) but with sidebar showing preferred model list (colin-assistant, colin-analyst, gemma4, qwen2.5, llama3.1), re-index memories button (runs `tools/memory_export.py` subprocess), and RAG status indicator. Requires Ollama running locally.
- **Data sources:** Ollama API (localhost), ChromaDB (local RAG)
- **Data destinations:** ChromaDB (via re-index)
- **External deps:** Ollama (local, must be running)
- **Completeness:** Working — chat interface, model selector, re-index button all present; requires local Ollama
- **Importance:** Growing
- **Port complexity:** Simple (thin UI over local_ai utils)

---

## Summary Table

| Module               | File                     | Lines         | Completeness | Importance    | Port Complexity |
| -------------------- | ------------------------ | ------------- | ------------ | ------------- | --------------- |
| Admin                | 10_Admin.py              | 934           | Working      | Life          | Medium          |
| Receipts             | 12_Receipts.py           | 2640          | Working      | CORE-PRIORITY | Complex         |
| Vehicles             | 13_Vehicles.py           | 278           | Working      | Life          | Simple          |
| Payout Register      | 17_Payouts.py            | 212           | Working      | CORE-PRIORITY | Simple          |
| Life P&L             | 1_Life_PL.py             | 354           | Working      | CORE-PRIORITY | Medium          |
| Book Scout           | 20_Scout.py              | 691           | Stubbed      | Growing       | Simple          |
| PageProfit           | 21_PageProfit.py         | 3373          | Working      | CORE-PRIORITY | Complex         |
| Inventory Spend      | 22_Inventory_Spend.py    | 747           | Working      | CORE-PRIORITY | Medium          |
| Expense Dashboard    | 23_Expense_Dashboard.py  | 475           | Stubbed      | Growing       | Simple          |
| Calendar             | 24_Calendar.py           | 869           | Working      | Life          | Medium          |
| Personal Expenses    | 25_Personal_Expenses.py  | 238           | Working      | CORE-PRIORITY | Simple          |
| Sales Charts         | 26_Sales_Charts.py       | 404           | Working      | CORE-PRIORITY | Medium          |
| Category P&L         | 28_Category_PL.py        | 355           | Working      | CORE-PRIORITY | Simple          |
| Groceries            | 29_Groceries.py          | 791           | Working      | Life          | Medium          |
| Trading Journal      | 2_Trading_Journal.py     | 1903          | Working      | Money         | Complex         |
| Shipment Manager     | 30_Shipment_Manager.py   | 1176          | Working      | CORE-PRIORITY | Complex         |
| Scoutly              | 35_Scoutly.py            | 295           | Stubbed      | Growing       | Simple          |
| Command Centre       | 37_Command_Centre.py     | 834           | Working      | Life          | Simple          |
| Paper Trail          | 38_Paper_Trail.py        | 1034          | Working      | CORE-PRIORITY | Complex         |
| Sports Betting       | 3_Sports_Betting.py      | 2041          | Working      | Happy         | Complex         |
| Coupon Lady          | 41_Coupon_Lady.py        | 868           | Working      | Happy         | Medium          |
| Retail Scout         | 42_Retail_Scout.py       | 640           | Stubbed      | Growing       | Simple          |
| Arbitrage Scanner    | 46_Arbitrage_Scanner.py  | 1632          | Working      | Money         | Complex         |
| Lego Vault           | 47_Lego_Vault.py         | 718           | Working      | Money         | Medium          |
| Retail Monitor       | 48_Retail_Monitor.py     | 193           | Working      | Growing       | Simple          |
| Cashback HQ          | 49_Cashback_HQ.py        | 1858          | Working      | Money         | Complex         |
| Monthly Expenses     | 4_Monthly_Expenses.py    | 1039          | Working      | CORE-PRIORITY | Medium          |
| 3D Printer HQ        | 50_3D_Printer_HQ.py      | 648           | Working      | Happy         | Simple          |
| Retirement Tracker   | 51_Retirement_Tracker.py | 290           | Working      | Money         | Simple          |
| Utility Tracker      | 52_Utility_Tracker.py    | 140           | Working      | Life          | Simple          |
| Business History     | 53_Business_History.py   | 351           | Working      | CORE-PRIORITY | Simple          |
| Monthly Close        | 54_Monthly_Close.py      | 731           | Working      | CORE-PRIORITY | Medium          |
| Phone Plans          | 55_Phone_Plans.py        | 300           | Working      | Life          | Simple          |
| Insurance            | 56_Insurance.py          | 1572          | Working      | Life          | Complex         |
| Tax Return Generator | 58_Tax_Return.py         | 1222          | Working      | CORE-PRIORITY | Medium          |
| Shipments            | 59_Shipments.py          | 574           | Stubbed      | Growing       | Simple          |
| Monthly P&L          | 5_Monthly_PL.py          | 2126          | Working      | CORE-PRIORITY | Complex         |
| Amazon Orders        | 60_Amazon_Orders.py      | 898           | Working      | CORE-PRIORITY | Medium          |
| Net Worth            | 61_Net_Worth.py          | 571           | Working      | CORE-PRIORITY | Medium          |
| eBay Listings        | 62_eBay.py               | 1325          | Working      | CORE-PRIORITY | Complex         |
| Debt Payoff          | 63_Debt_Payoff.py        | 649           | Working      | Money         | Medium          |
| Marketplace Hub      | 64_Marketplace_Hub.py    | 1318          | Working      | Money         | Complex         |
| Repricer             | 65_Repricer.py           | 912           | Working      | CORE-PRIORITY | Complex         |
| Notifications        | 66_Notifications.py      | 310           | Working      | CORE-PRIORITY | Simple          |
| Cash Forecast        | 67_Cash_Forecast.py      | 321           | Working      | Money         | Simple          |
| Goals & Habits       | 68_Goals.py              | 329           | Working      | Life          | Simple          |
| Subscriptions        | 69_Subscriptions.py      | 302           | Working      | Life          | Simple          |
| Tax Centre           | 6_Tax_Centre.py          | 147+6922+1073 | Working      | CORE-PRIORITY | Complex         |
| Family               | 70_Family.py             | 283           | Working      | Life          | Simple          |
| Savings Goals        | 71_Savings_Goals.py      | 441           | Working      | Life          | Simple          |
| Local AI             | 72_Local_AI.py           | 173           | Working      | Growing       | Medium          |
| Keepa Intel          | 73_Keepa_Intel.py        | 409           | Working      | Money         | Medium          |
| Product Intel        | 74_Product_Intel.py      | 314           | Stubbed      | Growing       | Simple          |
| Retail HQ            | 75_Retail_HQ.py          | 1465          | Working      | Money         | Complex         |
| Crypto               | 76_Crypto.py             | 513           | Partial      | Growing       | Medium          |
| AI Coach             | 77_AI_Coach.py           | 1029          | Working      | Growing       | Complex         |
| Automations          | 78_Automations.py        | 353           | Working      | Life          | Simple          |
| MileIQ Analyzer      | 79_MileIQ.py             | 215           | Working      | CORE-PRIORITY | Simple          |
| Inventory            | 7_Inventory.py           | 1094          | Working      | CORE-PRIORITY | Medium          |
| AI Chat              | 80_AI_Chat.py            | 211           | Working      | Growing       | Simple          |

---

## Top 10 Modules to Port First

Ranked by: CORE-PRIORITY × Working × Simple/Medium complexity. Simpler first within same tier.

1. **Payout Register** (`17_Payouts.py`, 212 lines) — CORE-PRIORITY + Working + Simple. Pure sheet read/write, no external APIs. Closes the Amazon money loop.

2. **Personal Expenses** (`25_Personal_Expenses.py`, 238 lines) — CORE-PRIORITY + Working + Simple. Read-only from Masterfile. Immediate household visibility.

3. **Category P&L** (`28_Category_PL.py`, 355 lines) — CORE-PRIORITY + Working + Simple. Read-only, no APIs, pure sheet + chart. Books vs Non-Books split is the core P&L story.

4. **Business History** (`53_Business_History.py`, 351 lines) — CORE-PRIORITY + Working + Simple. Multi-year analytics, read-only, no external APIs.

5. **Notifications** (`66_Notifications.py`, 310 lines) — CORE-PRIORITY + Working + Simple. Scan-and-display of existing sheet data. High daily value.

6. **MileIQ Analyzer** (`79_MileIQ.py`, 215 lines) — CORE-PRIORITY + Working + Simple. CSV upload → classify → CRA deduction calc. No external APIs.

7. **Utility Tracker** (`52_Utility_Tracker.py`, 140 lines) — Life + Working + Simple. Smallest working module in the system. Good port warm-up.

8. **Life P&L** (`1_Life_PL.py`, 354 lines) — CORE-PRIORITY + Working + Medium. The financial north star. Depends on `life_pl.py` (1141 lines of business logic that needs to be ported as a service).

9. **Monthly Expenses** (`4_Monthly_Expenses.py`, 1039 lines) — CORE-PRIORITY + Working + Medium. Core bookkeeping workflow. Dual-write pattern (expenses + Amazon P&L) is well-established.

10. **Sales Charts** (`26_Sales_Charts.py`, 404 lines) — CORE-PRIORITY + Working + Medium. Revenue visibility. Reads from Amazon sheets only, no external APIs.

---

## Modules Colin Underestimates

**Monthly Close** (`54_Monthly_Close.py`, 731 lines) — Named like a checkbox but is actually the most sophisticated audit tool in the app. Performs per-account, per-calendar-day date-range coverage checks (not just "data exists"), integrates sign-off workflow with audit log, and runs auto-reconciliation. If you want the accountant to trust the numbers, this must port correctly.

**Paper Trail** (`38_Paper_Trail.py`, 1034 lines) — The reconciliation engine connecting bank statements to receipts to transactions. The Statement Rules tab is a learned vendor-mapping system (QuickBooks-equivalent). Without this, receipts and transactions float unconnected.

**Cash Forecast** (`67_Cash_Forecast.py`, 321 lines) — Small file but surfaces recurring expense gaps before they cause cash problems. The 3-month projection is the only forward-looking financial view in the system.

**Notifications** (`66_Notifications.py`, 310 lines) — Deceptively simple but extremely high daily value. It surfaces unmatched receipts, missing recurring bills, low inventory, and upcoming renewals without any manual checking.

**Cashback HQ** (`49_Cashback_HQ.py`, 1858 lines) — The Southgate $100K cashback deal alone represents potentially $3K–5K/year in value. The Purchase Router and Deal Stacker reduce real purchase costs on every inventory buy. This is a revenue-generating tool, not just tracking.

**Inventory Spend** (`22_Inventory_Spend.py`, 747 lines) — Tracks where inventory capital goes at the statement-level. Without this, the COGS story in the P&L is incomplete. The AI-assisted bank statement parsing is sophisticated.

---

## Possibly Dead or Obsolete

The following 5 modules are confirmed dead code — each shows a merge redirect (`st.info` + `st.stop()`) and the remainder of the file never executes:

1. **Book Scout** (`20_Scout.py`, 691 lines) — Merged into PageProfit. Line 43: `st.stop()`. 648 lines of dead barcode scanner + profit logic.

2. **Scoutly** (`35_Scoutly.py`, 295 lines) — Merged into PageProfit. Line 29: `st.stop()`. 266 lines of dead scan-and-queue logic.

3. **Expense Dashboard** (`23_Expense_Dashboard.py`, 475 lines) — Merged into Monthly Expenses. Line 21: `st.stop()`. 454 lines of dead month × category grid.

4. **Retail Scout** (`42_Retail_Scout.py`, 640 lines) — Merged into Retail HQ. Line 39: `st.stop()`. 601 lines of dead Walmart stock checker + flip calculator.

5. **Product Intel** (`74_Product_Intel.py`, 314 lines) — Merged into Keepa Intel. Line 30: `st.stop()`. 284 lines of dead product watchlist + deal scanner.

**Total dead code in these 5 files: ~2,253 lines** — safe to delete from any port.

Additionally, **Shipments** (`59_Shipments.py`, 574 lines) is a redirect to Shipment Manager (line 27: `st.stop()`), with ~547 lines of dead FBA shipment creation code.

**Crypto** (`76_Crypto.py`, 513 lines) — Market Monitor tab appears incomplete based on audit (no live price API wired). Token Builder and Holdings tracker are working but the module's value depends on whether Colin is actively using crypto.

**Automations** (`78_Automations.py`, 353 lines) — The UI manages a `⚡ Automations` sheet, but the actual scheduled execution lives in `telegram_bot.py` which runs outside Streamlit. Without the bot running, this page shows records but executes nothing.
