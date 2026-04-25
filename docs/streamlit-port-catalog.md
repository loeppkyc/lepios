# Streamlit Port Catalog

Generated: 2026-04-25T11:24:22.096Z
Total modules: 234 | Pending: 234 | Complete: 0 | Deferred: 0

## Tier 1 — Pure Logic (78 modules)

| Module                               | Lines | Classification | External Deps                                         | Status  | Notes |
| ------------------------------------ | ----- | -------------- | ----------------------------------------------------- | ------- | ----- |
| builder_bot.py                       | 467   | util           | anthropic, telegram                                   | pending |       |
| crawlers/**init**.py                 | 1     | config         | —                                                     | pending |       |
| crawlers/data_crawler.py             | 332   | client         | sheets, anthropic, chromadb                           | pending |       |
| crawlers/keepa_product_harvester.py  | 430   | util           | keepa, chromadb, telegram                             | pending |       |
| crawlers/pubmed_harvester.py         | 520   | util           | —                                                     | pending |       |
| daily_pl.py                          | 362   | client         | sp_api, sheets                                        | pending |       |
| diag_coverage.py                     | 42    | client         | sheets                                                | pending |       |
| fix_receipts_now.py                  | 226   | client         | sheets, gmail, anthropic, dropbox                     | pending |       |
| pages/tax_centre/**init**.py         | 2     | config         | —                                                     | pending |       |
| scripts/backfill_cogs.py             | 70    | client         | sheets                                                | pending |       |
| scripts/backfill_daily_profit.py     | 275   | util           | sp_api, sheets                                        | pending |       |
| scripts/deal_scan.py                 | 730   | util           | keepa, sheets, telegram                               | pending |       |
| scripts/export_to_chromadb.py        | 394   | util           | anthropic, chromadb                                   | pending |       |
| scripts/import_stock_history.py      | 94    | client         | sheets                                                | pending |       |
| scripts/ingest_knowledge_base.py     | 561   | util           | chromadb                                              | pending |       |
| scripts/ingest_personal_archive.py   | 479   | util           | chromadb, dropbox                                     | pending |       |
| scripts/migrate_hubdoc.py            | 307   | util           | sheets, dropbox                                       | pending |       |
| scripts/test_deals_supabase_write.py | 231   | test           | —                                                     | pending |       |
| tests/**init**.py                    | 1     | config         | —                                                     | pending |       |
| tests/run_tests.py                   | 83    | util           | dropbox                                               | pending |       |
| tests/smoke_test.py                  | 211   | util           | keepa, sqlite, dropbox, ebay                          | pending |       |
| tests/test_accuracy.py               | 193   | test           | —                                                     | pending |       |
| tests/test_auth_security.py          | 234   | test           | sheets                                                | pending |       |
| tests/test_bookkeeping_sync.py       | 174   | test           | dropbox                                               | pending |       |
| tests/test_data_audit.py             | 266   | test           | —                                                     | pending |       |
| tests/test_deal_scan.py              | 266   | test           | keepa, telegram                                       | pending |       |
| tests/test_dropbox_sync.py           | 335   | test           | anthropic, dropbox                                    | pending |       |
| tests/test_e2e_playwright.py         | 297   | test           | —                                                     | pending |       |
| tests/test_grocery_tracker.py        | 326   | test           | sheets, anthropic, dropbox                            | pending |       |
| tests/test_imports.py                | 72    | test           | sheets                                                | pending |       |
| tests/test_insurance_analysis.py     | 475   | test           | —                                                     | pending |       |
| tests/test_insurance_profile.py      | 166   | test           | —                                                     | pending |       |
| tests/test_legal_advisor.py          | 200   | test           | anthropic, chromadb                                   | pending |       |
| tests/test_life_pl.py                | 436   | test           | sheets                                                | pending |       |
| tests/test_managed_agent.py          | 202   | test           | anthropic                                             | pending |       |
| tests/test_monthly_expenses.py       | 136   | test           | —                                                     | pending |       |
| tests/test_onboarding.py             | 262   | test           | —                                                     | pending |       |
| tests/test_oos_watch.py              | 253   | test           | keepa                                                 | pending |       |
| tests/test_openclaw_health.py        | 110   | test           | ollama                                                | pending |       |
| tests/test_page_imports.py           | 43    | test           | —                                                     | pending |       |
| tests/test_personal_archive.py       | 195   | test           | chromadb                                              | pending |       |
| tests/test_pipeline_complete.py      | 92    | test           | keepa, chromadb                                       | pending |       |
| tests/test_rag_arb_gaps.py           | 169   | test           | telegram                                              | pending |       |
| tests/test_retail_matcher.py         | 171   | test           | keepa                                                 | pending |       |
| tests/test_sheets_connectivity.py    | 63    | test           | sheets                                                | pending |       |
| tests/test_tax_return.py             | 248   | test           | —                                                     | pending |       |
| tests/test_telegram_bot.py           | 136   | test           | keepa, anthropic, telegram                            | pending |       |
| tests/test_trading_predictions.py    | 113   | test           | —                                                     | pending |       |
| tests/test_translator.py             | 221   | test           | —                                                     | pending |       |
| tests/test_twin_decisions.py         | 145   | test           | —                                                     | pending |       |
| tests/test_utils_functional.py       | 132   | test           | keepa, anthropic, dropbox, ebay                       | pending |       |
| tools/**init**.py                    | 1     | config         | —                                                     | pending |       |
| tools/sports_predictions.py          | 353   | util           | sheets                                                | pending |       |
| utils/**init**.py                    | 69    | config         | sqlite                                                | pending |       |
| utils/accuracy.py                    | 285   | util           | —                                                     | pending |       |
| utils/actions.py                     | 1099  | util           | sheets, telegram, dropbox                             | pending |       |
| utils/agent_crew.py                  | 149   | util           | ollama                                                | pending |       |
| utils/ai_agent.py                    | 729   | util           | ollama                                                | pending |       |
| utils/amazon_fees_ca.py              | 120   | util           | —                                                     | pending |       |
| utils/arb_engine.py                  | 665   | util           | keepa, telegram                                       | pending |       |
| utils/circuit_breaker.py             | 233   | util           | keepa                                                 | pending |       |
| utils/data_audit.py                  | 646   | util           | —                                                     | pending |       |
| utils/fba_fees.py                    | 180   | util           | —                                                     | pending |       |
| utils/flipp_api.py                   | 232   | client         | —                                                     | pending |       |
| utils/fnsku_generator.py             | 301   | util           | —                                                     | pending |       |
| utils/insurance_analysis.py          | 1015  | util           | —                                                     | pending |       |
| utils/knowledge.py                   | 943   | util           | chromadb, sqlite                                      | pending |       |
| utils/lego_retirement.py             | 387   | util           | keepa, sheets                                         | pending |       |
| utils/ocr.py                         | 329   | util           | —                                                     | pending |       |
| utils/prediction_engine.py           | 205   | util           | —                                                     | pending |       |
| utils/price_monitor.py               | 384   | util           | sheets                                                | pending |       |
| utils/product_intel.py               | 258   | util           | keepa, sheets                                         | pending |       |
| utils/retail_matcher.py              | 363   | util           | —                                                     | pending |       |
| utils/sourcing.py                    | 187   | util           | ebay                                                  | pending |       |
| utils/sports_coach.py                | 191   | util           | anthropic                                             | pending |       |
| utils/staple_monitor.py              | 326   | util           | sqlite                                                | pending |       |
| utils/sync_engine.py                 | 828   | util           | sheets, sqlite                                        | pending |       |
| utils/translator.py                  | 504   | util           | keepa, anthropic, ollama, chromadb, telegram, dropbox | pending |       |

## Tier 2 — Data/Client (53 modules)

| Module                            | Lines | Classification | External Deps                                  | Status  | Notes |
| --------------------------------- | ----- | -------------- | ---------------------------------------------- | ------- | ----- |
| crawlers/sp_enrich.py             | 322   | util           | keepa, chromadb, telegram                      | pending |       |
| pages/91_Welcome.py               | 15    | page           | —                                              | pending |       |
| scripts/delete_dupes_apr.py       | 142   | util           | sheets                                         | pending |       |
| scripts/dropbox_archiver.py       | 462   | util           | dropbox                                        | pending |       |
| scripts/seed_costco_apr14.py      | 90    | util           | sheets                                         | pending |       |
| scripts/seed_cra_gst_apr15.py     | 72    | util           | sheets                                         | pending |       |
| scripts/seed_grocery_inventory.py | 128   | util           | sheets                                         | pending |       |
| tests/test_audit_fixes.py         | 251   | test           | —                                              | pending |       |
| tests/test_efficiency.py          | 149   | test           | —                                              | pending |       |
| tests/test_knowledge_pipeline.py  | 149   | test           | —                                              | pending |       |
| tools/trading_predictions.py      | 1373  | util           | sheets, anthropic                              | pending |       |
| utils/ai.py                       | 44    | util           | anthropic                                      | pending |       |
| utils/alerts.py                   | 176   | util           | telegram                                       | pending |       |
| utils/amazon.py                   | 2129  | client         | sp_api, keepa, sheets                          | pending |       |
| utils/api_client.py               | 113   | util           | sheets                                         | pending |       |
| utils/audit_log.py                | 198   | util           | sheets                                         | pending |       |
| utils/auto_reconcile.py           | 632   | util           | sheets, anthropic, telegram                    | pending |       |
| utils/book_lookup.py              | 48    | util           | —                                              | pending |       |
| utils/brand_risk.py               | 396   | util           | sheets                                         | pending |       |
| utils/bsr_history.py              | 125   | util           | sheets                                         | pending |       |
| utils/calendar_helper.py          | 202   | client         | gmail                                          | pending |       |
| utils/coach_brain.py              | 612   | util           | keepa, anthropic, ollama, chromadb, telegram   | pending |       |
| utils/config.py                   | 116   | config         | sheets                                         | pending |       |
| utils/coupon_lady.py              | 252   | util           | sheets                                         | pending |       |
| utils/drive.py                    | 156   | util           | dropbox                                        | pending |       |
| utils/dropbox_statements.py       | 802   | util           | sheets, anthropic, dropbox                     | pending |       |
| utils/ebay_api.py                 | 203   | client         | ebay                                           | pending |       |
| utils/ebay.py                     | 307   | util           | ebay                                           | pending |       |
| utils/email_invoices.py           | 497   | client         | keepa, sheets, gmail, anthropic, dropbox       | pending |       |
| utils/flyer_intel.py              | 208   | util           | anthropic                                      | pending |       |
| utils/gmail.py                    | 458   | client         | keepa, sheets, gmail, anthropic, dropbox, ebay | pending |       |
| utils/keepa_api.py                | 402   | client         | keepa                                          | pending |       |
| utils/keepa_harvester.py          | 983   | util           | keepa, sheets, chromadb                        | pending |       |
| utils/life_pl.py                  | 1142  | util           | sheets, dropbox                                | pending |       |
| utils/local_ai.py                 | 864   | util           | sheets, anthropic, ollama, chromadb            | pending |       |
| utils/managed_agent.py            | 384   | util           | sheets, anthropic                              | pending |       |
| utils/masterfile.py               | 215   | client         | sheets                                         | pending |       |
| utils/n8n_webhooks.py             | 1078  | util           | sheets, anthropic, telegram, dropbox           | pending |       |
| utils/onboarding.py               | 181   | util           | sheets                                         | pending |       |
| utils/quick_vision.py             | 196   | util           | —                                              | pending |       |
| utils/redflagdeals.py             | 340   | util           | —                                              | pending |       |
| utils/retail_intel.py             | 946   | util           | sheets                                         | pending |       |
| utils/retail_scout.py             | 318   | util           | sheets                                         | pending |       |
| utils/sheets_context.py           | 697   | util           | keepa, sheets                                  | pending |       |
| utils/sheets.py                   | 301   | client         | sheets                                         | pending |       |
| utils/sports_backtester.py        | 643   | util           | sheets                                         | pending |       |
| utils/sports_odds.py              | 304   | util           | —                                              | pending |       |
| utils/statement_rules.py          | 125   | util           | sheets                                         | pending |       |
| utils/stocktrack_api.py           | 437   | client         | telegram                                       | pending |       |
| utils/telegram_utils.py           | 155   | util           | sheets, telegram                               | pending |       |
| utils/token_tracker.py            | 175   | util           | sheets, anthropic                              | pending |       |
| utils/voice.py                    | 51    | util           | —                                              | pending |       |
| utils/weekly_digest.py            | 375   | util           | sheets, telegram                               | pending |       |

## Tier 3 — Display Pages (53 modules)

| Module                         | Lines | Classification | External Deps                                            | Status  | Notes |
| ------------------------------ | ----- | -------------- | -------------------------------------------------------- | ------- | ----- |
| pages/1_Life_PL.py             | 355   | page           | —                                                        | pending |       |
| pages/17_Payouts.py            | 213   | page           | sheets                                                   | pending |       |
| pages/23_Expense_Dashboard.py  | 476   | page           | sheets                                                   | pending |       |
| pages/25_Personal_Expenses.py  | 239   | page           | —                                                        | pending |       |
| pages/26_Sales_Charts.py       | 405   | page           | sp_api, sheets                                           | pending |       |
| pages/28_Category_PL.py        | 356   | page           | sheets                                                   | pending |       |
| pages/29_Groceries.py          | 792   | page           | sheets, anthropic                                        | pending |       |
| pages/37_Command_Centre.py     | 835   | page           | keepa, sheets, gmail, anthropic, telegram, dropbox, ebay | pending |       |
| pages/41_Coupon_Lady.py        | 869   | page           | anthropic                                                | pending |       |
| pages/47_Lego_Vault.py         | 719   | page           | keepa, sheets                                            | pending |       |
| pages/48_Retail_Monitor.py     | 194   | page           | telegram                                                 | pending |       |
| pages/50_3D_Printer_HQ.py      | 649   | page           | sheets, anthropic                                        | pending |       |
| pages/51_Retirement_Tracker.py | 291   | page           | keepa                                                    | pending |       |
| pages/52_Utility_Tracker.py    | 141   | page           | sheets                                                   | pending |       |
| pages/53_Business_History.py   | 352   | page           | sheets                                                   | pending |       |
| pages/54_Monthly_Close.py      | 732   | page           | sheets, telegram, dropbox                                | pending |       |
| pages/55_Phone_Plans.py        | 301   | page           | anthropic                                                | pending |       |
| pages/63_Debt_Payoff.py        | 650   | page           | sheets                                                   | pending |       |
| pages/67_Cash_Forecast.py      | 322   | page           | sheets                                                   | pending |       |
| pages/68_Goals.py              | 330   | page           | sheets                                                   | pending |       |
| pages/69_Subscriptions.py      | 303   | page           | sheets                                                   | pending |       |
| pages/70_Family.py             | 284   | page           | sheets                                                   | pending |       |
| pages/71_Savings_Goals.py      | 442   | page           | sheets                                                   | pending |       |
| pages/73_Keepa_Intel.py        | 410   | page           | keepa, chromadb                                          | pending |       |
| pages/74_Product_Intel.py      | 315   | page           | telegram                                                 | pending |       |
| pages/78_Automations.py        | 354   | page           | sheets                                                   | pending |       |
| pages/79_MileIQ.py             | 216   | page           | sheets                                                   | pending |       |
| pages/8_Bookkeeping_Hub.py     | 688   | page           | sheets, dropbox                                          | pending |       |
| pages/80_Deal_Tracker.py       | 233   | page           | sheets, telegram                                         | pending |       |
| pages/81_Prediction_Engine.py  | 416   | page           | —                                                        | pending |       |
| pages/82_Oura_Health.py        | 230   | page           | sheets                                                   | pending |       |
| pages/83_Grocery_Tracker.py    | 1557  | page           | sheets, anthropic                                        | pending |       |
| pages/84_Agent_Swarm.py        | 488   | page           | sheets, anthropic                                        | pending |       |
| pages/85_Retail_Radar.py       | 569   | page           | sheets                                                   | pending |       |
| pages/86_Polymarket.py         | 238   | page           | sheets                                                   | pending |       |
| pages/87_Coras_Future.py       | 304   | page           | sheets                                                   | pending |       |
| pages/88_Pet_Health.py         | 490   | page           | sheets, anthropic                                        | pending |       |
| pages/89_Accuracy_Dashboard.py | 285   | page           | ollama                                                   | pending |       |
| pages/9_Profile.py             | 114   | page           | —                                                        | pending |       |
| pages/90_CMS.py                | 434   | page           | —                                                        | pending |       |
| pages/92_Help.py               | 188   | page           | —                                                        | pending |       |
| pages/94_Personal_Archive.py   | 303   | page           | sheets, chromadb, dropbox                                | pending |       |
| pages/95_Legal_Advisor.py      | 299   | page           | anthropic, chromadb                                      | pending |       |
| pages/96_GPU_Day.py            | 258   | page           | anthropic, ollama, chromadb                              | pending |       |
| pages/tax_centre/megan_tax.py  | 1074  | util           | sheets                                                   | pending |       |
| telegram_bot.py                | 1641  | util           | keepa, sheets, anthropic, ollama, chromadb, telegram     | pending |       |
| tests/test_cashback_hq.py      | 407   | test           | sheets, anthropic                                        | pending |       |
| tests/test_dev_mode.py         | 116   | test           | —                                                        | pending |       |
| tests/test_life_compass.py     | 285   | test           | sheets, anthropic                                        | pending |       |
| utils/dev_mode.py              | 84    | util           | —                                                        | pending |       |
| utils/health_check.py          | 328   | util           | —                                                        | pending |       |
| utils/help_tooltips.py         | 28    | util           | —                                                        | pending |       |
| utils/market_data.py           | 744   | util           | —                                                        | pending |       |

## Tier 4 — Interactive Pages (39 modules)

| Module                        | Lines | Classification | External Deps                                                       | Status  | Notes |
| ----------------------------- | ----- | -------------- | ------------------------------------------------------------------- | ------- | ----- |
| pages/10_Admin.py             | 935   | page           | keepa, sheets, anthropic, telegram, dropbox                         | pending |       |
| pages/12_Receipts.py          | 2641  | page           | sheets, gmail, anthropic, dropbox                                   | pending |       |
| pages/13_Vehicles.py          | 279   | page           | sheets, anthropic                                                   | pending |       |
| pages/2_Trading_Journal.py    | 1904  | page           | sheets, anthropic                                                   | pending |       |
| pages/20_Scout.py             | 692   | page           | sp_api, keepa, sheets, anthropic                                    | pending |       |
| pages/21_PageProfit.py        | 3374  | page           | sp_api, keepa, sheets, anthropic, ebay                              | pending |       |
| pages/22_Inventory_Spend.py   | 748   | page           | sheets, anthropic                                                   | pending |       |
| pages/24_Calendar.py          | 870   | page           | sheets, anthropic                                                   | pending |       |
| pages/3_Sports_Betting.py     | 2042  | page           | sheets, anthropic, ollama                                           | pending |       |
| pages/30_Shipment_Manager.py  | 1177  | page           | sheets                                                              | pending |       |
| pages/35_Scoutly.py           | 296   | page           | sheets                                                              | pending |       |
| pages/38_Paper_Trail.py       | 1035  | page           | sheets                                                              | pending |       |
| pages/4_Monthly_Expenses.py   | 1040  | page           | sheets, anthropic                                                   | pending |       |
| pages/42_Retail_Scout.py      | 641   | page           | anthropic                                                           | pending |       |
| pages/46_Arbitrage_Scanner.py | 1633  | page           | keepa, sheets                                                       | pending |       |
| pages/49_Cashback_HQ.py       | 1859  | page           | keepa, sheets, anthropic                                            | pending |       |
| pages/5_Monthly_PL.py         | 2127  | page           | sheets, anthropic                                                   | pending |       |
| pages/56_Insurance.py         | 1573  | page           | sheets, anthropic                                                   | pending |       |
| pages/58_Tax_Return.py        | 1223  | page           | sheets                                                              | pending |       |
| pages/59_Shipments.py         | 575   | page           | sheets                                                              | pending |       |
| pages/6_Tax_Centre.py         | 148   | page           | —                                                                   | pending |       |
| pages/60_Amazon_Orders.py     | 899   | page           | sp_api, sheets                                                      | pending |       |
| pages/61_Net_Worth.py         | 572   | page           | sheets                                                              | pending |       |
| pages/62_eBay.py              | 1326  | page           | sheets, anthropic, ebay                                             | pending |       |
| pages/64_Marketplace_Hub.py   | 1319  | page           | keepa, sheets, anthropic, ebay                                      | pending |       |
| pages/65_Repricer.py          | 913   | page           | sp_api, sheets                                                      | pending |       |
| pages/66_Notifications.py     | 311   | page           | sheets                                                              | pending |       |
| pages/7_Inventory.py          | 1095  | page           | sheets                                                              | pending |       |
| pages/72_Local_AI.py          | 174   | page           | ollama                                                              | pending |       |
| pages/75_Retail_HQ.py         | 1466  | page           | keepa, sheets, telegram                                             | pending |       |
| pages/76_Crypto.py            | 514   | page           | sheets                                                              | pending |       |
| pages/77_AI_Coach.py          | 1030  | page           | keepa, sheets, anthropic, ollama, chromadb, telegram                | pending |       |
| pages/8_Health.py             | 1578  | page           | sheets, anthropic                                                   | pending |       |
| pages/80_AI_Chat.py           | 212   | page           | ollama                                                              | pending |       |
| pages/93_Life_Compass.py      | 990   | page           | sheets, anthropic                                                   | pending |       |
| pages/97_Dropbox_Archiver.py  | 141   | page           | dropbox                                                             | pending |       |
| pages/98_Debug.py             | 895   | page           | keepa, sheets, anthropic, ollama, chromadb, telegram, dropbox, ebay | pending |       |
| pages/tax_centre/colin_tax.py | 6923  | client         | sheets, anthropic, dropbox                                          | pending |       |
| utils/debug.py                | 145   | util           | —                                                                   | pending |       |

## Tier 5 — Deep Streamlit UX (8 modules)

| Module                    | Lines | Classification | External Deps                               | Status  | Notes |
| ------------------------- | ----- | -------------- | ------------------------------------------- | ------- | ----- |
| app.py                    | 202   | page           | —                                           | pending |       |
| Business_Review.py        | 4010  | page           | sheets, gmail, anthropic, telegram, dropbox | pending |       |
| pages/99_n8n_Webhook.py   | 114   | page           | telegram                                    | pending |       |
| pages/99_Scanner_Phone.py | 168   | page           | sheets                                      | pending |       |
| tests/conftest.py         | 92    | client         | keepa, sheets, anthropic, telegram          | pending |       |
| utils/auth.py             | 2133  | config         | sheets                                      | pending |       |
| utils/data_layer.py       | 817   | config         | keepa, anthropic, sqlite, ebay              | pending |       |
| utils/style.py            | 717   | config         | —                                           | pending |       |

## Dead / Skip (3 modules)

| Module                    | Lines | Classification | External Deps               | Status  | Notes |
| ------------------------- | ----- | -------------- | --------------------------- | ------- | ----- |
| utils/knowledge_export.py | 618   | dead           | sheets, anthropic, chromadb | pending |       |
| utils/proactive_agents.py | 481   | dead           | sheets                      | pending |       |
| utils/task_queue.py       | 38    | dead           | —                           | pending |       |
