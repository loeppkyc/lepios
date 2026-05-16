'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { HNJobPost } from '../page'

interface HNJobsPanelProps {
  posts: HNJobPost[]
  error: string | null
  hnQuery: string
  hnQueryInput: string
  onHnQueryInputChange: (val: string) => void
  onSearch: () => void
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString)
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

function stripHtml(html: string): string {
  // Remove HTML tags for plain-text excerpt
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function HNJobsPanel({
  posts,
  error,
  hnQuery,
  hnQueryInput,
  onHnQueryInputChange,
  onSearch,
}: HNJobsPanelProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSearch()
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)] p-4">
      {/* Panel header */}
      <div className="mb-4">
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">HN Jobs</h2>
        <div className="flex gap-2">
          <Input
            value={hnQueryInput}
            onChange={(e) => onHnQueryInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. typescript OR nextjs OR supabase"
            className="flex-1 text-xs"
          />
          <Button variant="outline" size="sm" onClick={onSearch}>
            Search
          </Button>
        </div>
        {hnQuery !== hnQueryInput && (
          <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
            Showing results for: <em>{hnQuery}</em>
          </p>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-6 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!error && posts.length === 0 && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-6 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">
            No job posts found for &ldquo;{hnQuery}&rdquo;. Try a different keyword.
          </p>
        </div>
      )}

      {/* Post list */}
      {!error && posts.length > 0 && (
        <ol className="space-y-3">
          {posts.map((post) => {
            const plain = stripHtml(post.comment_text)
            const excerpt = plain.length > 200 ? plain.slice(0, 197) + '…' : plain
            const hnUrl = `https://news.ycombinator.com/item?id=${post.objectID}`

            return (
              <li
                key={post.objectID}
                className="border-b border-[var(--color-border)] pb-3 last:border-0 last:pb-0"
              >
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
      )}
    </div>
  )
}
