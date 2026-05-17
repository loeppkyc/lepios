// F18: bench=product_coverage_pct (target ≥80% household staples with Edmonton current price);
// surface=grocery-finder page coverage pill + morning_digest top deals
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runFlippSync } from '@/lib/scraper/flipp-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  try {
    const result = await runFlippSync()
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ ok: false, error: message }, { status: 500 })
  }
}
