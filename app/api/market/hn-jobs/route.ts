import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// NOTE: gitterapp.com and its fallback (github-trending-api.de) were both unreachable
// during pre-flight on 2026-05-16. Both may be transiently down. The code uses gitterapp
// as specified in the acceptance doc; graceful error is returned if unreachable.
const TRENDING_BASE = 'https://api.gitterapp.com/repositories'

type TrendingRepo = {
  author: string
  name: string
  description: string | null
  stars: number
  currentPeriodStars: number
  language: string | null
  url: string
}

type HNJobPost = {
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
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const durationMs = Date.now() - start
    if (!res.ok) return { repos: [], error: `GitHub Trending unavailable (${res.status})` }
    const data: TrendingRepo[] = await res.json()
    // Log latency to agent_events (non-blocking, fire-and-forget)
    try {
      const supabase = await createClient()
      void supabase.from('agent_events').insert({
        domain: 'market_intel',
        action: 'githackers_trending_fetch',
        actor: 'system',
        status: 'success',
        meta: { language_filter: language, duration_ms: durationMs },
      })
    } catch {
      // non-blocking
    }
    return { repos: data.slice(0, 10), error: null }
  } catch {
    return { repos: [], error: 'GitHub Trending unavailable — try refreshing' }
  }
}

async function fetchHNJobs(
  query: string,
  threadId: string | null
): Promise<{ posts: HNJobPost[]; error: string | null; threadId: number | null }> {
  try {
    let resolvedThreadId = threadId ? Number(threadId) : null

    if (!resolvedThreadId) {
      // Discover current monthly thread
      const threadRes = await fetch(
        'https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=10',
        { signal: AbortSignal.timeout(5000) }
      )
      if (!threadRes.ok)
        return { posts: [], error: 'HN Jobs unavailable — try refreshing', threadId: null }
      const threadData = await threadRes.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const monthlyHits = (threadData.hits as any[]).filter(
        (h: { author: string; title?: string }) =>
          h.author === 'whoishiring' &&
          (h.title?.includes('Who is hiring?') || h.title?.includes('who is hiring'))
      )
      if (!monthlyHits.length)
        return { posts: [], error: 'Could not find current HN hiring thread', threadId: null }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      monthlyHits.sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1))
      resolvedThreadId = Number(monthlyHits[0].objectID)
    }

    const start = Date.now()
    const commentsRes = await fetch(
      `https://hn.algolia.com/api/v1/search?tags=comment,story_${resolvedThreadId}&query=${encodeURIComponent(query)}&hitsPerPage=30`,
      { signal: AbortSignal.timeout(5000) }
    )
    const durationMs = Date.now() - start

    if (!commentsRes.ok)
      return {
        posts: [],
        error: 'HN Jobs unavailable — try refreshing',
        threadId: resolvedThreadId,
      }
    const commentsData = await commentsRes.json()

    // Log latency to agent_events (non-blocking, fire-and-forget)
    try {
      const supabase = await createClient()
      void supabase.from('agent_events').insert({
        domain: 'market_intel',
        action: 'githackers_hn_fetch',
        actor: 'system',
        status: 'success',
        meta: { hn_query_term: query, duration_ms: durationMs },
      })
    } catch {
      // non-blocking
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posts: HNJobPost[] = (commentsData.hits as any[]).slice(0, 20).map((h: any) => ({
      objectID: String(h.objectID),
      author: String(h.author ?? ''),
      comment_text: String(h.comment_text ?? ''),
      created_at: String(h.created_at ?? ''),
      story_id: Number(resolvedThreadId),
    }))

    return { posts, error: null, threadId: resolvedThreadId }
  } catch {
    return { posts: [], error: 'HN Jobs unavailable — try refreshing', threadId: null }
  }
}

export async function GET(request: NextRequest) {
  // Auth check — this API serves the cockpit (authenticated users only)
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const isTrending = searchParams.get('trending') === '1'
  const lang = searchParams.get('lang') ?? 'All'
  const query = searchParams.get('q') ?? 'typescript OR nextjs OR supabase'
  const threadId = searchParams.get('threadId') || null

  if (isTrending) {
    const result = await fetchTrending(lang)
    return NextResponse.json(result)
  }

  const result = await fetchHNJobs(query, threadId)
  return NextResponse.json(result)
}
