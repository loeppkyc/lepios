# Annual Review — Cross-Links Completion (AC6 + AC7)

**Status:** awaiting-colin-approval → auto-proceeded (META-C, see below)
**Parent doc:** `docs/acceptance/annual-review.md`
**Task:** `33c6cb32-b937-4179-a8fa-ab39ccf07332` (cockpit-annual-review)
**Coordinator session:** `750e46e0-a71e-40a2-914d-e48b88178cf2`

---

## Context

The annual-review implementation is substantially complete — all 7 ACs except two:

| AC | Status | Evidence |
|----|--------|---------|
| AC1: Migration 0135 + 6 seeds | ✅ done | 6 rows in `life_milestones` in prod |
| AC2: /annual-review renders | ✅ done | page.tsx + AnnualReviewPage.tsx complete |
| AC3: Headline "winning" | ✅ done | route.ts logic + tests cover it |
| AC4: Add Milestone form | ✅ done | AddMilestoneForm component complete |
| AC5: Sidebar link | ✅ done | CockpitSidebar.tsx:31 |
| AC6: Cross-links net-worth + life-pnl | ❌ missing | no match in either component |
| AC7: Tests pass | ❓ unverified | test files exist; no node_modules in container |

---

## Scope

**AC6 — Add two cross-links:**

1. **NetWorthPage.tsx** — after the `asOfDate` paragraph (around line 349), add a `<p>` sibling containing a `<Link href="/annual-review">View Annual Review →</Link>`. Style to match the existing muted small-text paragraph pattern in the header area.

2. **LifePnlPage.tsx** — in the page header area, add a `<Link href="/annual-review">→ Annual Review</Link>` sibling. Locate the header (search for "Life P&L" heading) and add adjacent to existing cross-navigation.

**AC7 — Verify tests pass:**
- Run `npm test` (or `npx vitest run`) to confirm full suite green
- Specifically: `tests/api/annual-review.test.ts` and `tests/api/life-milestones.test.ts`

---

## Files expected to change

- `app/(cockpit)/net-worth/_components/NetWorthPage.tsx` — add Link to header
- `app/(cockpit)/life-pnl/_components/LifePnlPage.tsx` — add Link to header

No schema changes. No new API routes.

---

## Check-Before-Build

Both components already import `Link from 'next/link'` — confirmed for NetWorthPage.tsx. Verify LifePnlPage.tsx also imports Link (it does: line 3 in component). Zero additional dependencies.

---

## F20 note

The existing AnnualReviewPage.tsx uses inline `style={}` attributes throughout — predates this build task. The two new Link elements being added should use the existing inline style pattern for consistency (no new violations introduced). Flag for a future F20 audit pass but do not block this task on it.

---

## F24 note

Migration 0135 is missing `GRANT INSERT, UPDATE, DELETE ON life_milestones TO service_role`. Migration was already applied to production. User-facing routes use the `authenticated` RLS policy and are not affected. Service-role writes would fail. Recommend a fixup migration in a separate task. Do NOT block this task on it.

---

## GitHub prior art

No prior art needed — these are link additions to existing pages. Pattern: `<Link href="/…">` with existing in-file style conventions.

---

## Grounding checkpoint

Colin visits `/net-worth` and `/life-pnl` — confirms "View Annual Review →" / "→ Annual Review" links appear and navigate correctly to `/annual-review`.

---

## Kill signals

- If either component has a conflicting cross-nav section already implemented → defer to existing pattern
- If test suite has >0 failing new tests → block and escalate

---

## META-C auto-proceed log

```
2026-05-15 coordinator sprint=cockpit-annual-review chunk=crosslinks doc=docs/acceptance/annual-review-crosslinks.md
cited_principles: [META-C, Principle 2 (split until grounding fits), Principle 17 (no speculative infra)]
trigger_match_evidence: |
  Situation: add two <Link> elements to two existing component headers. No schema, no API,
  no external deps, no new files beyond the two component edits.
  META-C trigger: "additive navigation wiring to existing pages" — same class as adding a
  sidebar link entry. cache_match_enabled: true per sprint-state.md.
  No new information in this session contradicts the decision.
reversibility_check: |
  - Link in NetWorthPage.tsx: reversible by deleting ~5 lines. Cost: trivial.
  - Link in LifePnlPage.tsx: reversible by deleting ~5 lines. Cost: trivial.
  No migration, no data loss, no external effect.
confidence: high
```

Auto-proceeded per META-C. All four conditions satisfied.

---

## Definition of done

- [ ] "View Annual Review →" link visible in /net-worth header
- [ ] "→ Annual Review" link visible in /life-pnl header
- [ ] Both links navigate to /annual-review
- [ ] Full test suite green (including annual-review + life-milestones tests)
- [ ] PR opened, CI green, merged, deploy-verified
