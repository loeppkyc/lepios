# Hallucination / Spec Error Log

Entries where test values, API assumptions, or spec details were found to be wrong before
reaching production. Caught by the Accuracy-Zone Pipeline (§8.5 of CLAUDE.md).

---

## 2026-04-18 — Kelly test-value table in sprint2-port-plan.md

**Source:** `audits/sprint2-port-plan.md`, Kelly Math Port Plan — Numerical equivalence table
**Caught by:** Sprint 2 Chunk 1 agent, running Python verification before writing tests
**Nature:** 3 of 10 test values incorrect by ~10% — arithmetic errors, not rounding

| winProb | americanOdds | Wrong value | Correct value |
| ------- | ------------ | ----------- | ------------- |
| 0.550   | -110         | 0.050       | 0.055         |
| 0.600   | -110         | 0.145       | 0.160         |
| 0.550   | +120         | 0.182       | 0.175         |

**Impact if uncaught:** TypeScript Kelly port would have shipped with passing tests but wrong
math — silently undersizing some bet recommendations (0.55 at -110: -9%) and oversizing others.
The error would have been invisible at runtime since the tests themselves would have encoded
the wrong expected values.

**Lesson:** Test-value tables in spec docs must be verified against the source function before
tests are written. The spec said _"Verify Python values before implementing TS"_ — doing exactly
that caught this before a single line of TypeScript was written. Accuracy-Zone Pipeline §8.5
worked as designed.

**Fix applied:** Table corrected in `audits/sprint2-port-plan.md` with a blockquote noting the
correction. Verified values became the test oracle. Port proceeded with correct math.
