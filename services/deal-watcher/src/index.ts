import { supabase } from './supabase.js'
import { sendAlert } from './telegram.js'
import { getAdapter } from './adapters/index.js'
import type { WatchTarget } from './adapters/types.js'

// Track when each target was last checked (in-process memory; resets on restart)
const lastChecked = new Map<string, number>()

function intervalMs(target: WatchTarget): number {
  if (target.check_interval_sec != null) return target.check_interval_sec * 1000
  return target.check_interval_min * 60 * 1000
}

async function checkTarget(target: WatchTarget): Promise<void> {
  let newStatus: string
  let eventType: string | null = null
  let message: string | null = null

  try {
    const adapter = getAdapter(target.type)
    const result = await adapter.check(target)
    newStatus = result.raw_status

    const cartUrl = adapter.cartUrl(target)
    const priceStr = result.price != null ? ` $${result.price.toFixed(2)}` : ''
    const link = cartUrl ?? target.url ?? ''

    if (target.alert_on === 'in_stock' && result.in_stock && target.last_status !== 'in_stock') {
      eventType = 'in_stock'
      message = `🟢 <b>${target.name}</b> is back IN STOCK!${priceStr}\n${link}`
    } else if (
      target.alert_on === 'price_drop' &&
      result.price != null &&
      target.threshold_price != null &&
      result.price <= target.threshold_price
    ) {
      eventType = 'price_drop'
      message = `💰 <b>${target.name}</b> price dropped to${priceStr} (threshold: $${target.threshold_price.toFixed(2)})\n${link}`
    } else if (target.alert_on === 'any_change' && newStatus !== target.last_status) {
      eventType = 'status_change'
      message = `🔔 <b>${target.name}</b> status changed: ${target.last_status ?? 'unknown'} → ${newStatus}\n${link}`
    }

    await supabase
      .from('watch_targets')
      .update({ last_status: newStatus, last_checked_at: new Date().toISOString() })
      .eq('id', target.id)

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
    const last = lastChecked.get(target.id) ?? 0
    if (now - last >= intervalMs(target)) {
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

  // Tick every 2 seconds — supports check_interval_sec down to ~2s for hot-drop watching
  setInterval(() => {
    tick(targets).catch((err) => console.error('[deal-watcher] tick error:', err))
  }, 2_000)

  // Run first tick immediately
  await tick(targets)
}

main().catch((err) => {
  console.error('[deal-watcher] Fatal:', err)
  process.exit(1)
})
