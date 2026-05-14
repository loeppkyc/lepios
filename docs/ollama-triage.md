# Ollama Triage Rubric

**Purpose:** Decide which tasks Ollama (local, free) can own vs. which must go to Claude frontier (billed, external). Use this rubric when routing any autonomous harness task, coordinator sub-task, or ad-hoc request.

**Last updated:** 2026-05-14

---

## Quick Decision Tree

```
Is the task spec complete and unambiguous?
├── NO  → Claude frontier (coordinator needs judgment)
└── YES → Does it touch schema migrations or RLS?
          ├── YES → Claude frontier (F24, security judgment required)
          └── NO  → Does it span more than 3 files with cross-cutting logic?
                    ├── YES → Claude frontier (multi-file reasoning)
                    └── NO  → Single TypeScript file following an existing pattern?
                              ├── YES → Ollama 7B (code editing)
                              └── NO  → Structured analysis / classification on known data?
                                        ├── YES → Ollama 32B (signal_review, anomaly detection)
                                        └── NO  → Claude frontier
```

---

## Tier Table

| Tier                | Model               | Use for                                                                                                                                                                                                       | Never use for                                                                      |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Ollama 7B**       | `qwen2.5-coder:7b`  | TypeScript edits matching an existing pattern, new API routes from cron-secret template, SQL queries against known tables, new components mirroring existing examples, tests following existing test patterns | Architecture decisions, spec ambiguity, RLS/schema changes                         |
| **Ollama 32B**      | `qwen2.5:32b`       | `signal_review` anomaly scan of agent_events, knowledge_dedupe text classification, structured JSON extraction from known-schema text, short Q&A against loaded context                                       | Multi-file refactors, anything requiring real-world knowledge past training cutoff |
| **Claude frontier** | `claude-sonnet-4-6` | Schema migrations + RLS policies, complex multi-file refactors, sprint planning, coordinator spec-writing, grounding verification, any task with spec ambiguity                                               | Single-file code edits that match an existing pattern — too expensive              |

---

## Known Good Tasks for Ollama

These task types have been validated and reliably complete without frontier escalation:

| Task type                                      | Tier | Validated           | Notes                                      |
| ---------------------------------------------- | ---- | ------------------- | ------------------------------------------ |
| `signal_review` in daytime-tick                | 32B  | 2026-05-14 (spec)   | Anomaly scan over last 12h of agent_events |
| `knowledge_dedupe`                             | 32B  | Not yet (queued p7) | Text deduplication, no schema changes      |
| New API route from cron-secret template        | 7B   | Pattern confirmed   | Must pass `requireCronSecret` check        |
| SQL query against known tables                 | 7B   | Pattern confirmed   | Must grep table name before writing        |
| TypeScript component mirroring an existing one | 7B   | Pattern confirmed   | Read target file first                     |
| Test file following existing test patterns     | 7B   | Pattern confirmed   | Read existing test for the module first    |

---

## Known Bad Tasks for Ollama (Always Escalate)

| Task type                                                  | Why frontier required                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Schema migrations with new tables or RLS                   | F24 grants + RLS judgment; silent 42501 errors cost weeks          |
| Complex multi-file refactors (>3 files)                    | 7B loses cross-file coherence; misses import chains                |
| Coordinator sprint planning                                | Requires context reasoning across the full codebase + task history |
| Grounding verification against Streamlit baseline          | Needs retrieval + comparison judgment                              |
| Any task with "awaiting_grounding" status                  | Blocked on Colin decision — no model can unblock it                |
| Architecture decisions (new table design, new lib/ module) | Check-before-build rule requires GitHub prior art scan             |

---

## Escalation Thresholds

When an Ollama task produces output, apply these gates before accepting it:

| Signal                                                                  | Action                            |
| ----------------------------------------------------------------------- | --------------------------------- |
| Output confidence < 0.4 (`extractConfidence` < 0.4)                     | Discard, escalate to frontier     |
| Response contains "I'm not sure" / "it depends" / "you might want to"   | Flag for Colin review             |
| Output imports a file path that doesn't exist in the repo               | Block; Ollama hallucinated a path |
| Output adds `style={}` in TSX                                           | Block; F20 violation              |
| Output inlines cron-secret check instead of calling `requireCronSecret` | Block; F22 violation              |
| Output references a table name not in `information_schema.tables`       | Block; F-L3 pattern               |
| Task requires > 2 retries (global retry limit)                          | Stop, escalate to Colin           |

---

## F18 Metrics

Track these per Ollama task execution. Log to `agent_events` with `domain: 'ollama_triage'`.

| Metric                   | Unit                                           | Target                 | How to measure                                                |
| ------------------------ | ---------------------------------------------- | ---------------------- | ------------------------------------------------------------- |
| Task completion rate     | % tasks completing without frontier escalation | ≥ 70% of routed tasks  | `count(completed) / count(routed)` in agent_events            |
| Escalation rate          | % tasks escalated to frontier                  | < 30%                  | Inverse of above                                              |
| Output confidence (7B)   | avg `extractConfidence` score                  | ≥ 0.65                 | Mean over rolling 30 tasks                                    |
| Wall time (7B code edit) | seconds                                        | < 90s                  | `duration_ms` in agent_events                                 |
| Wall time (32B analysis) | seconds                                        | < 45s warm, < 60s cold | `duration_ms` in agent_events                                 |
| F-rule violation rate    | violations per 10 tasks                        | 0                      | Grep output for `style=`, `CRON_SECRET`, unlisted table names |

Ask the system: "How is Ollama triage doing?" → query `agent_events` for `domain: 'ollama_triage'` rows and compute the above from `output_summary`.

---

## AI Dispatcher Integration

The `/api/ai/dispatch` endpoint (task 582c5d5f, depends on Step 6.5) will use this rubric to route tasks. The classification logic lives at `lib/orchestrator/ai-dispatcher.ts`. Routing decision is written to `output_summary` of the resulting `agent_events` row so Colin can audit which tier handled each task.

Dispatcher should:

1. Check task against the Tier Table
2. If Ollama-routable: call Ollama, apply escalation threshold gates
3. If gate fails: re-route to Claude frontier with the original task + Ollama's attempt as context
4. Log routing decision (`tier_chosen`, `escalation_reason` if applicable) in agent_events

---

## Review Cadence

This rubric should be updated when:

- A new task type is confirmed reliable for Ollama (add to Known Good table)
- An Ollama task fails in production and the failure class wasn't in Known Bad (add it)
- F18 metrics show escalation rate > 40% over 30 tasks (re-tier some Known Good tasks)
- GPU upgrade ships and 32B becomes available for tasks previously tiered at 7B
