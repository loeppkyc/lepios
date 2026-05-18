'use client'

/**
 * CompetitiveIntelWidget.tsx
 *
 * Displays the latest flagged AI research papers from the competitive_intel table.
 * Scores >= 0.75 shown in green, 0.50–0.74 in warning amber, < 0.50 in muted.
 *
 * F20: zero style= attributes — all styling via Tailwind utility classes.
 */

import React, { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ExternalLink } from 'lucide-react'

export interface CompetitiveIntelItem {
  id: string
  source: 'arxiv' | 'paperswithcode' | 'openreview'
  url: string
  title: string
  relevance_score: number
  scraped_at: string
}

interface CompetitiveIntelWidgetProps {
  initialIntelItems: CompetitiveIntelItem[]
}

const SOURCE_LABELS: Record<string, string> = {
  arxiv: 'arxiv',
  paperswithcode: 'pwc',
  openreview: 'or',
}

function scoreColorClass(score: number): string {
  if (score >= 0.75) return 'text-green-400'
  if (score >= 0.5) return 'text-yellow-400'
  return 'text-muted-foreground'
}

function sourceBadgeVariant(source: string): 'default' | 'secondary' | 'outline' {
  if (source === 'arxiv') return 'default'
  if (source === 'paperswithcode') return 'secondary'
  return 'outline'
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-CA', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

const DISPLAY_LIMIT = 10

export function CompetitiveIntelWidget({ initialIntelItems }: CompetitiveIntelWidgetProps) {
  const items = initialIntelItems
  const flaggedCount = items.length
  const lastScanDate =
    items.length > 0 ? formatDate(items[0].scraped_at) : 'never'

  const [showAll, setShowAll] = useState(false)
  const displayed = showAll ? items : items.slice(0, DISPLAY_LIMIT)

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="label-caps">Competitive Intel</h2>
          <span className="text-muted-foreground font-mono text-[0.65rem]">
            last scan: {lastScanDate}
          </span>
        </div>
        <p className="text-muted-foreground text-sm">No flagged items yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="label-caps">Competitive Intel</h2>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground font-mono text-[0.65rem]">
            last scan: {lastScanDate}
          </span>
          <span className="text-muted-foreground font-mono text-[0.65rem]">
            {flaggedCount} flagged
          </span>
        </div>
      </div>

      {/* Paper rows */}
      <div className="flex flex-col divide-y divide-border">
        {displayed.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 py-2"
          >
            {/* Source badge */}
            <Badge
              variant={sourceBadgeVariant(item.source)}
              className="shrink-0 font-mono text-[0.6rem]"
            >
              {SOURCE_LABELS[item.source] ?? item.source}
            </Badge>

            {/* Score */}
            <span
              className={`shrink-0 font-mono text-xs tabular-nums ${scoreColorClass(item.relevance_score)}`}
            >
              {item.relevance_score.toFixed(2)}
            </span>

            {/* Title */}
            <span className="min-w-0 flex-1 truncate text-sm">
              {item.title.slice(0, 60)}
              {item.title.length > 60 ? '…' : ''}
            </span>

            {/* External link */}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground shrink-0 transition-colors"
              aria-label={`Open ${item.title}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ))}
      </div>

      {/* Show all toggle */}
      {items.length > DISPLAY_LIMIT && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-muted-foreground hover:text-foreground self-end text-xs transition-colors"
        >
          {showAll ? 'show fewer' : `show all ${items.length}`}
        </button>
      )}
    </div>
  )
}

