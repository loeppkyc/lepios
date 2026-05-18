'use client'

// F20: ZERO style={} attributes. All styling via Tailwind + CSS vars.

import { useState } from 'react'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'

interface DebateRow {
  id: string
  source: 'reddit' | 'hn'
  url: string
  title: string
  controversy_score: number
  domain: string
  side_a_summary: string | null
  side_b_summary: string | null
  resolution_text: string | null
  synthesis_text: string | null
  synthesized_at: string | null
}

interface SynthesisClientProps {
  initialDebates: DebateRow[]
}

const SOURCE_COLORS: Record<string, string> = {
  reddit: 'bg-orange-500/20 text-orange-300',
  hn: 'bg-yellow-500/20 text-yellow-300',
}

const DOMAIN_COLORS: Record<string, string> = {
  climate: 'bg-teal-500/20 text-teal-300',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function DebateCard({ debate }: { debate: DebateRow }) {
  return (
    <Card className="flex flex-col gap-0 py-0">
      <CardHeader className="pb-2 pt-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Badge
            className={
              SOURCE_COLORS[debate.source] ??
              'bg-[var(--color-border)] text-[var(--color-text-muted)]'
            }
          >
            {debate.source === 'hn' ? 'HN' : 'Reddit'}
          </Badge>
          <Badge
            className={
              DOMAIN_COLORS[debate.domain] ??
              'bg-[var(--color-border)] text-[var(--color-text-muted)]'
            }
          >
            {debate.domain}
          </Badge>
          <span className="ml-auto rounded bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-mono text-[var(--color-text-disabled)]">
            score {debate.controversy_score.toFixed(1)}
          </span>
        </div>
        <a
          href={debate.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium leading-snug text-[var(--color-text-primary)] underline-offset-2 hover:underline"
        >
          {debate.title}
        </a>
      </CardHeader>

      <CardContent className="pb-4">
        <Accordion type="multiple">
          {(debate.side_a_summary || debate.side_b_summary || debate.resolution_text) && (
            <AccordionItem value="sides">
              <AccordionTrigger>What each side got right</AccordionTrigger>
              <AccordionContent>
                {debate.side_a_summary && (
                  <p className="mb-1.5">
                    <span className="font-medium text-[var(--color-text-primary)]">Consensus: </span>
                    {debate.side_a_summary}
                  </p>
                )}
                {debate.side_b_summary && (
                  <p>
                    <span className="font-medium text-[var(--color-text-primary)]">Skeptic: </span>
                    {debate.side_b_summary}
                  </p>
                )}
              </AccordionContent>
            </AccordionItem>
          )}

          {debate.resolution_text && (
            <AccordionItem value="resolution">
              <AccordionTrigger>The Resolution</AccordionTrigger>
              <AccordionContent>{debate.resolution_text}</AccordionContent>
            </AccordionItem>
          )}

          {debate.synthesis_text && (
            <AccordionItem value="full">
              <AccordionTrigger>Full synthesis</AccordionTrigger>
              <AccordionContent>{debate.synthesis_text}</AccordionContent>
            </AccordionItem>
          )}
        </Accordion>

        <p className="mt-3 text-[10px] text-[var(--color-text-disabled)]">
          Synthesized {fmtDate(debate.synthesized_at)}
        </p>
      </CardContent>
    </Card>
  )
}

const DOMAINS = ['all', 'climate'] as const
type DomainFilter = (typeof DOMAINS)[number]

export function SynthesisClient({ initialDebates }: SynthesisClientProps) {
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all')

  const filtered =
    domainFilter === 'all'
      ? initialDebates
      : initialDebates.filter((d) => d.domain === domainFilter)

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        defaultValue="all"
        onValueChange={(v) => setDomainFilter(v as DomainFilter)}
        className="w-full"
      >
        <TabsList>
          {DOMAINS.map((d) => (
            <TabsTrigger key={d} value={d}>
              {d === 'all' ? 'All' : d.charAt(0).toUpperCase() + d.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <p className="mt-12 text-center text-[length:var(--text-small)] text-[var(--color-text-muted)]">
          No synthesized debates yet. Configure n8n workflows to start ingesting Reddit and HN
          debates, then wait for the synthesis cron to run.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((debate) => (
            <DebateCard key={debate.id} debate={debate} />
          ))}
        </div>
      )}
    </div>
  )
}
