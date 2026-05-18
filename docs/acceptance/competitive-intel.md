# Competitive Intelligence Engine — Acceptance Doc

**Migrations:** `0272_competitive_intel.sql` + `0273_pg_cron_competitive_intel.sql`
**Branch:** `feat/competitive-intel`
**F-rules:** F17, F18, F20, F21, F22, F24

---

## What This Builds

Daily automated scan of arXiv, Papers With Code, and OpenReview for AI research papers relevant to LepiOS (multi-agent reasoning, debate synthesis). Scores by keyword match, flags high-relevance items, injects sprint gap tasks into `task_queue`, and surfaces results as a widget on the Systems page.

**Cron strategy:** Uses pg_cron + net.http_post (same pattern as migrations 0248 and 0250) — does NOT add a Vercel cron entry. The Vercel cron limit is already at capacity.

---

## Read These Files First

- `supabase/migrations/0248_pg_cron_lightning_deals.sql` — pg_cron pattern to replicate
- `supabase/migrations/0250_pg_cron_asin_harvest.sql` — second pg_cron pattern reference
- `app/api/cron/competitive-intel/route.ts` — does NOT exist yet (create new)
- `lib/scraper/rfd.ts` — existing scraper pattern (fetch + parse + upsert)
- `app/(cockpit)/systems/_components/SystemsShell.tsx` — extend with widget section
- `app/(cockpit)/systems/page.tsx` — extend with intel prefetch

---

## Migration 0272 — `0272_competitive_intel.sql`

```sql
CREATE TABLE public.competitive_intel (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  source           TEXT    NOT NULL CHECK (source IN ('arxiv', 'paperswithcode', 'openreview')),
  url              TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  abstract_snippet TEXT,
  relevance_score  FLOAT   NOT NULL DEFAULT 0.0 CHECK (relevance_score >= 0.0 AND relevance_score <= 1.0),
  flagged          BOOLEAN NOT NULL DEFAULT false,
  fed_to_sprint    BOOLEAN NOT NULL DEFAULT false,
  scraped_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes            TEXT,
  UNIQUE (source, url)
);

CREATE INDEX competitive_intel_flagged_idx  ON public.competitive_intel (flagged, scraped_at DESC) WHERE flagged = true;
CREATE INDEX competitive_intel_unfed_idx    ON public.competitive_intel (fed_to_sprint, flagged, scraped_at DESC) WHERE flagged = true AND fed_to_sprint = false;
CREATE INDEX competitive_intel_source_idx   ON public.competitive_intel (source, scraped_at DESC);

ALTER TABLE public.competitive_intel ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitive_intel_authenticated" ON public.competitive_intel
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- F24
GRANT INSERT, UPDATE, DELETE ON public.competitive_intel TO service_role;

-- Seeds
INSERT INTO public.harness_config (key, value, is_secret) VALUES
  ('COMPETITIVE_INTEL_RELEVANCE_THRESHOLD', '0.50', false),
  ('COMPETITIVE_INTEL_ENABLED', 'true', false)
ON CONFLICT (key) DO NOTHING;
```

---

## Migration 0273 — `0273_pg_cron_competitive_intel.sql`

```sql
-- Daily competitive intel scan at 9 AM UTC via pg_cron + pg_net
-- Pattern: identical to 0248 (lightning deals) and 0250 (asin harvest)
SELECT cron.schedule(
  'competitive_intel_daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT value FROM harness_config WHERE key = 'VERCEL_BASE_URL') || '/api/cron/competitive-intel',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT value FROM harness_config WHERE key = 'CRON_SECRET'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);
```

---

## Scorer — `lib/competitive-intel/scorer.ts`

Pure function, no async, no external deps. Testable offline.

```
PRIMARY_KEYWORDS (weight 0.15 each, 6 total → max 0.90):
  'multi-agent debate', 'debate synthesis', 'agent coordination',
  'debate framework', 'adversarial agent', 'multi-agent reasoning'

SECONDARY_KEYWORDS (weight 0.05 each, 9 total → max 0.45):
  'LLM orchestration', 'chain-of-thought', 'self-reflection',
  'task decomposition', 'tool-augmented', 'constitutional AI',
  'autonomous agent', 'coordinator', 'argumentation'

relevance_score = min(primary_hits * 0.15 + secondary_hits * 0.05, 1.0)
```

Input: lowercase title + abstract. Output: float [0.0, 1.0].

---

## Scraper — `lib/competitive-intel/scraper.ts`

Three fetch functions, each with 15s timeout, returning empty array on failure (non-fatal):

### `fetchArxiv(): Promise<RawIntelItem[]>`
```
GET http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.MA&sortBy=submittedDate&max_results=50
Parse Atom XML: extract <entry> elements → { title, url (link href), abstract_snippet (summary first 500 chars) }
```

### `fetchPapersWithCode(): Promise<RawIntelItem[]>`
```
GET https://paperswithcode.com/api/v1/papers/?ordering=-published&page=1
JSON: results[].{ name→title, url, abstract }
```

### `fetchOpenReview(): Promise<RawIntelItem[]>`
```
GET https://api2.openreview.net/notes?content.venue=NeurIPS+2025&offset=0&limit=50
JSON: notes[].{ content.title, id→url as https://openreview.net/forum?id={id}, content.abstract }
```

```typescript
interface RawIntelItem {
  source: 'arxiv' | 'paperswithcode' | 'openreview'
  url: string
  title: string
  abstract_snippet: string
}
```

