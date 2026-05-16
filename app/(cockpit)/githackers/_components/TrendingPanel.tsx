'use client'

import type { TrendingRepo } from '../page'

interface TrendingPanelProps {
  repos: TrendingRepo[]
  error: string | null
  language: string
  languages: string[]
  onLanguageChange: (lang: string) => void
}

function LanguageBadge({ lang }: { lang: string | null }) {
  if (!lang) return null
  return (
    <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">
      {lang}
    </span>
  )
}

function StarCount({ label, count }: { label: string; count: number }) {
  return (
    <span className="text-xs text-[var(--color-text-secondary)]">
      {label}:{' '}
      <span className="font-medium text-[var(--color-text-primary)]">{count.toLocaleString()}</span>
    </span>
  )
}

export function TrendingPanel({
  repos,
  error,
  language,
  languages,
  onLanguageChange,
}: TrendingPanelProps) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)] p-4">
      {/* Panel header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">GitHub Trending</h2>
        <select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)] focus:ring-1 focus:ring-[var(--color-accent-gold)] focus:outline-none"
        >
          {languages.map((lang) => (
            <option key={lang} value={lang}>
              {lang === 'All' ? 'All languages' : lang}
            </option>
          ))}
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-6 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!error && repos.length === 0 && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-6 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">No trending repos found.</p>
        </div>
      )}

      {/* Repo list */}
      {!error && repos.length > 0 && (
        <ol className="space-y-3">
          {repos.map((repo, i) => {
            const repoUrl = repo.url ?? `https://github.com/${repo.author}/${repo.name}`
            const description = repo.description
              ? repo.description.length > 100
                ? repo.description.slice(0, 97) + '…'
                : repo.description
              : null

            return (
              <li
                key={`${repo.author}/${repo.name}`}
                className="flex gap-3 border-b border-[var(--color-border)] pb-3 last:border-0 last:pb-0"
              >
                <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-[var(--color-text-disabled)]">
                  {i + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={repoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-[var(--color-accent-gold)] hover:underline"
                    >
                      {repo.author}/{repo.name}
                    </a>
                    <LanguageBadge lang={repo.language} />
                  </div>
                  {description && (
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      {description}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-3">
                    <StarCount label="Today" count={repo.currentPeriodStars} />
                    <StarCount label="Total" count={repo.stars} />
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
