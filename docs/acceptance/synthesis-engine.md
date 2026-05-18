# Synthesis Engine — Acceptance Doc

**Migration:** `0274_synthesis_debates.sql` (pre-claimed, branch `feat/synthesis-engine`)
**F-rules:** F17, F18, F20, F21, F22, F24

---

## What This Builds

Ingests high-friction Reddit and HN debates, scores for unresolvedness, synthesizes "what each side got right + the resolution" via Ollama pre-filter + Claude hard synthesis. Surfaces as an interactive tool at `/synthesis`. Test domain: climate first.

**Architecture:** n8n workflows → Supabase `synthesis_debates` table ← Next.js app (Next.js never calls Reddit/HN directly). Synthesis cron = `/api/synthesis/run` (pg_cron or Vercel cron depending on cron slot availability — see note below).

**Cron note:** Before adding to `vercel.json`, run `cat vercel.json | grep -c '"path"'` to count existing crons. If count ≥ 18, use pg_cron + net.http_post (identical pattern to migrations 0248 and 0250). If slots available, add a Vercel cron entry.

---

## Read These Files First

- `app/api/cron/sports-weights-tune/route.ts` — Claude call + cron-secret + agent_events pattern
- `lib/ollama/client.ts` — `generate()`, `hydrateOllamaConfig()`, `OllamaUnreachableError`
- `lib/auth/cron-secret.ts` — `requireCronSecret()` (F22)
- `app/(cockpit)/automations/page.tsx` + `_components/AutomationsClient.tsx` — UI pattern to follow
- `app/api/n8n-webhook/route.ts` — existing n8n integration (confirms N8N_WEBHOOK_TOKEN pattern)
- Grep for `createServiceClient` to find the service role client pattern

---

## Migration 0274 — `0274_synthesis_debates.sql`

```sql
CREATE TYPE synthesis_source AS ENUM ('reddit', 'hn');
CREATE TYPE synthesis_status_enum AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TABLE public.synthesis_debates (
  id                UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  source            synthesis_source      NOT NULL,
  external_id       TEXT                  NOT NULL,
  url               TEXT                  NOT NULL,
  title             TEXT                  NOT NULL,
  body_snippet      TEXT,
  controversy_score FLOAT                 NOT NULL DEFAULT 0,
  domain            TEXT                  NOT NULL DEFAULT 'climate',
  synthesis_status  synthesis_status_enum NOT NULL DEFAULT 'pending',
  synthesis_text    TEXT,
  side_a_summary    TEXT,
  side_b_summary    TEXT,
  resolution_text   TEXT,
  synthesized_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX synthesis_debates_source_external_id ON synthesis_debates (source, external_id);
CREATE INDEX synthesis_debates_status_score ON synthesis_debates (synthesis_status, controversy_score DESC) WHERE synthesis_status = 'pending';
CREATE INDEX synthesis_debates_domain ON synthesis_debates (domain);
CREATE INDEX synthesis_debates_synthesized_at ON synthesis_debates (synthesized_at DESC) WHERE synthesis_status = 'done';

ALTER TABLE synthesis_debates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_synthesis_debates" ON synthesis_debates
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- F24
GRANT INSERT, UPDATE, DELETE ON synthesis_debates TO service_role;
```

---

## n8n Workflow Spec

Two n8n workflows (Colin configures in n8n UI — this doc describes the node structure):

### Workflow A: Reddit Ingestion
1. **Schedule Trigger** — every 6h (`0 */6 * * *`)
2. **HTTP Request** — POST `https://www.reddit.com/api/v1/access_token` with client_id/secret (OAuth2 client_credentials) → gets `access_token`
3. **Split In Batches** — loop over `["climate","climateskeptics","environment"]`
4. **HTTP Request** — GET `https://oauth.reddit.com/r/{item}/hot.json?limit=50`, Auth: Bearer {token}, User-Agent: `lepios-synthesis/1.0`
5. **Code Node (JS)** — filter: `score > 50 && num_comments > 100`; compute `controversy_score = (num_comments / Math.max(score,1)) * (1 - (upvote_ratio ?? 0.5)) * 100`; discard if `< 5.0`
6. **Supabase Node** — upsert `synthesis_debates`, conflict columns: `source,external_id`, fields: source='reddit', external_id=`data.id`, url=`https://reddit.com{data.permalink}`, title, body_snippet (first 500 chars of selftext), controversy_score, domain='climate'

