# Decision: Retail_Monitor — Build It

**Date:** 2026-05-14
**Decision by:** Colin Loeppky
**Status:** Decided — Build

---

## Decision

Build the Retail_Monitor module. Queue as a harness task with `awaiting_grounding` status pending coordinator spec phase.

---

## What Retail_Monitor Is

Real-time inventory monitoring via StockTrack (Streamlit source: `75_Retail_HQ.py`). Monitors retail store inventory across locations for resale arbitrage opportunities — tracks which stores have which items in stock.

## Why Build It

Directly connected to the Amazon FBA resale business. Retail arbitrage requires knowing what's in stock at local stores before making a sourcing trip. This feeds purchase decisions and inventory pipeline.

## Connections to F17 (Behavioral Ingestion)

- Store visit → purchase decision → inventory event → sales signal chain
- Retail source location data enriches buy-box pricing confidence
- StockTrack hit rate is a leading indicator for gross margin per trip

## What's Needed Before Build

1. Coordinator study of `75_Retail_HQ.py` Streamlit source
2. Grounding doc (same format as `docs/sprint-5/grounding/inventory.md`)
3. Decision on StockTrack API vs. scraped data source
4. Integration point with FBA Inventory module (items sourced at retail → COGS entry)

## Task Queue Status

Queued as `awaiting_grounding` — coordinator must write the grounding doc before builder can start.
