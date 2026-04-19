# colin-principles.md

Codified judgment for the LepiOS autonomous build loop. Coordinator and builder sub-agents pattern-match against this file before acting.

**How to read a principle:**

- **Trigger** — the situation that activates it
- **Rule** — the decision
- **Why** — rationale (for extrapolating to edge cases)
- **Tag** — for retrieval
- **Strength** — `ALWAYS` (never override without Colin) or `DEFAULT` (principled override allowed per cited exception)
- **Audience** — `coordinator`, `builder`, or `both`

**How to propose new principles:** Coordinator drafts under `## Proposed` at the bottom. Colin moves proposed → ratified. Builder never proposes.

---

## Meta-principles

### META-A — Conflict resolution

- **Rule:** ALWAYS-tagged principles in `grounding` / `data-integrity` / `escalation` outrank DEFAULT-tagged principles in `scope` / `code-quality` when they conflict.
- **Why:** Safety preempts speed. Correctness preempts throughput.
- **Audience:** both
- **Strength:** ALWAYS

### META-B — Cache staleness

- **Rule:** Principles are sprint-agnostic. Specific decisions (vendor choice, threshold numbers, schema trade-offs) expire at sprint boundaries unless explicitly re-ratified.
- **Why:** Principles are about _how_ Colin decides; specific decisions are about _what_ he decided given sprint-specific context. Context changes across sprints.
- **Audience:** coordinator
- **Strength:** ALWAYS

### META-C — Cached-match threshold

- **Rule:** Coordinator can act on a cached match only when (a) trigger conditions match exactly, (b) no new information in this session contradicts the prior decision, (c) the action is reversible. Fail any → escalate.
- **Why:** Pattern matching is the 80% shortcut. The 20% is where patterns look right but aren't.
- **Audience:** coordinator
- **Strength:** ALWAYS

---

## Ratified principles

### 1 — Live-test external endpoints before trusting them

- **Trigger:** Any external API mentioned in a Streamlit reference file or proposed acceptance doc.
- **Rule:** Live-test the endpoint before writing the acceptance doc. Don't trust the doc until a real response comes back. Cache the test result within a sprint; re-test on sprint boundary.
- **Why:** Streamlit was a brain-dump prototype. APIs we used months ago may be dead, renamed, or require new entitlements (eBay Finding API sunset Jan 2025).
- **Tag:** external-deps, grounding
- **Audience:** coordinator
- **Strength:** ALWAYS

### 2 — Split until a grounding checkpoint fits

- **Trigger:** Proposed chunk scope exceeds one sentence with one acceptance criterion — OR — proposed chunk contains multiple separable criteria.
- **Rule:** Can a grounding checkpoint fit between criteria? If yes, split. If no (criteria are atomic and verified by the same grounding moment), pairing is allowed.
- **Why:** Accuracy Zone (§8.5). Big scope + long chains = context degradation + no grounding checkpoint until too late.
- **Tag:** scope
- **Audience:** coordinator
- **Strength:** ALWAYS

### 3 — FK over copy (default)

- **Trigger:** Proposed schema column that mirrors data from another table.
- **Rule:** Use a foreign key to the source table, not a copy. Never duplicate data across tables. _See #10 for ledger/audit exception._
- **Why:** When the source changes, copies go stale silently. Migration debt compounds.
- **Tag:** data-integrity
- **Audience:** both
- **Strength:** ALWAYS

### 4 — Ship only the enum values with live write paths

- **Trigger:** Proposed enum with "maybe useful later" values.
- **Rule:** Ship only values with active write paths. Defer the rest. `ALTER TYPE ADD VALUE` is non-destructive; adding later is free.
- **Why:** Dead enum values become lies. YAGNI.
- **Tag:** scope, data-integrity
- **Audience:** both
- **Strength:** ALWAYS

### 5 — Tag user-scoped literals for Sprint 5

- **Trigger:** Any hardcoded `person_handle = 'colin'` or user-scoped string literal.
- **Rule:** Tag with `// SPRINT5-GATE` comment for future multi-user migration.
- **Why:** Consistent grep target when Sprint 5 lands.
- **Tag:** code-quality
- **Audience:** builder
- **Strength:** ALWAYS

### 6 — Honest labels

- **Trigger:** Labels or UI text that could imply data we don't have.
- **Rule:** Name what the data actually is, not what we wish it were. "Listed" not "sold." "Estimated" not "actual."
- **Why:** Dishonest labels poison the decision surface and erode trust in every number on the page.
- **Tag:** grounding, data-integrity
- **Audience:** both
- **Strength:** ALWAYS

### 7 — New signals are reference-only until ground-truthed

- **Trigger:** New signal/data source considered for a buy/skip gate.
- **Rule:** Display as reference only until validated against real sell-through data. Only Amazon CA profit gates decisions in Sprint 3.
- **Why:** Ungated signals produce confident wrong recommendations. Validate before gating.
- **Tag:** domain-amazon, grounding
- **Audience:** both
- **Strength:** DEFAULT — overridable when a signal has a hard real-world anchor (e.g., live buy-box price)

