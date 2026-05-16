'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { TrendingPanel } from './TrendingPanel'
import { HNJobsPanel } from './HNJobsPanel'
import type { TrendingRepo, HNJobPost } from '../page'

interface GitHackersShellProps {
  language: string
  hnQuery: string
  initialRepos: TrendingRepo[]
  trendingError: string | null
  initialPosts: HNJobPost[]
  hnError: string | null
  hnThreadId: number | null
}

const LANGUAGES = ['All', 'TypeScript', 'Python', 'JavaScript', 'Rust', 'Go']
const DEFAULT_HN_QUERY = 'typescript OR nextjs OR supabase'

export function GitHackersShell({
  language: initialLanguage,
  hnQuery: initialHnQuery,
  initialRepos,
  trendingError: initialTrendingError,
  initialPosts,
  hnError: initialHnError,
  hnThreadId,
}: GitHackersShellProps) {
  const router = useRouter()

  const [language, setLanguage] = useState(initialLanguage)
  const [hnQuery, setHnQuery] = useState(initialHnQuery)
  const [hnQueryInput, setHnQueryInput] = useState(initialHnQuery)

  const [repos, setRepos] = useState<TrendingRepo[]>(initialRepos)
  const [trendingError, setTrendingError] = useState<string | null>(initialTrendingError)

  const [posts, setPosts] = useState<HNJobPost[]>(initialPosts)
  const [hnError, setHnError] = useState<string | null>(initialHnError)

  const [refreshing, setRefreshing] = useState(false)

  // Re-fetch trending when language changes (via URL to trigger server-side re-render)
  const handleLanguageChange = useCallback(
    (lang: string) => {
      setLanguage(lang)
      router.push(`/githackers?lang=${encodeURIComponent(lang)}&hnq=${encodeURIComponent(hnQuery)}`)
    },
    [router, hnQuery]
  )

  // Re-fetch HN jobs client-side when query term changes
  const fetchHNJobs = useCallback(
    async (query: string) => {
      setHnError(null)
      try {
        const res = await fetch(
          `/api/market/hn-jobs?q=${encodeURIComponent(query)}&threadId=${hnThreadId ?? ''}`
        )
        if (!res.ok) {
          setHnError('HN Jobs unavailable — try refreshing')
          return
        }
        const data = await res.json()
        if (data.error) {
          setHnError(data.error)
          setPosts([])
        } else {
          setPosts(data.posts ?? [])
        }
      } catch {
        setHnError('HN Jobs unavailable — try refreshing')
      }
    },
    [hnThreadId]
  )

  const handleHnSearch = useCallback(async () => {
    const q = hnQueryInput.trim() || DEFAULT_HN_QUERY
    setHnQuery(q)
    await fetchHNJobs(q)
  }, [hnQueryInput, fetchHNJobs])

  // Refresh both panels
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setTrendingError(null)
    setHnError(null)

    try {
      const [trendingRes, hnRes] = await Promise.all([
        fetch(`/api/market/hn-jobs?trending=1&lang=${encodeURIComponent(language)}`),
        fetch(`/api/market/hn-jobs?q=${encodeURIComponent(hnQuery)}&threadId=${hnThreadId ?? ''}`),
      ])

      if (trendingRes.ok) {
        const td = await trendingRes.json()
        if (td.error) {
          setTrendingError(td.error)
          setRepos([])
        } else {
          setRepos(td.repos ?? [])
        }
      } else {
        setTrendingError('GitHub Trending unavailable — try refreshing')
      }

      if (hnRes.ok) {
        const hn = await hnRes.json()
        if (hn.error) {
          setHnError(hn.error)
          setPosts([])
        } else {
          setPosts(hn.posts ?? [])
        }
      } else {
        setHnError('HN Jobs unavailable — try refreshing')
      }
    } catch {
      setTrendingError('GitHub Trending unavailable — try refreshing')
      setHnError('HN Jobs unavailable — try refreshing')
    } finally {
      setRefreshing(false)
    }
  }, [language, hnQuery, hnThreadId])

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">GitHackers</h1>
          <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
            GitHub trending repos and HN hiring posts — market signal for Colin&apos;s stack
          </p>
        </div>
        <Button
          onClick={handleRefresh}
          disabled={refreshing}
          variant="outline"
          size="sm"
          className="shrink-0"
        >
          {refreshing ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Refreshing…
            </span>
          ) : (
            'Refresh'
          )}
        </Button>
      </div>

      {/* Two-panel layout */}
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1">
          <TrendingPanel
            repos={repos}
            error={trendingError}
            language={language}
            languages={LANGUAGES}
            onLanguageChange={handleLanguageChange}
          />
        </div>
        <div className="flex-1">
          <HNJobsPanel
            posts={posts}
            error={hnError}
            hnQuery={hnQuery}
            hnQueryInput={hnQueryInput}
            onHnQueryInputChange={setHnQueryInput}
            onSearch={handleHnSearch}
          />
        </div>
      </div>
    </div>
  )
}
