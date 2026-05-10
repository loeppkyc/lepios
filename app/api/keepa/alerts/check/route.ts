import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { lookupAlertPrice } from '@/lib/keepa/deals'
import { keepaConfigured } from '@/lib/keepa/client'
import { logEvent } from '@/lib/knowledge/client'

export const dynamic = 'force-dynamic'

// POST — check all active alerts against current Keepa prices
// 20% Better vs Streamlit: triggered state persisted to DB (was ephemeral in session)
export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!keepaConfigured()) {
    return NextResponse.json({ error: 'KEEPA_API_KEY not configured' }, { status: 503 })
  }

  const { data: alerts, error } = await supabase
    .from('keepa_price_alerts')
    .select('id, asin, alert_type, threshold')
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 })
  if (!alerts?.length) return NextResponse.json({ triggered: [], checked: 0 })

  const triggered: Array<{
    id: string
    asin: string
    alertType: string
    threshold: number
    currentValue: number
  }> = []
  let checked = 0

  for (const alert of alerts) {
    const { price, bsr } = await lookupAlertPrice(alert.asin, 6)
    const currentValue = alert.alert_type.startsWith('rank') ? bsr : price
    if (currentValue == null) continue

    checked++
    const isTriggered =
      (alert.alert_type === 'price_below' && currentValue <= alert.threshold) ||
      (alert.alert_type === 'price_above' && currentValue >= alert.threshold) ||
      (alert.alert_type === 'rank_below' && currentValue <= alert.threshold) ||
      (alert.alert_type === 'rank_above' && currentValue >= alert.threshold)

    await supabase
      .from('keepa_price_alerts')
      .update({
        current_value: currentValue,
        last_checked_at: new Date().toISOString(),
        triggered: isTriggered,
      })
      .eq('id', alert.id)

    if (isTriggered) {
      triggered.push({
        id: alert.id,
        asin: alert.asin,
        alertType: alert.alert_type,
        threshold: alert.threshold,
        currentValue,
      })
    }
  }

  void logEvent('keepa', 'alerts.check', {
    actor: 'user',
    status: 'success',
    outputSummary: `Checked ${checked} alerts — ${triggered.length} triggered`,
  })

  return NextResponse.json({ triggered, checked })
}
