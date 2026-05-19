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

// Returns true if the previously-stored raw_status means "in stock" for this target type.
// lego-ca stores LEGO's raw availability codes; amazon-asin normalises to 'in_stock'.
function prevWasInStock(lastStatus: string | null, type: string): boolean {
  if (lastStatus == null) return false
  if (type === 'lego-ca') return lastStatus === 'E_AVAILABLE'
  return lastStatus === 'in_stock'
}

function keepaLinks(asin: string): string {
  const chart = `https://graph.keepa.com/pricehistory.png?asin=${asin}&domain=ca&amazon=1&new=1&buybox=1&salesrank=1&range=90&width=600&height=300`
  return `\n📦 <a href="https://amazon.ca/dp/${asin}">Amazon.ca</a>\n📈 ${chart}`
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
    const extra = target.asin ? keepaLinks(target.asin) : ''

    if (target.type === 'lego-ca') {
      // Dead man's switch: alert only on transitions, skip first-seen (last_status null)
      if (newStatus !== target.last_status && target.last_status != null) {
        if (target.last_status === 'E_AVAILABLE' && !result.in_stock) {
          eventType = 'out_of_stock'
          const note = newStatus === 'R_RETIRED' ? ' (retired — unlikely to restock)' : ' (may restock)'
          message = `🔴 <b>${target.name}</b> went OUT OF STOCK${note}\n🛒 ${link}${extra}`
        } else if (target.last_status !== 'E_AVAILABLE' && result.in_stock) {
          eventType = 'in_stock'
          message = `🟢 <b>${target.name}</b> is back IN STOCK!${priceStr}\n🛒 ${link}${extra}`
        }
      }
    } else if (target.alert_on === 'in_stock' && result.in_stock && !prevWasInStock(target.last_status, target.type)) {
      eventType = 'in_stock'
      message = `🟢 <b>${target.name}</b> is back IN STOCK!${priceStr}\n🛒 ${link}${extra}`
    } else if (
      target.alert_on === 'price_drop' &&
      result.price != null &&
      target.threshold_price != null &&
      result.price <= target.threshold_price
    ) {
      eventType = 'price_drop'
      message = `💰 <b>${target.name}</b> price dropped to${priceStr} (threshold: $${target.threshold_price.toFixed(2)})\n🛒 ${link}${extra}`
    } else if (target.alert_on === 'any_change' && newStatus !== target.last_status) {
      eventType = 'status_change'
      message = `🔔 <b>${target.name}</b> status changed: ${target.last_status ?? 'unknown'} → ${newStatus}\n🛒 ${link}${extra}`
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

    // Log every status transition for lego-ca targets to lego_restock_events
    if (target.type === 'lego-ca' && newStatus !== target.last_status) {
      const setNumberMatch = target.url?.match(/-(\d+)$/)
      const setNumber = setNumberMatch ? setNumberMatch[1] : null
      if (setNumber) {
        const { error: restockErr } = await supabase.from('lego_restock_events').insert({
          set_number: setNumber,
          url: target.url,
          status_from: target.last_status ?? null,
          status_to: newStatus,
          source: 'watcher',
          occurred_at: new Date().toISOString(),
        })
        if (restockErr) {
          console.error(
            `[deal-watcher] lego_restock_events insert failed for ${target.name}: ${restockErr.message}`
          )
        }
      }
      // Auto-deactivate when retired + OOS — won't restock
      if (newStatus === 'R_RETIRED' && !result.in_stock) {
        const { error: deactivateErr } = await supabase
          .from('watch_targets')
          .update({ is_active: false })
          .eq('id', target.id)
        if (deactivateErr) {
          console.error(`[deal-watcher] Deactivate failed for ${target.name}: ${deactivateErr.message}`)
        } else {
          console.log(`[deal-watcher] Auto-deactivated retired+OOS: ${target.name}`)
        }
      }
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
  const { data, error } = await supabase.from('watch_targets').select('*').eq('is_active', true)
  if (error) console.error('[deal-watcher] loadTargets error:', error.message, error.code)
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
