# Acceptance Doc — chore: expand KNOWN_EVENT_DOMAINS whitelist

**Task ID:** `782a885e-6910-44f2-843c-0df872077378`
**Source:** morning_diagnostics_2026_04_28
**Coordinator approved:** 2026-05-10T03:22:00Z (META-C auto-proceed)

---

## Scope

Expand the `KNOWN_EVENT_DOMAINS` array in `lib/orchestrator/config.ts` to include
the seven domain strings currently produced by live modules but absent from the whitelist:
`gmail`, `amazon`, `harness`, `coordinator`, `twin`, `telegram`, `purpose_review`.

**Acceptance criterion:** After the change, `KNOWN_EVENT_DOMAINS` contains all 15 values
(8 original + 7 new). The morning digest's event-log-consistency check produces zero
false-positive unknown-domain alerts for these domains. `npm test` passes with no new failures.

---

## Out of scope

- Any other changes to `lib/orchestrator/config.ts`
- Registering these domains in any other table or schema
- Schema migrations of any kind

---

## Files expected to change

- `lib/orchestrator/config.ts` — `KNOWN_EVENT_DOMAINS` array only (one hunk, additive)

---

## Check-Before-Build findings

- File exists at `lib/orchestrator/config.ts:7`
- Current array: `['commerce', 'knowledge', 'safety', 'orchestrator', 'health', 'pageprofit', 'system', 'ollama']` (8 entries)
- 7 new entries to add: `gmail`, `amazon`, `harness`, `coordinator`, `twin`, `telegram`, `purpose_review`
- No migration needed; no RLS; no external API call

---

## External deps tested

None — config-only change. No external calls.

---

## Grounding checkpoint

Run after merge:

```bash
grep -A 20 'KNOWN_EVENT_DOMAINS' lib/orchestrator/config.ts
```

Confirm all 15 domains are present. No physical-world artifact required (`grounding_question` is null on the task row).

---

## Kill signals

- TypeScript compile errors introduced by the edit
- Any existing test starts failing after the change

---

## Cached-principle decisions

**META-C auto-proceed.** Change is purely additive (7 strings appended to an array). Fully
reversible-free (delete the 7 lines). No schema, no RLS, no UI, no data-model semantics.
`cache_match_enabled: true` per sprint-state.md (Colin confirmed 2026-05-01). Confidence: high.

---

## Open questions

None.