### 8 — Translate, don't port

- **Trigger:** Streamlit reference file suggests porting verbatim.
- **Rule:** Translate the ~20% business logic. Rebuild UI and data layer. Streamlit pages are ~80% scaffolding.
- **Why:** Direct port carries session-state and Google Sheets assumptions into Next.js. Wrong abstraction.
- **Tag:** code-quality, scope
- **Audience:** both
- **Strength:** ALWAYS

### 9 — Cheapest-compliant call by default

- **Trigger:** Token-cost-per-call is non-trivial (Keepa, Claude API, any metered API).
- **Rule:** Default to cheapest compliant call. Upgrade only on-demand with explicit cache TTL.
- **Why:** Quota burn is a silent killer. CLAUDE.md F7: stats_only default, history=1 only on tap.
- **Tag:** cost, external-deps
- **Audience:** both
- **Strength:** ALWAYS

### 10 — Pointer over snapshot, except audit

- **Trigger:** Any write path includes a snapshot value instead of a pointer.
- **Rule:** Prefer pointer (FK). Exception: ledger entries, sign-offs, tax rows — where the snapshot _is_ the point.
- **Why:** Snapshots duplicate; pointers stay fresh. But legal/audit rows need point-in-time truth.
- **Tag:** data-integrity
- **Audience:** both
- **Strength:** DEFAULT — ledger/tax/audit rows are exceptions

### 11 — Placeholders live in one place

- **Trigger:** Decision requires a number we don't have yet (threshold, gate, heuristic).
- **Rule:** Place a plausible placeholder in a centralized constants module, with `// TODO: tune with real data` comment. Never embed a placeholder at multiple sites.
- **Why:** Heuristics need ground-truth before they become laws. Centralization makes the assumption both visible and cheap to update.
- **Tag:** code-quality, grounding
- **Audience:** builder
- **Strength:** ALWAYS

### 12 — Instinct mismatch is a stop signal

- **Trigger:** Real-world check surfaces a mismatch between data and Colin's instinct.
- **Rule:** Stop. Name it. Resolve before moving forward, even if it delays the next chunk.
- **Why:** HeartSmart Cooking BSR spike was caught this way — instinct saw the problem before the chart confirmed it. Colin's instinct at grounding moments is load-bearing.
- **Tag:** grounding, pivot-detection
- **Audience:** coordinator
- **Strength:** ALWAYS — instinct at grounding moments is never auto-dismissed

### 13 — Feature first, cosmetic errors later

- **Trigger:** Error in console or build that doesn't block the feature.
- **Rule:** Verify feature works end-to-end before debugging cosmetic errors. Log cosmetic issues to backlog.
- **Why:** Non-blocking errors consume session time that should ship the chunk. React #418 on /scan was noise; sparkline worked.
- **Tag:** scope, escalation
- **Audience:** both
- **Strength:** DEFAULT — escalate if a "cosmetic" error starts correlating with real failures

### 14 — Real grounding, defined

- **Trigger:** A chunk is complete and tests pass.
- **Rule:** Grounding checkpoint required before next chunk. "Real" means either (a) physical-world artifact (scan, price, dollar) or (b) verified DB state via a query whose output can be sanity-checked by Colin. Not "tests pass."
- **Why:** Tests verify what we thought to test. Real data verifies what we didn't.
- **Tag:** grounding, domain-amazon
- **Audience:** both
- **Strength:** ALWAYS

### 15 — New terrain escalates

- **Trigger:** Proposed module is an outlier from the observed pattern ("we've never done this before").
- **Rule:** Escalate. Don't predict what Colin wants from principles alone.
- **Why:** New terrain with unresolvable tradeoffs is the 20% the coordinator can't cache. Overreach here = confident wrong.
- **Tag:** escalation
- **Audience:** coordinator
- **Strength:** ALWAYS

### 16 — No vendor/situation hardcodes

- **Trigger:** Vendor-specific or situation-specific configuration (buyback vendor, tax category, account name).
- **Rule:** Don't hardcode. Either defer the feature until the vendor is real, or route through an env var + source column.
- **Why:** Single-variable approximations pollute data. Buyback price as one env var would write wrong numbers on every scan.
- **Tag:** data-integrity, domain-amazon
- **Audience:** both
- **Strength:** ALWAYS

### 17 — No speculative infrastructure

- **Trigger:** Feature could be built now or deferred to a later chunk.
- **Rule:** Defer unless it has an active write path in the current chunk.
- **Why:** Every speculative piece is tomorrow's migration debt.
- **Tag:** scope
- **Audience:** both
- **Strength:** ALWAYS

### 18 — Re-ratify on new information

- **Trigger:** Sprint plan predates new information (prototype revealed, priority clarified, external change).
- **Rule:** Stop. Re-ratify the plan before continuing. Propose edits to `ARCHITECTURE.md §7` for Colin to apply.
- **Why:** Pivoting doctrine is cheap. Pivoting after 4 sprints of built code is expensive.
- **Tag:** pivot-detection, escalation
- **Audience:** coordinator
- **Strength:** ALWAYS

