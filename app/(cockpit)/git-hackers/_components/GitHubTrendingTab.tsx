'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GitHubRepo, GitHubTrendingResponse } from './types'

function LanguageBadge({ lang }: { lang: string | null }) {
  if (!lang) return null
  return (
    <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">
      {lang}
    </span>
  )
}

function TopicBadge({ topic }: { topic: string }) {
  return (
    <span className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-xs text-[var(--color-text-disabled)]">
      {topic}
    </span>
  )
}

export function GitHubTrendingTab() {
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    setStale(false)
    try {
      const res = await fetch('/api/git-hackers/github-trending')
      if (!res.ok) {
        setError('GitHub API unavailable — try refreshing')
        setRepos([])
        setLoading(false)
        return
      }
      const data: GitHubTrendingResponse = await res.json()
      if (data.error) {
        setError(data.error)
        setRepos([])
      } else {
        setRepos(data.repos)
      }
      setStale(data.stale)
    } catch {
      setError('GitHub API unavailable — try refreshing')
      setRepos([])
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
          <p className="text-xs text-[var(--color-text-muted)]">
            Top starred repos pushed in the last 7 days via GitHub Search API
          </p>
          {stale && (
            <p className="text-xs text-[var(--color-text-disabled)]">
              Rate limit reached — showing last available data
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">Fetching trending repos…</p>
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
      {!loading && !error && repos.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">No trending repos found.</p>
        </div>
      )}

      {/* Repo list */}
      {!loading && !error && repos.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          <ol className="divide-y divide-[var(--color-border-subtle)]">
            {repos.map((repo, i) => {
              const desc = repo.description
                ? repo.description.length > 120
                  ? repo.description.slice(0, 117) + '…'
                  : repo.description
                : null

              return (
                <li key={repo.full_name} className="flex gap-3 px-4 py-3">
                  <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-[var(--color-text-disabled)]">
                    {i + 1}.
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={repo.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[var(--color-accent-gold)] hover:underline"
                      >
                        {repo.full_name}
                      </a>
                      <LanguageBadge lang={repo.language} />
                    </div>
                    {desc && (
                      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{desc}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {repo.stargazers_count.toLocaleString()} stars
                      </span>
                      {repo.topics.slice(0, 4).map((t) => (
                        <TopicBadge key={t} topic={t} />
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
