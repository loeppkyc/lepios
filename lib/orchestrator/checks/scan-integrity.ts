import { createServiceClient } from '@/lib/supabase/service'
import { getYesterdayRangeMT } from '../config'
import type { CheckResult, Flag } from '../types'

export async function checkScanIntegrity(): Promise<CheckResult> {
  const start = Date.now()
  const flags: Flag[] = []
  const counts: Record<string, number> = {
    total: 0,
    missing_asin: 0,
    null_profit: 0,
    negative_cost: 0,
    duplicate_isbn: 0,
  }

  try {
    const supabase = createServiceClient()
    const { start: rangeStart, end: rangeEnd } = getYesterdayRangeMT()

    const { data, error } = await supabase
      .from('scan_results')
      .select('id, asin, isbn, profit_cad, cost_paid_cad, recorded_at')
      .gte('recorded_at', rangeStart)
      .lt('recorded_at', rangeEnd)

    if (error || !data) {
      flags.push({
        severity: 'critical',
        message: `scan_results query failed: ${error?.message ?? 'no data'}`,
        entity_type: 'table',
      })
      return {
        name: 'scan_integrity',
        status: 'fail',
        flags,
        counts,
        duration_ms: Date.now() - start,
      }
    }

    counts.total = data.length

    for (const row of data) {
      if (!row.asin) {
        counts.missing_asin++
        flags.push({
          severity: 'warn',
          message: 'scan row missing asin',
          entity_id: row.id,
          entity_type: 'scan_result',
        })
      }
      if (row.profit_cad === null || row.profit_cad === undefined) {
        counts.null_profit++
        flags.push({
          severity: 'warn',
          message: 'scan row has null profit_cad',
          entity_id: row.id,
          entity_type: 'scan_result',
        })
      }
      if (row.cost_paid_cad !== null && Number(row.cost_paid_cad) < 0) {
        counts.negative_cost++
        flags.push({
          severity: 'warn',
          message: `scan row has negative cost_paid_cad: ${row.cost_paid_cad}`,
          entity_id: row.id,
          entity_type: 'scan_result',
        })
      }
    }

    // Duplicate isbn within 60 seconds
    const isbnGroups = new Map<string, Array<{ id: string; recorded_at: string }>>()
    for (const row of data) {
      if (!row.isbn) continue
      const group = isbnGroups.get(row.isbn) ?? []
      group.push({ id: row.id, recorded_at: row.recorded_at })
      isbnGroups.set(row.isbn, group)
    }
    for (const [isbn, rows] of isbnGroups) {
      const sorted = rows
        .slice()
        .sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime())
      for (let i = 1; i < sorted.length; i++) {
        const gap =
          new Date(sorted[i].recorded_at).getTime() - new Date(sorted[i - 1].recorded_at).getTime()
        if (gap <= 60_000) {
          counts.duplicate_isbn++
          flags.push({
            severity: 'warn',
            message: `duplicate isbn ${isbn} within 60s`,
            entity_id: sorted[i].id,
            entity_type: 'scan_result',
          })
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    flags.push({
      severity: 'critical',
      message: `checkScanIntegrity threw: ${msg}`,
      entity_type: 'check',
    })
    return {
      name: 'scan_integrity',
      status: 'fail',
      flags,
      counts,
      duration_ms: Date.now() - start,
    }
  }

  const hasCritical = flags.some((f) => f.severity === 'critical')
  const hasFlags = flags.length > 0
  return {
    name: 'scan_integrity',
    status: hasCritical ? 'fail' : hasFlags ? 'warn' : 'pass',
    flags,
    counts,
    duration_ms: Date.now() - start,
  }
}
