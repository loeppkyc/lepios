// F18 — in-process metrics counters for each OSS source.
// Counters live for the lifetime of the process (cron run / bench script).
// For persistent F18 metrics, callers should flush to agent_events after each run.

import type { OssEcosystem, SourceMetrics } from '@/lib/oss-radar/types'

const store = new Map<OssEcosystem, SourceMetrics>()

function get(source: OssEcosystem): SourceMetrics {
  if (!store.has(source)) {
    store.set(source, {
      source,
      calls_made: 0,
      rate_limit_hits: 0,
      errors: 0,
      total_duration_ms: 0,
    })
  }
  return store.get(source)!
}

export function recordCall(source: OssEcosystem, durationMs: number): void {
  const m = get(source)
  m.calls_made++
  m.total_duration_ms += durationMs
}

export function recordRateLimit(source: OssEcosystem): void {
  get(source).rate_limit_hits++
}

export function recordError(source: OssEcosystem): void {
  get(source).errors++
}

export function getMetrics(source: OssEcosystem): Readonly<SourceMetrics> {
  return { ...get(source) }
}

export function resetMetrics(source: OssEcosystem): void {
  store.delete(source)
}

export function allMetrics(): Readonly<SourceMetrics>[] {
  return Array.from(store.values()).map((m) => ({ ...m }))
}