Use `fetch()` directly (not httpRequest arms-legs gate — that's for coordinator sandbox). Follow the pattern in `lib/scraper/rfd.ts`.

---

## Cron Route — `app/api/cron/competitive-intel/route.ts`

```typescript
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  // 1. requireCronSecret(request) — F22, call FIRST
  // 2. Check COMPETITIVE_INTEL_ENABLED from harness_config
  // 3. Scrape all 3 sources in parallel (Promise.all)
  // 4. Score each item with scoreItem()
  // 5. Upsert to competitive_intel (ON CONFLICT (source, url) DO NOTHING)
  // 6. For flagged items (relevance_score >= threshold) where fed_to_sprint=false:
  //    - INSERT task_queue row (source='cron', metadata.task_type_label='competitive_intel_review')
  //    - If relevance_score >= 0.75: INSERT outbound_notifications (Telegram, plain text)
  //    - UPDATE competitive_intel SET fed_to_sprint=true
  // 7. Log agent_events (domain='competitive_intel', action='competitive_intel.scan')
  // 8. Return { ok: true, fetched, new_items, flagged, fed_to_sprint, duration_ms }
}

export async function GET(request: Request) {
  return POST(request)  // pg_cron may use GET
}
```

**Sprint injection task_queue shape:**
```typescript
{
  task: `[CompIntel] Review: "${title.slice(0, 80)}"`,
  description: `${title}\n\nURL: ${url}\n\nScore: ${relevance_score.toFixed(2)} | Source: ${source}`,
  priority: relevance_score >= 0.8 ? 1 : relevance_score >= 0.6 ? 2 : 3,
  source: 'cron',
  metadata: { task_type_label: 'competitive_intel_review', competitive_intel_id, source, url, relevance_score }
}
```

**Telegram notification:** plain text, `requires_response: false`. No `parse_mode: 'Markdown'` (avoids bracket-parse failures).

---

## UI — Systems Page Widget

**New:** `app/(cockpit)/systems/_components/CompetitiveIntelWidget.tsx` (client component)

Layout:
```
COMPETITIVE INTEL            last scan: {date}  {N} flagged
─────────────────────────────────────────────────────────
[arxiv] 0.85  Paper title (truncated 60 chars)    →link
[pwc]   0.72  Another paper title                 →link
[or]    0.61  Yet another                         →link
                                        [show all N]
```

- Source badge: shadcn/ui `Badge` with variant matching source
- Score color: `>= 0.75` text-positive/green, `0.50–0.74` text-warning, `< 0.50` text-muted-foreground
- External links: `target="_blank" rel="noopener noreferrer"`
- Empty state: "No flagged items yet."
- **F20:** `grep -n "style=" CompetitiveIntelWidget.tsx` must return 0 matches

**Extend `SystemsShell.tsx`:** add `initialIntelItems` prop, render `<CompetitiveIntelWidget>` in a new `<section>` with border-t divider.

**Extend `page.tsx`:** add Supabase query for flagged intel items (limit 20, order scraped_at DESC).

---

## Tests — `tests/competitive-intel/scorer.test.ts`

Minimum 3 cases:
- Zero-match paper → 0.0
- 2 primary keyword hits → 0.30
- 4 primary + 2 secondary → 0.70

---

## Acceptance Criteria

### Migrations
- [ ] `0272_competitive_intel.sql` — table, indexes, RLS, GRANT (F24), harness_config seeds
- [ ] `0273_pg_cron_competitive_intel.sql` — cron.schedule call matching 0248 pattern
- [ ] `vercel.json` NOT modified
- [ ] `scripts/lint-migration-grants.mjs` passes

### Scraper + Scorer
- [ ] `lib/competitive-intel/scorer.ts` — pure function, exports `scoreItem(title, abstract): number`
- [ ] `lib/competitive-intel/scraper.ts` — 3 fetch functions, each returns empty array on failure
- [ ] `tests/competitive-intel/scorer.test.ts` — ≥ 3 cases pass

### Cron route
- [ ] `app/api/cron/competitive-intel/route.ts` exists
- [ ] `requireCronSecret(request)` is first call in handler (F22)
- [ ] Returns 401 without auth, 200 with valid CRON_SECRET
- [ ] On success returns `{ ok, fetched, new_items, flagged, fed_to_sprint, duration_ms }`
- [ ] Logs to `agent_events` on every run

### Sprint injection
- [ ] Flagged unfed items get `task_queue` row with `source='cron'` and `metadata.task_type_label='competitive_intel_review'`
- [ ] `fed_to_sprint=true` after injection
- [ ] `relevance_score >= 0.75` items also get `outbound_notifications` row

### UI
- [ ] `CompetitiveIntelWidget.tsx` renders correctly with seeded data
- [ ] `grep -n "style=" CompetitiveIntelWidget.tsx` → 0 matches (F20)
- [ ] Systems page loads without TypeScript errors

---

## Out of Scope
- Embedding-based scoring (v2)
- HuggingFace / GitHub trending as sources (v2)
- Per-paper code quality evaluation
- Email digest

## F17
Competitive intel review tasks (resolved/cancelled) = Colin's technology adoption decisions = behavioral data for path probability engine.

## F18
- **Metric:** items flagged/week + flag rate (flagged/fetched)
- **Target:** 5–15% flag rate; ≥ 1 sprint task injected/week
- **Query:** `SELECT meta->>'items_flagged', meta->>'items_fetched' FROM agent_events WHERE domain='competitive_intel' ORDER BY occurred_at DESC`
