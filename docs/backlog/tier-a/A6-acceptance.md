# A6 — GitHackers: GitHub Trending + HN Who's Hiring Feed

**task_id:** 5f520ddd-066d-4a1f-b5c3-09dd4fded17c
**Tier:** A | **item_id:** A6
**Created:** 2026-05-16
**Author:** coordinator (autonomous)

---

## Scope

Build `GitHackersPage` at `/git-hackers` — a read-only cockpit page with two tabs:
1. **GitHub Trending:** top starred repos pushed in the last 7 days via GitHub search API
2. **HN Hiring:** latest "Ask HN: Who is hiring?" monthly thread top comments via HN Algolia API

**Acceptance criterion:** Both tabs load and display data from their respective public APIs within 5 seconds; empty/error states display gracefully with a retry button; layout uses cockpit design primitives (no inline style= attributes).

---

## Out of Scope

- Saving/persisting any GitHub or HN data to Supabase (v1 ephemeral display only)
- Authentication or per-user personalization
- Language filter UI (language defaults to all, hardcoded; v2 feature)
- Notifications or alerts when specific repos trend
- Saving/bookmarking repos or job posts

---

## Files Expected to Change

**New files:**
- `app/(cockpit)/git-hackers/page.tsx` — cockpit page entry
- `app/(cockpit)/git-hackers/_components/GitHackersPage.tsx` — tab shell + loading state
- `app/(cockpit)/git-hackers/_components/GitHubTrendingTab.tsx` — GitHub trending card list
- `app/(cockpit)/git-hackers/_components/HNHiringTab.tsx` — HN job post card list
- `app/api/git-hackers/github-trending/route.ts` — server route, fetches + caches GitHub API
- `app/api/git-hackers/hn-hiring/route.ts` — server route, fetches + caches HN Algolia → Firebase
- `tests/git-hackers/github-trending.test.ts` — unit test for API route

**Modified files:**
- `app/(cockpit)/_components/` — nav link addition (if nav component exists)
- `.env.example` — add `GITHUB_TOKEN` (optional, increases rate limit from 10 → 30/min)
- `docs/github-prior-art.md` — add Growing Pillar / Tech Pulse section (coordinator does this)

---

## Check-Before-Build Findings

**Repo scan:**
- No existing `git-hackers`, `github-trending`, or `hn-hiring` code anywhere in `app/`, `lib/`, or `components/`. ✓ Build-new.
- No existing HN API client or GitHub search client in `lib/`. Build fresh minimal clients in route handlers.
- Pattern reference: `app/(cockpit)/polymarket/` (external API + tab structure) and `app/(cockpit)/retail-monitor/_components/StockTrackPanel.tsx` (tabbed fetch-on-demand pattern).

**GitHub Prior Art (from `docs/github-prior-art.md`):**
No existing "GitHub trending feed" or "HN jobs feed" entry found in the doc. Entry added below (§ GitHub Prior Art section).

| Repo | Stars | What it does | Verdict | Notes |
|------|-------|-------------|---------|-------|
| `github/rest-api-description` | — | Official GitHub REST API specs | **Reference** | Already using; unauthenticated search = 10/min, authenticated = 30/min |
| `HackerNews/API` | — | Official Firebase + Algolia HN API docs | **Reference** | Algolia endpoint for search + Firebase for item fetch. No auth key. |
| `nickvdyck/github-trending-scraper` | ~200 | Scrapes GitHub Trending page | **Skip** | Fragile scraper. Official GitHub search API is preferred and verified accessible. |

---

## External Deps Tested

| Endpoint | Method | Result | Notes |
|----------|--------|--------|-------|
| `https://api.github.com/search/repositories` | HEAD + GET | ✅ 200 OK | Unauthenticated: 10 req/min search; 3 sample repos returned. Add `GITHUB_TOKEN` env var to raise to 30/min. |
| `https://hn.algolia.com/api/v1/search` | HEAD | ❌ 403 (host_not_allowed in coordinator sandbox) | **Builder must verify from Vercel dev env.** Standard public API — expected to be accessible. Fallback: use `hacker-news.firebaseio.com` items list. |
| `https://hacker-news.firebaseio.com/v0/topstories.json` | HEAD | ❌ 403 (host_not_allowed in coordinator sandbox) | **Builder must verify from Vercel dev env.** Standard public API — expected to be accessible. |

**Coordinator sandbox limitation:** outbound requests to `hn.algolia.com` and `hacker-news.firebaseio.com` are blocked in this coordinator environment (`host_not_allowed`). GitHub API (`api.github.com`) is accessible. Both HN APIs are standard public APIs with no auth required; builder must verify they are accessible from `next dev` or Vercel preview before completing implementation.

---

## Implementation Notes for Builder

### GitHub Trending

Use `GET /search/repositories` with:
```
q=pushed:>{TODAY-7d}&sort=stars&order=desc&per_page=25
```
- `TODAY-7d` = computed server-side at route execution time
- Cache via Next.js `revalidate: 21600` (6 hours) on the route handler
- Return fields: `full_name`, `description`, `stargazers_count`, `language`, `html_url`, `topics`
- Add `Authorization: Bearer ${GITHUB_TOKEN}` header when `GITHUB_TOKEN` env var is present; omit when absent (graceful degradation to 10/min)
- Rate limit: if 403/429 received, return cached last-good response with `stale: true` flag

### HN Who's Hiring

**Step 1 — Find latest thread:**
```
GET https://hn.algolia.com/api/v1/search?query=Ask+HN%3A+Who+is+hiring&tags=story&hitsPerPage=1
```
Extract `objectID` of the top hit (most recent thread).

