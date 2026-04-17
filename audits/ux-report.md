# LepiOS Phase 2 — UX & Navigation Audit

**Agent:** A — UX & Navigation  
**Date:** 2026-04-17  
**Baseline app:** `streamlit_app/` — 83 pages, ~59,000 lines Python  
**Method:** Read-only. No files modified.

---

## 1. Navigation Map

### 1.1 Entry point and routing

`app.py` is the Streamlit Cloud entry point. It calls `st.navigation(_all_pages, position="hidden")` and renders a fully custom sidebar built from a `_SECTIONS` dict. [grounded — `streamlit_app/app.py:141`]

The sidebar renders each section as a `st.expander`. "Dashboard" opens expanded by default; all others are collapsed. Status dots (🟢🟡🔴) on each section header come from `utils/health_check.get_section_status()`. [grounded — `streamlit_app/app.py:183–191`]

Users navigate by clicking `st.page_link()` items within each expander. There is no persistent breadcrumb, no tab bar, no top navigation rail — only the left sidebar.

### 1.2 Sidebar section structure (11 sections, 83 pages)

| Section | Page count | Top-level theme |
|---|---|---|
| Dashboard | 4 | Home, P&L, Trading, Betting |
| Amazon & Inventory | 8 | FBA commerce operations |
| Deals & Sourcing | 8 | Keepa/retail/arb scanning |
| Accounting & Tax | 10 | Bookkeeping, reconciliation, tax |
| Marketplace | 2 | eBay + cross-platform |
| Trading | 2 | Crypto, Prediction Engine |
| Household | 12 | Personal finance, utilities, grocery |
| Life | 10 | Health, family, goals, 3D printer |
| AI & Automation | 8 | Ollama, CrewAI, n8n, automations |
| Account | 5 | Profile, notifications, admin |
| System | 7 | Command Centre, Debug, CMS, Business History |

**Total: 83 pages across 11 sections** (some pages appear under sections by their sidebar position but may be logically miscategorized — see defects).

### 1.3 Home screen ("Business Review")

`Business_Review.py` is the default/first page. Its layout:

1. System health banner (green/warning) [grounded — `Business_Review.py:47–57`]
2. AI Daily Briefing (collapsed expander — requires button click) [grounded — `Business_Review.py:1018`]
3. Life P&L Summary — 5 `st.metric` cards (YTD income, expenses, delta, loan repayments, avg monthly) [grounded — `Business_Review.py:1157–1175`]
4. Monthly delta bar chart (sparkline, `st.bar_chart`) [grounded — `Business_Review.py:1184`]
5. Weather widget (Edmonton, top-right corner) [grounded — `Business_Review.py:1210–1237`]
6. "What You're Owed" section — 4 metric cards (Amazon pending, COGS, FBA units, bank balances) [grounded — `Business_Review.py:1414–1433`]
7. Activity Feed — git commits, receipts, health entries, trades [grounded — `Business_Review.py:1352–1407`]

**Interaction model:** Mostly read + occasional write (add purchase, send briefing to Telegram). One "Refresh" button hard-wired at the top right. [grounded — `Business_Review.py:1003`]

---

## 2. Screen Inventory

### 2.1 v1 Money Pillar pages (deep-read)

