import type { AmazonPaceResult } from '@/lib/amazon/benchmark'

/**
 * F18 surfacing widget — last-30d gross revenue vs. target pace.
 * Bench source: lib/amazon/benchmark.ts (BENCHMARK_30D_REVENUE_CAD).
 *
 * Uses Tailwind utility classes (F20-compliant). The rest of the amazon
 * page is pre-existing inline-style debt to be retrofitted later.
 */
export function AmazonPaceBadge({
  benchmark,
  revenue30d,
}: {
  benchmark: AmazonPaceResult
  revenue30d: number
}) {
  const { targetCad, expectedCad, pacePct, status } = benchmark
  const dollarDelta = revenue30d - expectedCad
  const tone =
    status === 'ahead'
      ? { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'AHEAD' }
      : status === 'on_pace'
        ? { dot: 'bg-amber-400', text: 'text-amber-300', label: 'ON PACE' }
        : { dot: 'bg-red-500', text: 'text-red-400', label: 'BEHIND' }

  return (
    <div className="mb-6 flex items-center gap-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3 font-mono text-[var(--text-small)]">
      <span className={`inline-block h-2 w-2 rounded-full ${tone.dot}`} aria-hidden />
      <span className={`text-xs font-bold tracking-wider uppercase ${tone.text}`}>
        {tone.label} · {pacePct}%
      </span>
      <span className="text-[var(--color-text-muted)]">
        30d ${revenue30d.toLocaleString('en-CA', { maximumFractionDigits: 0 })} · Expected $
        {expectedCad.toLocaleString('en-CA', { maximumFractionDigits: 0 })}
      </span>
      <span className={`ml-auto text-xs ${dollarDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {dollarDelta >= 0 ? '+' : ''}$
        {dollarDelta.toLocaleString('en-CA', { maximumFractionDigits: 0 })}
      </span>
      <span className="text-[var(--color-text-disabled)]">
        target ${targetCad.toLocaleString('en-CA')}/30d
      </span>
    </div>
  )
}
