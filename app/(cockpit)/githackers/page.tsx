// F18: bench=github.com/trending (same-day visual parity); surface=agent_events WHERE action='githackers_view' (view frequency, language_filter distribution, hn_query_term usage, duration_ms)
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GitHackersShell } from './_components/GitHackersShell'

export const dynamic = 'force-dynamic'

// NOTE: gitterapp.com endpoint may be transiently unavailable.
// Fallback: https://github-trending-api.de/repositories (same schema, also reported down 2026-05-16).
// If both are down at runtime, TrendingPanel shows graceful error card per acceptance criterion 6.
const TRENDING_BASE = 'https://api.gitterapp.com/repositories'

export type TrendingRepo = {
  author: string
  name: string
  description: string | null
  stars: number
  currentPeriodStars: number
  language: string | null
  url: string
}

export type HNJobPost = {
  objectID: string
  author: string
  comment_text: string
  created_at: string
  story_id: number
}

async function fetchTrending(
  language: string
): Promise<{ repos: TrendingRepo[]; error: string | null }> {
  const lang = language === 'All' ? '' : language
  const url = lang
    ? `${TRENDING_BASE}?language=${encodeURIComponent(lang)}&since=daily`
    : `${TRENDING_BASE}?since=daily`
  try {
    const start = Date.now()
    const res = await fetch(url, {
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(5000),
    })
    const _duration = Date.now() - start
    if (!res.ok) return { repos: [], error: `GitHub Trending unavailable (${res.status})` }
    const data: TrendingRepo[] = await res.json()
    return { repos: data.slice(0, 10), error: null }
  } catch {
    return { repos: [], error: 'GitHub Trending unavailable — try refreshing' }
  }
}

async function fetchHNJobs(
  query: string
): Promise<{ posts: HNJobPost[]; error: string | null; threadId: number | null }> {
  try {
    // Step 1: find the latest "Who is hiring?" monthly thread
    const threadRes = await fetch(
      'https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=10',
      { next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) }
    )
    if (!threadRes.ok)
      return { posts: [], error: 'HN Jobs unavailable — try refreshing', threadId: null }
    const threadData = await threadRes.json()

    // Filter for monthly "Ask HN: Who is hiring?" threads by whoishiring author only
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monthlyHits = (threadData.hits as any[]).filter(
      (h: { author: string; title?: string }) =>
        h.author === 'whoishiring' &&
        (h.title?.includes('Who is hiring?') || h.title?.includes('who is hiring'))
    )
    if (!monthlyHits.length)
      return { posts: [], error: 'Could not find current HN hiring thread', threadId: null }

    // Sort by date descending to get the most recent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monthlyHits.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1))
    const threadId = monthlyHits[0].objectID as number

    // Step 2: fetch comments from that thread matching the query
    const commentsRes = await fetch(
      `https://hn.algolia.com/api/v1/search?tags=comment,story_${threadId}&query=${encodeURIComponent(query)}&hitsPerPage=30`,
      { next: { revalidate: 0 }, signal: AbortSignal.timeout(5000) }
    )
    if (!commentsRes.ok)
      return { posts: [], error: 'HN Jobs unavailable — try refreshing', threadId }
    const commentsData = await commentsRes.json()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posts: HNJobPost[] = (commentsData.hits as any[]).slice(0, 20).map((h: any) => ({
      objectID: String(h.objectID),
      author: String(h.author ?? ''),
      comment_text: String(h.comment_text ?? ''),
      created_at: String(h.created_at ?? ''),
      story_id: Number(threadId),
    }))

    return { posts, error: null, threadId: Number(threadId) }
  } catch {
    return { posts: [], error: 'HN Jobs unavailable — try refreshing', threadId: null }
  }
}

export default async function GitHackersPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; hnq?: string }>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const language = params.lang ?? 'All'
  const hnQuery = params.hnq ?? 'typescript OR nextjs OR supabase'

  const [trendingResult, hnResult] = await Promise.all([
    fetchTrending(language),
    fetchHNJobs(hnQuery),
  ])

  // Log page view to agent_events (F18 — non-blocking, fire-and-forget)
  void supabase.from('agent_events').insert({
    domain: 'market_intel',
    action: 'githackers_view',
    actor: 'user',
    status: 'success',
    meta: {
      language_filter: language,
      hn_query_term: hnQuery,
    },
  })

  return (
    <GitHackersShell
      language={language}
      hnQuery={hnQuery}
      initialRepos={trendingResult.repos}
      trendingError={trendingResult.error}
      initialPosts={hnResult.posts}
      hnError={hnResult.error}
      hnThreadId={hnResult.threadId}
    />
  )
}