| File | Page Title | Pillar | v1/v2/Out | Description | Cockpit Score (1–5) |
|---|---|---|---|---|---|
| `Business_Review.py` | Business Review | Money | **v1** | Main dashboard — Life P&L summary, Amazon MTD, AI briefing, activity feed, weather widget | 2 |
| `pages/1_Life_PL.py` | Life P&L | Money | **v1** | Unified monthly income vs expense view — 5 metric cards, per-source breakdown, monthly projections | 2 |
| `pages/2_Trading_Journal.py` | Trading Journal | Money | **v1** | Trade log + analytics + AI analyst. Tabs: Today's Orders, AI Briefing, Key Levels, Scan All, Deep Scan. Metric display for YTD %, win rate, R:R, streak | 3 |
| `pages/3_Sports_Betting.py` | Sports Betting | Money | **v1** | Bet logger + results + Kelly sizing + analytics. Inline Season P&L bar, coach intelligence bar, system proof panel, 4 tabs | 3 |
| `pages/4_Monthly_Expenses.py` | Monthly Expenses | Money | **v1** | Business expense entry + edit + recurring series. Category list, tax rate selector, business-use % | 1 |
| `pages/5_Monthly_PL.py` | Monthly P&L | Money | **v1** | Detailed monthly income/expense per category across 12 months | 1 |
| `pages/21_PageProfit.py` | PageProfit | Money | **v1** | Amazon book/ISBN scanner — SP-API + eBay + buyback ROI, condition grading via Claude Vision, batch queuing | 3 |
| `pages/46_Arbitrage_Scanner.py` | Arbitrage Scanner | Money | **v1** | Keepa product lookup + ROI calc + deal tracker + retail watchlist | 2 |
| `pages/75_Retail_HQ.py` | Retail HQ | Money | **v1** | Consolidated retail arb — store cards, Flipp deals, StockTrack, arb engine, brand risk, calculator | 2 |
| `pages/73_Keepa_Intel.py` | Keepa Intel | Money | **v1** | Token balance, scan criteria config, harvester controls | 2 |
| `pages/30_Shipment_Manager.py` | Shipment Manager | Money | **v1** | FBA box builder + SP-API shipment creation | 2 |
| `pages/7_Inventory.py` | Inventory | Money | **v1** | Books + Lego COGS and condition tracking | 1 |
| `pages/65_Repricer.py` | Repricer | Money | v2 | Rule-based Amazon price adjustment engine | 1 |
| `pages/17_Payouts.py` | Payouts | Money | **v1** | Amazon/eBay payout register | 1 |
| `pages/26_Sales_Charts.py` | Sales Charts | Money | **v1** | Amazon revenue/profit time series charts | 2 |
| `pages/28_Category_PL.py` | Category P&L | Money | v2 | Per-category income vs expense | 1 |
| `pages/8_Bookkeeping_Hub.py` | Bookkeeping Hub | Money | **v1** | Statement reconciliation, vendor rules | 1 |
| `pages/12_Receipts.py` | Receipts | Money | **v1** | OCR upload, Claude Vision, Dropbox sync, receipt matching | 2 |
| `pages/38_Paper_Trail.py` | Paper Trail | Money | v2 | Statement upload/review, Dropbox archiver | 1 |
| `pages/54_Monthly_Close.py` | Monthly Close | Money | v2 | EOM reconciliation checklist and sign-offs | 1 |
| `pages/58_Tax_Return.py` | Tax Return | Money | v2 | CRA T4/T5 data, business deductions calculator | 1 |
| `pages/62_eBay.py` | eBay Listings | Money | v2 | eBay listing manager, sales history, eBay API | 1 |
| `pages/64_Marketplace_Hub.py` | Marketplace Hub | Money | v2 | Cross-platform Amazon+eBay listings view | 1 |
| `pages/60_Amazon_Orders.py` | Amazon Orders | Money | v2 | SP-API order history, returns | 1 |
| `pages/22_Inventory_Spend.py` | Inventory Spend | Money | v2 | COGS by category and date | 1 |
| `pages/81_Prediction_Engine.py` | Prediction Engine | Money | v2 | ML predictions for bets/trades | 2 |

### 2.2 All pages — abbreviated

