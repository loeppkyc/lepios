// F18: bench=latency_ms<2000 for non-stale calls; surface=agent_events WHERE action='githackers_api_fetch' AND meta->>'tab'='hn'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { HNPost, HNHiringResponse } from '@/app/(cockpit)/git-hackers/_components/types'

export const dynamic = 'force-dynamic'
export const revalidate = 3600 // 1 hour

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export async function GET(): Promise<NextResponse> {
  const start = Date.now()
  const supabase = await createClient()

  // Auth guard — cockpit endpoints require an authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let posts: HNPost[] = []
  let threadTitle: string | null = null
  let threadDate: string | null = null
  let error: string | null = null

  try {
    // Step 1 — find the latest "Ask HN: Who is hiring?" monthly thread
    const threadRes = await fetch(
      'https://hn.algolia.com/api/v1/search?query=Ask+HN%3A+Who+is+hiring&tags=story&hitsPerPage=1',
      { signal: AbortSignal.timeout(8000) }
    )

    if (!threadRes.ok) {
      error = 'HN API unavailable — try refreshing'
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const threadData: { hits: any[] } = await threadRes.json()
      const hit = threadData.hits?.[0]

      if (!hit) {
        error = 'Could not find current HN hiring thread'
      } else {
        const threadId = String(hit.objectID)
        threadTitle = hit.title ? String(hit.title) : null
        threadDate = hit.created_at ? String(hit.created_at) : null

        // Step 2 — fetch top comments from that thread
        const commentsRes = await fetch(
          `https://hn.algolia.com/api/v1/search?tags=comment,story_${threadId}&hitsPerPage=50&page=0`,
          { signal: AbortSignal.timeout(8000) }
        )

        if (!commentsRes.ok) {
          error = 'HN API unavailable — try refreshing'
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const commentsData: { hits: any[] } = await commentsRes.json()
          posts = (commentsData.hits ?? [])
            .slice(0, 50)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((h: any): HNPost => ({
              objectID: String(h.objectID ?? ''),
              author: String(h.author ?? ''),
              comment_text: stripHtml(String(h.comment_text ?? '')),
              created_at: String(h.created_at ?? ''),
              story_id: threadId,
            }))
        }
      }
    }
  } catch {
    error = 'HN API unavailable — try refreshing'
  }

  const latencyMs = Date.now() - start

  // F18: log to agent_events (non-blocking)
  void supabase.from('agent_events').insert({
    domain: 'cockpit',
    action: 'githackers_api_fetch',
    actor: 'server',
    status: error ? 'error' : 'success',
    meta: {
      tab: 'hn',
      result_count: posts.length,
      latency_ms: latencyMs,
      cached: false,
      stale: false,
    },
  })

  const body: HNHiringResponse = {
    posts,
    thread_title: threadTitle,
    thread_date: threadDate,
    error,
  }
  return NextResponse.json(body)
}