**Step 2 — Fetch top comments:**
```
GET https://hn.algolia.com/api/v1/search?tags=comment,story_{objectID}&hitsPerPage=50&page=0
```
Return fields: `author`, `comment_text`, `created_at`, `objectID`

- Cache via Next.js `revalidate: 3600` (1 hour)
- Strip HTML tags from `comment_text` for safe rendering (use a simple regex or `sanitize-html` if already in package.json — do NOT add new deps without checking first)
- Show thread title + date in tab header
- If `hn.algolia.com` unreachable: show "HN API unavailable" with retry button. Do not fall back to Firebase scraping.

### F18 Measurement

Log to `agent_events` on each API route execution:
```ts
{
  domain: 'cockpit',
  action: 'githackers_api_fetch',
  actor: 'server',
  status: 'success' | 'error',
  meta: { tab: 'github' | 'hn', result_count: N, latency_ms: N, cached: bool, stale: bool }
}
```
Bench: `latency_ms < 2000` for non-stale calls.

### F17 Behavioral Ingestion Justification

Growing pillar awareness tool. Tech trend visibility (GitHub) and job market context (HN) feed Colin's understanding of the ecosystem he operates in. v1 is display-only (no write path to behavioral_events). v2 can add click-through tracking on repos/posts to `behavioral_events` as soft interest signals for the path-probability engine.

**F17 weakness acknowledged:** v1 has no direct ingestion write path. Justification: display-only modules in the cockpit are permitted when they serve a pillar's awareness function — precedent is Polymarket (prediction markets, no ingestion write in v1). Colin has queued this as Tier A, implying he has judged the utility threshold met.

---

## Grounding Checkpoint

Builder opens `/git-hackers` in dev environment and verifies:
1. **GitHub tab:** Real repo names and star counts appear (not mock/empty). At least 5 repos visible.
2. **HN Hiring tab:** Real job post comments appear from the latest "Who is hiring" thread. Thread title visible with correct month/year.
3. **Error state:** Temporarily break one API call (wrong URL) — confirm graceful error message appears, not a crash.

**Colin's checkpoint:** view both tabs on production URL `lepios-one.vercel.app/git-hackers` — confirm data is real (not static/mock).

This checkpoint IS DB-verifiable as a fallback:
```sql
SELECT meta, occurred_at FROM agent_events
WHERE action = 'githackers_api_fetch' AND status = 'success'
ORDER BY occurred_at DESC LIMIT 5;
```
Expect 2+ rows (one per tab) after Colin views the page.

---

## Kill Signals

- HN Algolia API is inaccessible from Vercel (not just coordinator sandbox) → defer HN tab to v2; ship GitHub tab only
- GitHub API 403s persistently even with token → investigate before shipping
- Page takes >8 seconds to load → redesign to lazy-load tabs

---

## Open Questions

**Pending (twin unreachable — coordinator sandbox blocks lepios-one.vercel.app, HN Algolia, HN Firebase)**

These are non-blocking for the acceptance doc but Colin should answer at grounding:

1. **Use case intent:** Is GitHackers primarily (a) tech trend awareness, (b) freelance/consulting opportunities via HN, or (c) both? Affects whether we add filtering/search in v2.
2. **Language filter:** Should GitHub tab default to a specific language (e.g., TypeScript) or show all? The current spec defaults to all.
3. **HN context:** Colin is not actively job-hunting (building LepiOS + Amazon FBA). Confirm: HN Hiring is for market awareness / occasionally finding collaborators, not employment. If yes, the "Who's Hiring" framing is correct. If Colin wants something different, adjust the acceptance doc before build.

---

## Cached-Principle Decisions

| Decision | Principle | Reversibility |
|----------|-----------|---------------|
| Build-new (no prior art) | §8.4 Check-Before-Build confirmed nothing exists or is close | Reversible — new files, no schema |
| No persistence in v1 | Principle 17 (no speculative infrastructure) | Reversible — migration can add table later |
| GITHUB_TOKEN optional not required | Task spec "no auth keys" | Reversible — can make required later |
| F17 weak justification accepted | Colin queued as Tier A | Reversible — can drop if Colin disagrees |

---

## META-C Reasoning Block

```
2026-05-16T16:55:00Z sprint=tier-a chunk=A6 doc=docs/backlog/tier-a/A6-acceptance.md
cited_principles: [8.4 Check-Before-Build, 17 no-speculative-infrastructure, 14 real-grounding]
trigger_match_evidence: |
  Principle 8.4 trigger: "Before proposing new code" — exact match, new cockpit page.
  Principle 8.4 rule: grep repo (done, nothing found), check github-prior-art.md (done).
  Principle 17 trigger: "feature could be built now or deferred" — v1 defers persistence, filters.
  Principle 14 trigger: "chunk is complete and tests pass" — grounding requires real data on screen.
reversibility_check: |
  New cockpit page: fully reversible (delete files).
  No schema migration (migration_needed: false in metadata).
  .env.example GITHUB_TOKEN: additive, reversible.
  No seam files touched. No canonical writes.
confidence: medium
escalation_decision: ESCALATE — confidence medium triggers escalation per META-C rule.
  Additional reason: external API verifiability gap (HN not testable from coordinator sandbox).
  Proceeding to Telegram approval request.
```

Path C check: FAILS (condition 1 — Phase 1b not run due to twin network block; this is greenfield so 1a-1d nominally skippable, but treating as requiring approval to be safe). Fall through to META-C → medium confidence → escalate.

---

## Status

`awaiting-colin-approval`