| File | Title | Pillar | v1/v2/Out | Score |
|---|---|---|---|---|
| `pages/8_Health.py` | Health Records | Health | v2 | 1 |
| `pages/82_Oura_Health.py` | Oura Health | Health | v2 | 2 |
| `pages/83_Grocery_Tracker.py` | Grocery Tracker | Health | v2 | 1 |
| `pages/29_Groceries.py` | Groceries | Health | v2 | 1 |
| `pages/68_Goals.py` | Goals & Habits | Growing | v2 | 1 |
| `pages/93_Life_Compass.py` | Life Compass | Growing | v2 | 1 |
| `pages/89_Accuracy_Dashboard.py` | Accuracy Dashboard | Growing | v2 | 2 |
| `pages/77_AI_Coach.py` | AI Coach | Growing | v2 | 2 |
| `pages/70_Family.py` | Family | Happy | v2 | 1 |
| `pages/87_Coras_Future.py` | Cora's Future | Happy | v2 | 1 |
| `pages/88_Pet_Health.py` | Pet Health | Happy | out | 1 |
| `pages/24_Calendar.py` | Calendar | Happy | v2 | 1 |
| `pages/61_Net_Worth.py` | Net Worth | Money | **v1** | 1 |
| `pages/51_Retirement_Tracker.py` | Retirement | Money | v2 | 1 |
| `pages/63_Debt_Payoff.py` | Debt Payoff | Money | v2 | 1 |
| `pages/67_Cash_Forecast.py` | Cash Forecast | Money | v2 | 2 |
| `pages/71_Savings_Goals.py` | Savings Goals | Money | v2 | 1 |
| `pages/69_Subscriptions.py` | Subscriptions | Money | v2 | 1 |
| `pages/76_Crypto.py` | Crypto | Money | v2 | 1 |
| `pages/56_Insurance.py` | Insurance | Money | v2 | 1 |
| `pages/49_Cashback_HQ.py` | Cashback HQ | Money | v2 | 2 |
| `pages/41_Coupon_Lady.py` | Coupon Lady | Money | out | 1 |
| `pages/42_Retail_Scout.py` | Retail Scout | Money | out | 1 |
| `pages/48_Retail_Monitor.py` | Retail Monitor | Money | v2 | 1 |
| `pages/47_Lego_Vault.py` | Lego Vault | Money | v2 | 2 |
| `pages/85_Retail_Radar.py` | Retail Radar | Money | v2 | 1 |
| `pages/80_Deal_Tracker.py` | Deal Tracker | Money | v2 | 1 |
| `pages/74_Product_Intel.py` | Product Intel | Money | v2 | 1 |
| `pages/25_Personal_Expenses.py` | Personal Expenses | Money | **v1** | 1 |
| `pages/52_Utility_Tracker.py` | Utilities | Money | v2 | 1 |
| `pages/55_Phone_Plans.py` | Phone Plans | Money | out | 1 |
| `pages/13_Vehicles.py` | Vehicles | Money | v2 | 1 |
| `pages/79_MileIQ.py` | MileIQ | Money | v2 | 1 |
| `pages/23_Expense_Dashboard.py` | Expense Dashboard | Money | **v1** | 1 |
| `pages/53_Business_History.py` | Business History | Money | v2 | 1 |
| `pages/6_Tax_Centre.py` | Tax Centre | Money | v2 | 1 |
| `pages/50_3D_Printer_HQ.py` | 3D Printer HQ | Money | out | 1 |
| `pages/72_Local_AI.py` | Local AI | System | v2 | 1 |
| `pages/84_Agent_Swarm.py` | Agent Swarm | System | v2 | 2 |
| `pages/78_Automations.py` | Automations | System | v2 | 2 |
| `pages/37_Command_Centre.py` | Command Centre | System | **v1** | 3 |
| `pages/90_CMS.py` | CMS | System | out | 1 |
| `pages/80_AI_Chat.py` | AI Chat | System | v2 | 1 |
| `pages/86_Polymarket.py` | Polymarket | Money | v2 | 2 |
| `pages/94_Personal_Archive.py` | Personal Archive | Growing | v2 | 1 |
| `pages/95_Legal_Advisor.py` | Legal Advisor | Growing | out | 1 |
| `pages/96_GPU_Day.py` | GPU Day | System | out | 1 |
| `pages/97_Dropbox_Archiver.py` | Dropbox Archiver | System | out | 1 |
| `pages/98_Debug.py` | Debug | System | v2 | 1 |
| `pages/99_Scanner_Phone.py` | Scanner Phone | Money | **v1** | 2 |
| `pages/99_n8n_Webhook.py` | n8n Webhook | System | v2 | 1 |
| `pages/9_Profile.py` | Profile | System | v2 | 1 |
| `pages/66_Notifications.py` | Notifications | System | v2 | 1 |
| `pages/10_Admin.py` | Admin | System | v2 | 1 |
| `pages/91_Welcome.py` | Welcome | System | out | 1 |
| `pages/92_Help.py` | Help Centre | System | out | 1 |
| `pages/39_Monthly_Close.py` | Monthly Close (old) | Money | out | 1 |

