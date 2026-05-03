import { createServiceClient } from '@/lib/supabase/service'

// F18: Sandbox layer observability — morning_digest summary line.
// Queries sandbox_runs for last 24h: total runs, denied count, timeout count.
// Never throws — returns 'Sandbox: stats unavailable' on any error.

interface SandboxRunRow {
  status: string
}

export async function buildSandboxDigestLine(): Promise<string> {
  try {
    const db = createServiceClient()
    const since = new Date(Date.now() - 86_400_000).toISOString()

    const { data, error } = await db
      .from('sandbox_runs')
      .select('status')
      .gte('started_at', since)
      .limit(500)

    if (error) return 'Sandbox: stats unavailable'

    const rows = (data ?? []) as SandboxRunRow[]
    const total = rows.length

    if (total === 0) return 'Sandbox: no run in last 24h'

    const denies = rows.filter((r) => r.status === 'denied').length
    const timeouts = rows.filter((r) => r.status === 'timeout').length

    return `Sandbox (24h): ${total} runs, ${denies} denies, ${timeouts} timeouts`
  } catch {
    return 'Sandbox: stats unavailable'
  }
}
