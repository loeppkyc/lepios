'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { HNPost, HNHiringResponse } from './types'

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

export function HNHiringTab() {
  const [posts, setPosts] = useState<HNPost[]>([])
  const [threadTitle, setThreadTitle] = useState<string | null>(null)
  const [threadDate, setThreadDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/git-hackers/hn-hiring')
      if (!res.ok) {
        setError('HN API unavailable — try refreshing')
        setPosts([])
        setLoading(false)
        return
      }
      const data: HNHiringResponse = await res.json()
      if (data.error) {
        setError(data.error)
        setPosts([])
      } else {
        setPosts(data.posts)
        setThreadTitle(data.thread_title)
        setThreadDate(data.thread_date)
      }
    } catch {
      setError('HN API unavailable — try refreshing')
      setPosts([])
    }
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, []) // load is defined inside component — stable ref, empty deps intentional

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          {threadTitle && (
            <p className="text-xs font-medium text-[var(--color-text-secondary)]">
              {threadTitle}
              {threadDate && (
                <span className="ml-1 text-[var(--color-text-muted)]">
                  ({formatDate(threadDate)})
                </span>
              )}
            </p>
          )}
          <p className="text-xs text-[var(--color-text-muted)]">
            Latest comments from the monthly HN &ldquo;Who is Hiring&rdquo; thread
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">Fetching HN hiring posts…</p>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && posts.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">No hiring posts found.</p>
        </div>
      )}

      {/* Post list */}
      {!loading && !error && posts.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <ol className="divide-y divide-[var(--color-border-subtle)]">
            {posts.map((post) => {
              const excerpt =
                post.comment_text.length > 200
                  ? post.comment_text.slice(0, 197) + '…'
                  : post.comment_text
              const hnUrl = `https://news.ycombinator.com/item?id=${post.objectID}`

              return (
                <li key={post.objectID} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--color-text-primary)]">
                      {post.author}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--color-text-disabled)]">
                      {formatDate(post.created_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{excerpt}</p>
                  <a
                    href={hnUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-[var(--color-accent-gold)] hover:underline"
                  >
                    View on HN
                  </a>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