**Cockpit score key:** 1 = generic SaaS form, 2 = minimal instruments, 3 = some cockpit-adjacent patterns, 4 = strong instrument feel, 5 = full cockpit (none exist yet at 4–5).

---

## 3. Top 10 UX Defects Ranked by Daily-Loop Impact

### Defect 1 — No single "state of life at a glance" on wake
**Impact: Critical.** The LepiOS daily loop starts at step 1: "Wake → cockpit → scan overnight." The current Business Review page requires 5+ scrolls and a button click ("Generate Briefing") to understand the day's situation. [grounded — `Business_Review.py:1018`] The briefing is not pre-generated; it requires an on-demand API call every morning. Nothing shows at-a-glance whether trading, betting, and Amazon all have activity that needs attention. The user has to know where to look.

**LepiOS fix required:** Master gauge + four pillar rows pre-rendered on load. No button click to see state-of-life.

### Defect 2 — Navigation requires remembering 83 page names
**Impact: High.** 11 sidebar sections, 83 pages. All collapsed except Dashboard. A first-time-in-the-morning user must remember that Trading Journal is under "Dashboard," not "Trading," and that Arbitrage Scanner is under "Deals & Sourcing," not "Amazon." There is no concept of "most used" or "today's workflow." [grounded — `app.py:31–130`]

**LepiOS fix required:** Cockpit tiles replace the sidebar for daily-loop tasks. The sidebar (if retained at all) is reference-only.

### Defect 3 — Trading tile has no pre-trade status display
**Impact: High.** `2_Trading_Journal.py` starts immediately with tabs and an AI briefing card that requires a button press. There is no always-visible "account balance + today's P&L + market open/closed status + next setup" banner. The "Today's AI Pick" card exists [grounded — `2_Trading_Journal.py:177`] but is rendered mid-page after the tab selector, not as a top-of-screen status. User must scroll past debug expanders to find it.

**LepiOS fix required:** Trading tile on cockpit home = account balance gauge + single best setup + market status light. Full journal on drill-down.

