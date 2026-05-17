import { supabase } from './supabase.js'
import { sendAlert } from './telegram.js'
import { checkAmazon } from './checkers/amazon.js'
import { checkLego } from './checkers/lego.js'
import { checkGeneric } from './checkers/generic.js'

interface WatchTarget {
  id: string
  name: string
  type: 'amazon-asin' | 'lego-ca' | 'generic-url'
  url: string | null
  asin: string | null
  lego_item_number: string | null
  check_interval_min: number
  alert_on: string
  threshold_price: number | null
  last_status: string | null
  last_checked_at: string | null
  notes: string | null
}

// Track when each target was last checked (in-process memory; resets on restart)
const lastChecked = new Map<string, number>()

async function checkTarget(target: WatchTarget): Promise<void> {
  let newStatus: string
  let eventType: string | null = null
  let message: string | null = null

  try {
    if (target.type === 'amazon-asin') {
      if (!target.asin) return
      const status = await checkAmazon(target.asin)
      newStatus = status.in_stock ? 'in_stock' : 'out_of_stock'
      const priceStr =
        status.price_cents != null ? `$${(status.price_cents / 100).toFixed(2)}` : 'unknown price'

      if (
        target.alert_on === 'in_stock' &&
        newStatus === 'in_stock' &&
        target.last_status !== 'in_stock'
      ) {
        eventType = 'in_stock'
        message = `🟢 <b>${target.name}</b> is back IN STOCK on Amazon!\n${priceStr}\nhttps://www.amazon.ca/dp/${target.asin}`
      } else if (
        target.alert_on === 'price_drop' &&
        status.price_cents != null &&
        target.threshold_price != null
      ) {
        const priceDollars = status.price_cents / 100
        if (priceDollars <= target.threshold_price) {
          eventType = 'price_drop'
          message = `💰 <b>${target.name}</b> price dropped to ${priceStr} (threshold: $${target.threshold_price.toFixed(2)})\nhttps://www.amazon.ca/dp/${target.asin}`
        }
      } else if (target.alert_on === 'any_change' && newStatus !== target.last_status) {
        eventType = 'status_change'
        message = `🔔 <b>${target.name}</b> status changed: ${target.last_status ?? 'unknown'} → ${newStatus}\nhttps://www.amazon.ca/dp/${target.asin}`
      }
    } else if (target.type === 'lego-ca') {
      if (!target.url) return
      const status = await checkLego(target.url)
      newStatus = status.raw_status
      const priceStr = status.price_cad != null ? ` $${status.price_cad.toFixed(2)}` : ''

      if (target.alert_on === 'in_stock' && status.in_stock && target.last_status !== 'in_stock') {
        eventType = 'in_stock'
        message = `🟢 <b>${target.name}</b> is back IN STOCK on LEGO.ca!${priceStr}\n${target.url}`
      } else if (target.alert_on === 'any_change' && newStatus !== target.last_status) {
        eventType = 'status_change'
        message = `🔔 <b>${target.name}</b> status changed: ${target.last_status ?? 'unknown'} → ${newStatus}\n${target.url}`
      }
    } else if (target.type === 'generic-url') {
      if (!target.url) return
      const pattern = target.notes ?? 'MATCH:in stock'
      const status = await checkGeneric(target.url, pattern)
      newStatus = status.raw_status

      if (status.matched && target.last_status !== 'match') {
        eventType = 'status_change'
        message = `🔔 <b>${target.name}</b> — alert triggered!\n${target.url}`
      }
    } else {
      return
    }

    // Update last_status and last_checked_at
    await supabase
      .from('watch_targets')
      .update({ last_status: newStatus, last_checked_at: new Date().toISOString() })
      .eq('id', target.id)

    // Log event and send Telegram if triggered
    if (eventType && message) {
      await supabase.from('watch_events').insert({
        watch_target_id: target.id,
        event_type: eventType,
        old_value: target.last_status,
        new_value: newStatus,
        message,
      })
      await sendAlert(message)
      console.log(`[deal-watcher] ALERT sent for ${target.name}: ${eventType}`)
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[deal-watcher] Error checking ${target.name}: ${errMsg}`)
    await supabase.from('watch_events').insert({
      watch_target_id: target.id,
      event_type: 'error',
      message: errMsg,
    })
    // Still update last_checked_at so we don't hammer a broken target
    await supabase
      .from('watch_targets')
      .update({ last_checked_at: new Date().toISOString() })
      .eq('id', target.id)
  }
}

async function loadTargets(): Promise<WatchTarget[]> {
  const { data } = await supabase.from('watch_targets').select('*').eq('is_active', true)
  return (data ?? []) as WatchTarget[]
}

async function tick(targets: WatchTarget[]): Promise<void> {
  const now = Date.now()
  for (const target of targets) {
    const intervalMs = target.check_interval_min * 60 * 1000
    const last = lastChecked.get(target.id) ?? 0
    if (now - last >= intervalMs) {
      lastChecked.set(target.id, now)
      // Don't await — run checks concurrently without blocking the tick loop
      checkTarget(target).catch(() => {})
    }
  }
}

async function main(): Promise<void> {
  console.log('[deal-watcher] Starting...')
  let targets = await loadTargets()
  console.log(`[deal-watcher] Loaded ${targets.length} active targets`)

  // Refresh target list every 5 minutes to pick up newly-added targets
  setInterval(
    async () => {
      targets = await loadTargets()
      console.log(`[deal-watcher] Refreshed: ${targets.length} active targets`)
    },
    5 * 60 * 1000
  )

  // Tick every 30 seconds — each target checked against its own interval
  setInterval(() => {
    tick(targets).catch((err) => console.error('[deal-watcher] tick error:', err))
  }, 30_000)

  // Run first tick immediately
  await tick(targets)
}

main().catch((err) => {
  console.error('[deal-watcher] Fatal:', err)
  process.exit(1)
})