### Workflow B: HN Ingestion
1. **Schedule Trigger** — every 6h offset 3h (`0 3,9,15,21 * * *`)
2. **HTTP Request** — GET `https://hn.algolia.com/api/v1/search?query=climate+change&tags=story&numericFilters=points%3E50,num_comments%3E80&hitsPerPage=50`
3. **Code Node (JS)** — `controversy_score = (num_comments / Math.max(points,1)) * 100`; discard if `< 5.0`
4. **Supabase Node** — upsert, conflict: `source,external_id`, fields: source='hn', external_id=`objectID`, url=`item.url`, title, body_snippet=first 500 chars of story_text, controversy_score, domain='climate'

**Reddit credentials:** Colin must create a Reddit app at https://www.reddit.com/prefs/apps (type: "script", redirect: `http://localhost:8080`). Copy client_id (short string under app name) and client_secret. Store in n8n credentials — NOT in Vercel env vars. Next.js never calls Reddit directly.

---

## Synthesis Route — `app/api/synthesis/run/route.ts`

```typescript
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(request: Request) {
  // 1. requireCronSecret(request)  ← F22, FIRST
  // 2. hydrateOllamaConfig()
  // 3. Claim one pending row via FOR UPDATE SKIP LOCKED:
  //    UPDATE synthesis_debates SET synthesis_status='processing'
  //    WHERE id = (SELECT id FROM synthesis_debates WHERE synthesis_status='pending'
  //                ORDER BY controversy_score DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
  //    RETURNING *
  //    → if no row: return { ok: true, message: 'no pending debates' }
  // 4. Ollama pre-filter (phi4:14b via generate()):
  //    Prompt: "Is this debate genuinely unresolved with valid points on both sides?
  //    Title: {title}. Snippet: {body_snippet}. Answer: YES or NO + one sentence."
  //    If "NO" → mark failed, synthesis_text='Filtered: Ollama assessed as resolved'
  //    If OllamaUnreachableError → skip filter, proceed to Claude (circuit open = degrade gracefully)
  // 5. Claude hard synthesis (claude-sonnet-4-6):
  //    System: "Expert debate analyst. Find what is genuinely true in each position.
  //             Produce a resolution a smart, honest person on either side could accept."
  //    User: "Debate: {title}\nSource: {source} — {url}\nSnippet: {body_snippet}\n\n
  //           Return raw JSON (no markdown) with keys:
  //           side_a_summary, side_b_summary, resolution_text, synthesis_text"
  //    Parse JSON. On parse failure: retry once; if still failing, store raw text in synthesis_text.
  // 6. UPDATE synthesis_debates SET synthesis_status='done', side_a_summary, side_b_summary,
  //    resolution_text, synthesis_text, synthesized_at=now() WHERE id=?
  // 7. Log agent_events: domain='synthesis', action='synthesis.run', meta={debate_id, source, title, ollama_verdict, tokens_used}
  // 8. Return { ok: true, debate_id, title, source, ollama_verdict, synthesis_status, tokens_used }
}

export const GET = POST  // pg_cron may use GET
```

Use `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` — pattern from `app/api/ai-coach/chat/route.ts`.

---

## Page — `app/(cockpit)/synthesis/page.tsx`

Server component:
- `requireUser({ minRole: 'business' })` — check how auth works in existing cockpit pages
- Query `synthesis_debates WHERE synthesis_status='done' ORDER BY synthesized_at DESC LIMIT 50`
- Pass to `SynthesisClient`

Client component `_components/SynthesisClient.tsx`:

```
[Header] Synthesis Engine
[Sub] {N} resolved · {M} pending

[Domain filter tabs] All | Climate | (future)

[Card grid — 1 col mobile, 2 on md+]
  Each card (shadcn/ui Card):
    [Badge: Reddit/HN] [Badge: Climate] [score chip: {controversy_score.toFixed(1)}]
    [Title — link to {url}, target="_blank" rel="noopener noreferrer"]
    [Accordion]
      "What each side got right"
        Consensus: {side_a_summary}
        Skeptic: {side_b_summary}
      "The Resolution"
        {resolution_text}
    [Full synthesis — secondary Accordion]
      {synthesis_text}
    [Synthesized: {date}]
```

**Components:** `Card`, `CardHeader`, `CardContent`, `Badge`, `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent`, `Tabs`, `TabsList`, `TabsTrigger` — all from existing shadcn/ui.

**F20:** `grep -n "style=" app/(cockpit)/synthesis/` must return 0 matches.

**Nav registration:** Find the sidebar nav config (grep for existing cockpit hrefs) and add `{ href: '/synthesis', label: 'Synthesis' }` (or equivalent). The sidebar file is a shared seam — commit must include `[seam-approved]`.

---

## Acceptance Criteria

### Migration
- [ ] `0274_synthesis_debates.sql` exists with `synthesis_source` and `synthesis_status_enum` types
- [ ] `UNIQUE INDEX synthesis_debates_source_external_id` present
- [ ] `GRANT INSERT, UPDATE, DELETE ON synthesis_debates TO service_role;` present (F24)
- [ ] RLS enabled, SELECT policy for authenticated

### n8n workflows (Colin configures — builder documents)
- [ ] Reddit workflow spec documented in this acceptance doc (done above)
- [ ] HN workflow spec documented (done above)
- [ ] Reddit credentials setup steps documented (done above)
- [ ] Builder notes in handoff.json: "Colin must configure n8n workflows and Reddit app before debates populate"

### Synthesis route
- [ ] `app/api/synthesis/run/route.ts` exists
- [ ] `requireCronSecret(request)` is first call (F22)
- [ ] Returns 401 without CRON_SECRET
- [ ] Returns `{ ok: true, message: 'no pending debates' }` with empty table
- [ ] With a seeded pending row: processes it, returns `synthesis_status: 'done'`
- [ ] Ollama circuit-open (unreachable) gracefully skips filter, calls Claude, completes
- [ ] `agent_events` row logged on every run with `domain='synthesis'`

### Page
- [ ] `/synthesis` route renders without error
- [ ] `done` debates appear in card grid
- [ ] Accordion expands `side_a_summary`, `side_b_summary`, `resolution_text`
- [ ] Domain filter tabs work
- [ ] External links have `target="_blank" rel="noopener noreferrer"`
- [ ] `grep -n "style=" app/(cockpit)/synthesis/` → 0 matches (F20)
- [ ] Sidebar nav includes Synthesis link (same PR, `[seam-approved]` in commit)
- [ ] `next build` exits 0

---

## Out of Scope (v1)
- Comment-level ingestion
- Medicine domain (climate first — calibrate quality before health claims)
- User synthesis rating/feedback loop
- Multi-turn synthesis
- Full comment thread fetching
- Embedding / semantic search over debates
- Public URL / sharing

## Reddit API Setup (for Colin)
1. Go to https://www.reddit.com/prefs/apps
2. Click "create another app" → type: **script**
3. Name: `lepios-synthesis`, redirect URI: `http://localhost:8080`
4. Copy: **client_id** (short string below app name) + **client_secret** ("secret" field)
5. In n8n: create Generic Credential with token URL `https://www.reddit.com/api/v1/access_token`, grant type Client Credentials
6. Free tier: 60 req/min — well under usage (~3 req/6h cycle)

## F17
Debate synthesis = Colin's epistemic environment at a point in time. Feedback on synthesis quality (v2) = calibration data for behavioral ingestion. Domain attention signal feeds Twin corpus.

## F18
- **Metric:** synthesis completion rate (% of pending reaching 'done' within 24h)
- **Target:** ≥ 80% completion within 24h
- **Query:** `SELECT date(occurred_at), count(*) FILTER (WHERE status='success'), count(*) FROM agent_events WHERE domain='synthesis' GROUP BY 1 ORDER BY 1 DESC`
