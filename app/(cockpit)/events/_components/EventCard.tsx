'use client'

import type { FreeEvent } from '@/app/api/events/route'

interface EventCardProps {
  event: FreeEvent
}

function formatDateRange(startDate: string, endDate: string | null): string {
  try {
    const start = new Date(startDate)
    const opts: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Edmonton',
    }
    const startStr = start.toLocaleString('en-CA', opts)
    if (!endDate) return startStr

    const end = new Date(endDate)
    const sameDay =
      start.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' }) ===
      end.toLocaleDateString('en-CA', { timeZone: 'America/Edmonton' })

    if (sameDay) {
      const endTime = end.toLocaleString('en-CA', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Edmonton',
      })
      return `${startStr} – ${endTime}`
    }
    return `${startStr} – ${end.toLocaleString('en-CA', opts)}`
  } catch {
    return startDate
  }
}

function SourceBadge({ source }: { source: FreeEvent['source'] }) {
  const label = source === 'eventbrite' ? 'Eventbrite' : 'Edmonton'
  return (
    <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs text-[var(--color-text-disabled)]">
      {label}
    </span>
  )
}

function FreeBadge() {
  return (
    <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs font-medium text-[var(--color-accent-gold)]">
      Free
    </span>
  )
}

export function EventCard({ event }: EventCardProps) {
  const dateStr = formatDateRange(event.startDate, event.endDate)
  const description = event.description
    ? event.description.length > 160
      ? event.description.slice(0, 157) + '…'
      : event.description
    : null

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:bg-[var(--color-surface-2)]">
      {/* Title + badges */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {event.url ? (
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent-gold)] hover:underline"
            >
              {event.title}
            </a>
          ) : (
            <span className="font-medium text-[var(--color-text-primary)]">{event.title}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <FreeBadge />
          <SourceBadge source={event.source} />
        </div>
      </div>

      {/* Date */}
      <p className="text-xs text-[var(--color-text-muted)]">{dateStr}</p>

      {/* Location */}
      {event.location && (
        <p className="text-xs text-[var(--color-text-secondary)]">{event.location}</p>
      )}

      {/* Description */}
      {description && (
        <p className="text-xs text-[var(--color-text-disabled)]">{description}</p>
      )}
    </div>
  )
}
