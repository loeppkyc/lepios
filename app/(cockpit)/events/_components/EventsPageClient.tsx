'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EventCard } from './EventCard'
import type { EventsResponse, FreeEvent } from '@/app/api/events/route'

type SortKey = 'date' | 'title'

export function EventsPageClient() {
  const [events, setEvents] = useState<FreeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{
    open_data_count: number
    eventbrite_count: number
    eventbrite_enabled: boolean
    fetched_at: string
  } | null>(null)
  const [sort, setSort] = useState<SortKey>('date')

  // F17 exemption: log events_viewed on page load
  useEffect(() => {
    fetch('/api/events/viewed', { method: 'POST' }).catch(() => {
      // Non-blocking — failure is not surfaced to user
    })
  }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/events')
      if (!res.ok) {
        setError('Could not load events — try refreshing')
        setLoading(false)
        return
      }
      const data: EventsResponse = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setEvents(data.events)
        setMeta({
          open_data_count: data.open_data_count,
          eventbrite_count: data.eventbrite_count,
          eventbrite_enabled: data.eventbrite_enabled,
          fetched_at: data.fetched_at,
        })
      }
    } catch {
      setError('Could not load events — try refreshing')
    }
    setLoading(false)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, []) // load defined inside component — empty deps intentional

  const sorted = [...events].sort((a, b) => {
    if (sort === 'date') {
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    }
    return a.title.localeCompare(b.title)
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
          Free Edmonton Events
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Upcoming free events in the next 14 days — Edmonton Open Data
          {meta?.eventbrite_enabled ? ' + Eventbrite' : ''}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Sort:</span>
          <button
            onClick={() => setSort('date')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              sort === 'date'
                ? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            Date
          </button>
          <button
            onClick={() => setSort('title')}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              sort === 'title'
                ? 'bg-[var(--color-surface-2)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            Name
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {/* Source counts */}
      {meta && !loading && (
        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
          <span>Edmonton Open Data: {meta.open_data_count} events</span>
          {meta.eventbrite_enabled && (
            <span>Eventbrite: {meta.eventbrite_count} events</span>
          )}
          <span className="text-[var(--color-text-disabled)]">
            Cached — refreshes every 6h
          </span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-10 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">Fetching upcoming free events…</p>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-10 text-center">
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && sorted.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-10 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">No upcoming free events</p>
          <p className="mt-1 text-xs text-[var(--color-text-disabled)]">
            Check back later — data refreshes every 6 hours
          </p>
        </div>
      )}

      {/* Event list */}
      {!loading && !error && sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
          <p className="pt-2 text-center text-xs text-[var(--color-text-disabled)]">
            {sorted.length} free event{sorted.length !== 1 ? 's' : ''} in the next 14 days
          </p>
        </div>
      )}
    </div>
  )
}
