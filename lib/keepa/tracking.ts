/**
 * lib/keepa/tracking.ts
 *
 * CRUD wrapper for the Keepa server-side tracking API.
 *
 * Tracking registers an ASIN with Keepa so they poll Amazon on our behalf
 * and push notifications when thresholds are hit — cheaper than us polling.
 *
 * Endpoints:
 *   Add:    POST   https://api.keepa.com/tracking/add?key=...
 *   List:   GET    https://api.keepa.com/tracking?key=...&domain=...
 *   Remove: DELETE https://api.keepa.com/tracking/remove?key=...&asin=...&domain=...
 *
 * Price units: integer hundredths of the currency unit (same as Keepa product API).
 *   thresholdValues[].value is in those units — multiply CAD by 100 to convert.
 *
 * Timestamp units: minutes since Unix epoch (same as lightning.ts).
 */

import { keepaConfigured } from './client'

const KEEPA_BASE = 'https://api.keepa.com'

function keepaKey(): string {
  return process.env.KEEPA_API_KEY ?? ''
}

export interface TrackingThreshold {
  /** Keepa priceType: 0 = Amazon, 7 = New (3rd party), 1 = Marketplace New */
  priceType: number
  /** Price in domain currency (CAD), already divided by 100 */
  value: number
}

export interface TrackingEntry {
  asin: string
  domain: number
  title: string | null
  /** Current price in domain currency (CAD), already divided by 100 */
  currentPrice: number | null
  thresholds: TrackingThreshold[]
  /** Date the tracking entry was created in Keepa */
  trackingSince: Date | null
}

interface KeepaRawThreshold {
  priceType?: number
  value?: number
}

interface KeepaRawTrackingEntry {
  asin?: string
  domainId?: number
  title?: string
  currentPrice?: number
  thresholdValues?: KeepaRawThreshold[]
  createDate?: number
}

interface KeepaTrackingListResponse {
  trackingList?: KeepaRawTrackingEntry[]
  tokensLeft?: number
}

interface KeepaAddTrackingResponse {
  tokensLeft?: number
}

/**
 * Register an ASIN for Keepa server-side tracking.
 *
 * @param asin           - Amazon ASIN to track
 * @param domain         - Keepa domain (6 = Amazon.ca)
 * @param targetPriceCad - Optional alert threshold in CAD; registers thresholds for
 *                         priceType 0 (Amazon) and priceType 7 (New 3rd party)
 */
export async function addTracking(
  asin: string,
  domain = 6,
  targetPriceCad?: number,
): Promise<{ ok: boolean; tokensLeft: number | null }> {
  if (!keepaConfigured()) return { ok: false, tokensLeft: null }
  const apiKey = keepaKey()

  const body: Record<string, unknown> = {
    asin,
    domain,
    notifyIfAnyThresholdIsHit: true,
  }

  if (targetPriceCad != null) {
    const keepaUnits = Math.round(targetPriceCad * 100)
    body.thresholdValues = [
      { priceType: 0, value: keepaUnits }, // Amazon price
      { priceType: 7, value: keepaUnits }, // New 3rd party price
    ]
  }

  try {
    const res = await fetch(`${KEEPA_BASE}/tracking/add?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let tokensLeft: number | null = null
    try {
      const json = (await res.json()) as KeepaAddTrackingResponse
      tokensLeft = json.tokensLeft ?? null
    } catch {
      // response body optional
    }
    return { ok: res.ok, tokensLeft }
  } catch (e) {
    console.error('[tracking] addTracking error:', e)
    return { ok: false, tokensLeft: null }
  }
}

/**
 * List all ASINs currently tracked for a domain.
 *
 * @param domain - Keepa domain (6 = Amazon.ca)
 */
export async function getTrackedAsins(
  domain = 6,
): Promise<{ entries: TrackingEntry[]; tokensLeft: number | null }> {
  if (!keepaConfigured()) return { entries: [], tokensLeft: null }
  const apiKey = keepaKey()

  try {
    const res = await fetch(`${KEEPA_BASE}/tracking?key=${apiKey}&domain=${domain}`, {
      next: { revalidate: 0 },
    })
    if (!res.ok) {
      console.error(`[tracking] list ${res.status}`)
      return { entries: [], tokensLeft: null }
    }
    const json = (await res.json()) as KeepaTrackingListResponse
    const rawList: KeepaRawTrackingEntry[] = json.trackingList ?? []

    const entries: TrackingEntry[] = rawList.map((t) => ({
      asin: t.asin ?? '',
      domain: t.domainId ?? domain,
      title: t.title ?? null,
      currentPrice: t.currentPrice != null && t.currentPrice > 0 ? t.currentPrice / 100 : null,
      thresholds: (t.thresholdValues ?? []).map((v) => ({
        priceType: v.priceType ?? 0,
        // Keepa threshold values are in hundredths — divide by 100 for CAD
        value: (v.value ?? 0) / 100,
      })),
      trackingSince: t.createDate ? new Date(t.createDate * 60_000) : null,
    }))

    return { entries, tokensLeft: json.tokensLeft ?? null }
  } catch (e) {
    console.error('[tracking] getTrackedAsins error:', e)
    return { entries: [], tokensLeft: null }
  }
}

/**
 * Remove an ASIN from Keepa tracking.
 *
 * @param asin   - Amazon ASIN to stop tracking
 * @param domain - Keepa domain (6 = Amazon.ca)
 */
export async function removeTracking(
  asin: string,
  domain = 6,
): Promise<{ ok: boolean }> {
  if (!keepaConfigured()) return { ok: false }
  const apiKey = keepaKey()

  try {
    const res = await fetch(
      `${KEEPA_BASE}/tracking/remove?key=${apiKey}&asin=${encodeURIComponent(asin)}&domain=${domain}`,
      { method: 'DELETE' },
    )
    return { ok: res.ok }
  } catch (e) {
    console.error('[tracking] removeTracking error:', e)
    return { ok: false }
  }
}
