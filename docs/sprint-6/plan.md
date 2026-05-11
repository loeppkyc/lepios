# Sprint 6 — PageProfit Phase 2: List → Ship Pipeline

**Opened:** 2026-05-10
**Approved by:** Colin — explicit delegation ("I trust you on this. Get all of this done without me.")
**Kill criterion:** A user can scan a book, see a BUY decision, and press "List on Amazon" to create a real FBA listing on Amazon CA — confirmed by checking Manage Inventory in Seller Central.

## Context

Sprint 3 built scan → evaluate (research, decision, hit lists). Sprint 6 builds the back half of the pipeline: list → ship. The reference is Loeppky Streamlit's `pages/21_PageProfit.py` and `pages/30_Shipment_Manager.py`, studied in full before writing these specs. The 20% Better bar is set by Supabase persistence, real-time status tracking, and mobile-first UI.

## Chunk dependency graph

```
A (List on Amazon)  ──┬── D (FBA Batch Manager)
                       │
B (eBay Sold Comps) ──┤ (independent)
                       │
C (Scan History)   ────┘ (independent)
```

## Chunk list

| Chunk | Title | Migration | Priority | Depends on |
|-------|-------|-----------|----------|-----------|
| A | List on Amazon | 0197 | P0 — most impactful feature | none |
| B | eBay Sold Comps | none | P1 — adds sell-through signal | none |
| C | Scan History page | none | P1 — tables already exist | none |
| D | FBA Batch Manager | 0198 | P2 — groups items for shipment | A |

## Phase 1 execution

Chunks A, B, C run in parallel (separate worktrees).
Chunk D runs after A's PR merges.

## Cache-match governance

Colin's explicit "I trust you, do your best" delegation in this session is the approval for all four acceptance docs. cache_match_enabled: true. Every doc is reversible (additive migrations, new routes, no destructive ops).