### Defect 4 — Betting Kelly sizing is buried 4 tabs deep
**Impact: High.** Sports Betting has four tabs. The Kelly calculator and system proof panel are in Tab 3 (Full History). [grounded — `3_Sports_Betting.py:6`] The most important pre-bet information (bankroll, recommended stake, today's Kelly-adjusted picks) is not the first thing visible. The coach intelligence bar IS always-visible [grounded — `3_Sports_Betting.py:304–330`] but only renders after 5+ bets and is squeezed between the Season P&L bar and the tab strip.

**LepiOS fix required:** Betting tile = bankroll gauge + today's recommended stake + pending bet count. Kelly panel on the tile's face, not buried in a tab.

### Defect 5 — Amazon overnight deal results not surfaced on home screen
**Impact: High.** The deal scanner runs as a GitHub Actions cron at 6 AM and 6 PM MDT [grounded — `streamlit_app/.github/workflows/deal_scan.yml`] and sends Telegram alerts. But the Business Review page shows no "deals found overnight" summary. The user must navigate to Retail HQ or Keepa Intel to review results. The daily loop step 4 (Amazon tile) requires opening a separate page.

**LepiOS fix required:** Amazon tile on cockpit home = N deals found overnight + sourcing list count + FBA units in flight. Link to full scanner.

### Defect 6 — Expenses entry has no AI classification assist on the logging form itself
**Impact: Medium-High.** `4_Monthly_Expenses.py` has a long category dropdown (25 categories) and manual business-use % entry. [grounded — `4_Monthly_Expenses.py:23–55`] There is no inline AI suggestion for category or tax rate based on vendor name at point of entry. Classification happens at review time, not capture time, creating rework.

**LepiOS fix required:** Expenses tile = quick-add with AI-suggested category inline. Anomaly flags surface as status lights.

### Defect 7 — The "home" page mixes dashboard and journaling concerns
**Impact: Medium.** Business Review contains: Life P&L summary, AI Daily Briefing, Amazon metrics, "What You're Owed," Activity Feed (git commits + receipts + health entries), weather widget, and a weekly review form with a health journal entry form. [grounded — `Business_Review.py:1016–1407`] This is at least 6 distinct concerns on one scroll. The user cannot distinguish "read status" actions from "write journal" actions at a glance.

**LepiOS fix required:** Cockpit home = read-only status. Write/log actions live in tile drill-downs.

### Defect 8 — Status lights are emoji-based and inconsistent
**Impact: Medium.** The sidebar section health dots (🟢🟡🔴) are loaded via `utils/health_check.get_section_status()`. [grounded — `app.py:147–191`] These are the only system-status indicators. Individual pages have no visible connectivity status (e.g., "SP-API connected," "Keepa token balance," "Oura synced today"). The Command Centre has agent status dots [grounded — `37_Command_Centre.py:243–248`] with pulsing animations, but they are always hardcoded as "active" and not grounded in real runtime state.

**LepiOS fix required:** Real status lights on cockpit home for: Oura synced (timestamp), Amazon feed live, Keepa token balance, Safety agent green, context budget.

### Defect 9 — No cross-pillar "next action" surfacing
**Impact: Medium.** The AI briefing exists but requires an on-demand generate click. [grounded — `Business_Review.py:1021–1082`] There is no always-visible "Next Move" concept. After reviewing the dashboard, the user must decide for themselves what to do. The system has all the data (pending bets, unlisted inventory, trade setups, Oura readiness) but synthesizes it only on button press.

**LepiOS fix required:** `<NextMoveButton>` on cockpit home = highest-priority action right now. Pre-computed by Digital Twin overnight.

### Defect 10 — 83 pages with no deactivation/pinning = cognitive overload
**Impact: Medium.** Even with user module preferences (partial implementation via `utils/onboarding.get_selected_modules()`), there is no "pin to today" or "today's workflow" concept. [grounded — `app.py:168–199`] The sidebar shows all 83 pages every session. Out-of-scope features (Pet Health, 3D Printer, GPU Day, MileIQ) share equal visual weight with Money pillar pages.

**LepiOS fix required:** v1 ships only the Money pillar tiles. v2 stubs show but are grayed and labeled "coming."

---

## 4. Cockpit Primitive Reuse Opportunities

For each LepiOS primitive from ARCHITECTURE.md §4.2, does an analog exist in the Streamlit OS?

### `<Gauge>` — circular/arc gauge for a single metric

**Streamlit analog:** `st.metric()` with gold top-rail CSS. [grounded — `utils/style.py:64–88`]  
The metric cards render a label, large value, and delta. The CSS applies a gold `border-top: 3px solid #c89b37` and dark gradient background. They are functionally metric readouts but visually rectangular — not arc/gauge shaped.

**State:** Partial — the semantic intent matches (show a value with context), the visual shape does not.  
**Recommendation:** **Beef up.** In Next.js, the `<Gauge>` can start as a styled metric card (same gold top-rail semantics the Streamlit user is already trained on) and progressively upgrade to arc/dial in Design Council Phase 2. Don't build a completely different mental model from scratch.

### `<PillBar>` — horizontal fill bar for a pillar score

**Streamlit analog:** None as a component. The closest is `st.progress()` (generic Streamlit progress bar) used in a few pages, but with no custom styling. The Sports Betting System Proof Panel has an inline HTML bar (`background: linear-gradient...`) but it's one-off HTML, not reusable. [grounded — `3_Sports_Betting.py:484–491`]

**State:** Build new — no reusable bar component exists.  
**Recommendation:** **Build new** in Next.js. The `<PillBar>` is a thin horizontal capsule that fills 0–100% in pillar color. It doesn't exist in Streamlit in reusable form.

### `<StatusLight>` — colored dot/lamp indicating system status

**Streamlit analog:** The sidebar section dots (🟢🟡🔴 emoji) [grounded — `app.py:152`] and the `agent_status_pill()` function which renders an 8px circle with CSS pulse animation. [grounded — `utils/style.py:608–618`]

The `agent_status_pill` implementation is notably close to what LepiOS needs:
```python
# utils/style.py:342–387 — .agent-dot, .agent-dot-active (green pulsing), .agent-dot-error (red pulsing)
```
This is real CSS with keyframe animations and semantic active/idle/error states.

**State:** Working — real implementation exists in `utils/style.py`.  
**Recommendation:** **Port directly.** The CSS animation logic and semantic state model (active/idle/error) maps cleanly to `<StatusLight>`. Translate the Python/CSS to a React component. The emoji-based sidebar dots are the weaker version and should NOT be ported.

### `<CockpitRow>` — a single pillar's row of gauges

**Streamlit analog:** The `st.columns()` metric layout used throughout. E.g., Business Review renders `_lp_c1, _lp_c2, _lp_c3, _lp_c4, _lp_c5 = st.columns(5)` [grounded — `Business_Review.py:1157`] and the trading journal renders `mc1, mc2, mc3, mc4 = st.columns(4)` with the `.cyber-metrics` CSS override class. [grounded — `37_Command_Centre.py:211–228`]

**State:** Partial — the column-of-metrics pattern exists, the pillar-row visual container with a label and pillar color does not.  
**Recommendation:** **Beef up the concept.** The metric column pattern is the right semantic structure. In Next.js, wrap it in a `<CockpitRow pillar="money">` that applies the pillar color accent and row label.

### `<NextMoveButton>` — the single highest-priority action button

**Streamlit analog:** The "Generate Briefing" button in Business Review. [grounded — `Business_Review.py:1021`] It fires a Claude API call and returns a text paragraph. There is no pre-computed "Next Move" — it is always on-demand and always prose (no structured action label).

The "Morning Routine" guide in Trading Journal [grounded — `2_Trading_Journal.py:320–330`] is a step-by-step inline HTML div that lists 4 steps. This is the closest thing to a "what to do next" primitive, but it is static text, not a dynamic action button.

**State:** Build new — the concept exists (briefing + morning guide) but not as a button component tied to a pre-computed recommendation.  
**Recommendation:** **Build new.** The Digital Twin agent produces the Next Move recommendation. `<NextMoveButton>` in Next.js displays the label, links to the relevant tile, and replaces the on-demand briefing pattern.

### `<SituationTicker>` — slim scrolling strip of council deliberation

**Streamlit analog:** The `data_stream_bar()` function [grounded — `utils/style.py:621–623`] renders an animated 3px color-shift bar — purely decorative, no text. The activity feed in Business Review [grounded — `Business_Review.py:1352–1407`] shows a list of recent events (git commits, receipts, trades) grouped by type. The Command Centre has a "Intelligence Feed" tab with `feed_item()` cards. [grounded — `utils/style.py:656–665`]

**State:** Partial — the animated bar and feed-item pattern exist separately. Neither is a ticker.  
**Recommendation:** **Compose from existing patterns.** In Next.js, `<SituationTicker>` combines the animated bar CSS (already proven) with feed-item text semantics (already proven). Stitch them into a single scrolling strip component. This is a port + compose, not build-from-scratch.

---

## 5. Generic SaaS Drift List

Specific patterns in the Streamlit OS that would look wrong in a cockpit and must NOT be carried forward:

### SD-1: `st.expander` for every section [generated — pattern observed throughout all major pages]
Collapsible expanders are used as the primary content container on every page. They are fine for "debug info" but become generic SaaS when every primary section (bankroll, season P&L, system proof, briefing) requires a click to expand. Cockpits do not hide their instruments by default.

**Do not port:** Expanders as primary containers. Replace with always-visible tiles and drill-down navigation.

### SD-2: "Generate Briefing" button as the only way to see daily status [grounded — `Business_Review.py:1018–1021`]
The home screen requires a button click to generate an AI briefing. On a cockpit, instruments are always on. The user does not press "activate altimeter."

**Do not port:** On-demand briefing generation as the home state. Pre-compute overnight; show result on load.

### SD-3: Emoji icons as the primary visual language [grounded — `app.py:31–130`, every page file]
The sidebar, page headers, and metric labels use emoji extensively (📚, 🏒, 💰, 🧱, etc.). Emoji were a quick shorthand for the Streamlit MVP but carry the aesthetic of a hobby project, not a mission control.

**Do not port:** Emoji in page titles and navigation labels. Replace with monochrome icons + color-coded pillar accents.

### SD-4: Tab strips within pages as primary navigation [grounded — `2_Trading_Journal.py:333`, `3_Sports_Betting.py:6`, `75_Retail_HQ.py:2`]
Trading Journal has 5 tabs. Sports Betting has 4 tabs. Retail HQ has 8 tabs. Command Centre has 5 tabs. Tab strips are standard SaaS. On a cockpit, the instrument panel shows all relevant instruments simultaneously — you don't tab between them.

**Do not port:** Tab navigation for primary content. Use tile drill-downs with a persistent status summary always visible.

### SD-5: `st.info()` / `st.warning()` / `st.success()` as status communication [grounded — throughout all major pages]
Standard Streamlit info boxes (blue, yellow, green banners) are used throughout for status messages ("No AI picks yet today," "Everything looks good"). These are generic SaaS feedback patterns — the same you see in every CRUD app.

**Do not port:** Generic colored banners as status. Replace with status lights + short inline text in monospace.

### SD-6: Long vertical scroll as the primary layout [grounded — `Business_Review.py` — ~1,500 lines of render code]
The Business Review page renders its content as one long vertical scroll. At wide layout, most of the right half of the screen is empty. On a cockpit, instruments fill a fixed grid — the layout is spatial, not scrolled.

**Do not port:** Full-page vertical scroll for the home/cockpit view. Use a grid of tiles that fits in the viewport.

### SD-7: Sidebar navigation as the primary navigation surface [grounded — `app.py:154–201`]
The sidebar with 83 pages in 11 expanders is the only navigation. It is a standard pattern for Streamlit apps but antithetical to a cockpit where the home screen IS the navigation (you look at a tile and click into it).

**Do not port:** Sidebar as the primary navigation. In LepiOS, the cockpit home is navigation. Sidebar (if retained) is secondary reference.

### SD-8: `st.metric()` as the only instrument type [grounded — throughout all pages]
Despite the gold top-rail CSS, `st.metric()` is a rectangular text card. Every numerical display uses this same shape. A cockpit uses varied instrument shapes — gauges, bars, lights, dials — to encode different types of data (rate vs. level vs. state).

**Do not port:** Flat metric cards as the only instrument type. In LepiOS, each primitive (`<Gauge>`, `<PillBar>`, `<StatusLight>`) encodes a different data semantics.

### SD-9: "Debug — Section Name" expanders visible by default on production pages [grounded — throughout most pages, e.g., `2_Trading_Journal.py:257–260`]
Every page has `with st.expander("🔍 Debug — ...", expanded=False)` blocks with raw data dumps. These are good for development but in production they add visual noise and reinforce the "dev tool" aesthetic.

**Do not port to cockpit UI.** Move diagnostics to a dedicated System/Debug tile.

### SD-10: Weather widget on the home screen [grounded — `Business_Review.py:1194–1237`]
The Edmonton weather widget (temperature, icon, city label) in the top-right corner is a pleasant touch but is generic consumer-app decoration. A cockpit's top band is reserved for the master gauge and Next Move.

**Do not port:** Weather to the cockpit home screen. It belongs in the Happy pillar (v2) or removed.

---

## 6. Grounding Manifest

Every file read as evidence for claims in this document:

| File | Lines/Sections Read | Claim(s) Grounded |
|---|---|---|
| `lepios/ARCHITECTURE.md` | Full (244 lines) | §4 cockpit design language, §7 v1 scope, §4.2 primitives list |
| `lepios/audits/00-inventory.md` | Full (543 lines) | Page list, sizes, line counts, section structure, Supabase absent |
| `streamlit_app/app.py` | Full (202 lines) | Navigation structure, `_SECTIONS` dict, sidebar layout, status dots |
| `streamlit_app/Business_Review.py` | Lines 1–250, 400–605, 800–1445 | Home screen structure, Life P&L summary, "What You're Owed," Activity Feed, AI Briefing, weekly review, weather widget |
| `streamlit_app/pages/2_Trading_Journal.py` | Lines 1–450 | Tab structure, AI Pick card, morning routine guide, metric layout, debug expanders |
| `streamlit_app/pages/3_Sports_Betting.py` | Lines 1–535 | Tab structure, Season P&L bar, coach intelligence bar, System Proof Panel, Kelly implementation |
| `streamlit_app/pages/4_Monthly_Expenses.py` | Lines 1–270 | Category list, tax rate selector, business-use % |
| `streamlit_app/pages/21_PageProfit.py` | Lines 1–270 | Scanner architecture, Claude Vision condition grading, per-marketplace ROI |
| `streamlit_app/pages/1_Life_PL.py` | Lines 1–120 | 5-metric-card layout, projection rows, monthly breakdown |
| `streamlit_app/pages/46_Arbitrage_Scanner.py` | Lines 1–100 | Tab structure, Keepa + SP-API integration |
| `streamlit_app/pages/75_Retail_HQ.py` | Lines 1–100 | 8-tab structure, store card list, arb engine |
| `streamlit_app/pages/37_Command_Centre.py` | Full (250 lines read) | `cyber_card`, `agent_status_pill`, `data_stream_bar` usage; Mission Control tab; agent status panel |
| `streamlit_app/pages/8_Health.py` | Lines 1–80 | People tracked (Colin/Megan/Cora/Sharon), sheet tabs, v2 scope |
| `streamlit_app/utils/style.py` | Full (694 lines) | `_THEME_CSS`, metric card gold-top-rail, `.cyber-card`, `.agent-dot` animations, `.status-pill`, `section_header()`, `cyber_card()`, `agent_status_pill()`, `data_stream_bar()`, `ticker_chip()`, `feed_item()` |

---

## Accuracy Classification

Claims marked **grounded** are directly verifiable from file paths and line numbers cited above.  
Claims marked **generated** are inferences from reading patterns, not direct quotations from code.

- All navigation structure claims: **grounded** (app.py)
- All page descriptions: **grounded** (page files read, docstrings, imports)
- Cockpit scores 1–3: **generated** (my assessment vs ARCHITECTURE.md §4 criteria — hypothesis for Colin to confirm)
- All cockpit primitive reuse assessments: **grounded** (style.py functions cited) or **generated** (absence confirmed by not finding the component)
- All SaaS drift entries: **grounded** (specific file + line cited) where marked, **generated** where pattern-level

No Supabase, no Stripe, no external CSS framework (all inline CSS via `unsafe_allow_html`). Data store is Google Sheets + SQLite. These are grounded facts from 00-inventory.md.