### 19 — Destructive ops require Colin

- **Trigger:** Drop table, force-push, delete list, secret rotation, any irreversible operation.
- **Rule:** Explicit Colin approval required. No auto-approve, no cache-match.
- **Why:** Tier 0 Safety preempts all. Irreversibility warrants the pause.
- **Tag:** escalation, deploy
- **Audience:** both
- **Strength:** ALWAYS

### 20 — Session-end handoff

- **Trigger:** End of a chunk or end of a session.
- **Rule:** Write a handoff note. Commit, push, deploy. Leave the tree clean enough for a fresh window to resume.
- **Why:** Context hygiene (§8.5). Future Claude doesn't have your memory.
- **Tag:** code-quality, deploy
- **Audience:** both
- **Strength:** ALWAYS

---

## Operational principles (answers to coordinator's structural questions)

### CHUNK-ORDERING

- **Trigger:** Coordinator is ordering chunks within a sprint plan.
- **Rule:** Order by dependency first, then by grounding-confidence descent. Front-load grounding-heavy chunks when the sprint explores new terrain; back-load when the pattern is grooved. Earliest chunks should be the ones whose failure would most cheaply reveal that a sprint direction is wrong.
- **Why:** Sprint 3 Chunk A (Amazon CA) was grounding-heavy and first because it was the riskiest integration. Chunk C (eBay) was grounding-heavy but later because SP-API was known.
- **Tag:** scope, pivot-detection
- **Audience:** coordinator
- **Strength:** DEFAULT — Colin can override on aesthetic/narrative grounds

### SPRINT-DONE

- **Trigger:** Coordinator evaluating whether a sprint is closeable.
- **Rule:** A sprint is done when (a) every chunk's acceptance criterion passes, (b) the sprint's kill-criterion question from `ARCHITECTURE §11` can be answered "yes" ("does this make or save money this week?"), AND (c) a real-world session using only the new features produces the intended outcome. For Sprint 3: a full pallet session where Colin sources ≥5 real books using only LepiOS, no Streamlit. Test suite green is necessary, not sufficient.
- **Why:** Tests verify what we thought to test. Session verifies the whole thing hangs together.
- **Tag:** grounding, scope
- **Audience:** coordinator
- **Strength:** ALWAYS

### DECOMPOSITION-TRIGGER

- **Trigger:** Mid-flight signal that a chunk's scope needs to change.
- **Rule:** Split a chunk when one of three happens:
  1. Grounding checkpoint surfaces a missing capability (BSR spike → Chunk C.5 sparkline).
  2. Acceptance doc reveals a chunk contains multiple independent grounding moments (Chunk E → E.1 persist / E.2 view / E.3 batch scan / E.4 save-from-card).
  3. A proposed chunk needs a prerequisite that isn't shipped (buyback needs hit list first → defer to backlog).
- **Autonomy:** Coordinator may decompose autonomously for reason 2. Reasons 1 and 3 escalate to Colin.
- **Why:** Mid-flight scope change is normal; the _reason_ determines whether Colin needs to decide.
- **Tag:** scope, pivot-detection, escalation
- **Audience:** coordinator
- **Strength:** ALWAYS

### BUILDER-HANDOFF-FORMAT

- **Trigger:** Builder completes a chunk.
- **Rule:** Return a structured JSON report containing: `chunk_id`, `acceptance_doc_path`, `files_changed[]`, `tests{passing, failing, new}`, `migrations_applied[]`, `deploy_url`, `grounding_checkpoint_required[]`, `unknowns[]`, `next_chunk_blockers[]`, `tokens_used`, `timestamp`. Coordinator may autonomously proceed to the next chunk only when `grounding_checkpoint_required == "none"` AND `unknowns == []` AND `next_chunk_blockers == []`. Anything else escalates.
- **Why:** Prose reports invite coordinator hallucination. Structured fields are boolean-checkable.
- **Tag:** code-quality, escalation
- **Audience:** both
- **Strength:** ALWAYS

### ROLLBACK

- **Trigger:** Grounding checkpoint fails for a shipped chunk.
- **Rule:** Three options, in order of preference:
  1. **Patch forward** if the fix is <30 min and the acceptance criterion can still be met.
  2. **Revert the chunk commit**, re-scope the acceptance doc, rebuild.
  3. **Halt the sprint** and escalate — reserved for cases where the failure suggests the sprint direction is wrong.
- **Autonomy:** Coordinator may choose (1) or (2) autonomously if META-C holds. Option (3) is never coordinator's — always escalates.
- **Why:** Failure modes need different responses. Giving coordinator (3) authority breaks Principle 18.
- **Tag:** escalation, deploy
- **Audience:** coordinator
- **Strength:** ALWAYS

---

## Proposed

_(Coordinator adds here. Colin moves to ratified section above after review. Builder never writes here.)_
