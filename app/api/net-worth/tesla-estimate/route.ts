import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 25 // Vercel function timeout cap

// TESLA_ROW_ID is the canonical balance_sheet_entries.id for "2022 Tesla (Vehicle)"
// Principle 11: centralized constant with source annotation
// TODO: if the row is ever re-created, update this constant
const TESLA_ROW_ID = 'bbe41f11-ba74-4e16-9912-fe835bc7a6ab'

// AutoTrader.ca Alberta search for 2022 Tesla Model Y Long Range AWD (used)
// URL constructed based on AutoTrader.ca URL patterns — may need tuning if site changes
const AUTOTRADER_URL =
  'https://www.autotrader.ca/cars/tesla/model%20y/on/?rcp=100&rcs=0&srt=35&yRng=2022%2C2022&trnm=Long%20Range%20AWD&prv=Alberta&sts=Used&showcpo=1&mdl=Model%20Y&mk=Tesla'

export interface TeslaEstimateResult {
  median_price_cad: number
  listing_count: number
  scraped_at: string
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export async function POST() {
  // Auth gate — user session required
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Lookup current balance for delta logging (F18)
  const { data: teslaRow } = await supabase
    .from('balance_sheet_entries')
    .select('balance')
    .eq('id', TESLA_ROW_ID)
    .single()
  const priorBalance: number = teslaRow ? Number(teslaRow.balance) : 0

  let chromium: typeof import('@sparticuz/chromium') | null = null
  let puppeteer: typeof import('puppeteer-core') | null = null

  try {
    // Dynamic imports keep the bundle tree-shaken for environments that don't load these
    chromium = await import('@sparticuz/chromium')
    puppeteer = await import('puppeteer-core')
  } catch {
    // If the bundle is too large or the import fails at runtime (bundle_limit_exceeded kill signal)
    return NextResponse.json({ error: 'bundle_limit_exceeded' }, { status: 501 })
  }

  let browser: import('puppeteer-core').Browser | null = null

  try {
    // @sparticuz/chromium serverless launch pattern (referenced from browser-handlers.ts comments)
    const executablePath = await chromium.default.executablePath()
    browser = await puppeteer.default.launch({
      args: chromium.default.args,
      defaultViewport: chromium.default.defaultViewport,
      executablePath,
      headless: chromium.default.headless,
    })

    const page = await browser.newPage()

    // Set a realistic user-agent to reduce bot-detection friction
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    )

    // Navigate to AutoTrader Alberta Tesla search
    await page.goto(AUTOTRADER_URL, { waitUntil: 'domcontentloaded', timeout: 20000 })

    // Wait briefly for any JS-rendered price elements to settle
    await new Promise((resolve) => setTimeout(resolve, 2500))

    // Extract listing prices from the page
    // AutoTrader.ca uses data-testid or class-based price selectors
    // We scrape all text nodes matching CAD price patterns as a resilient fallback
    const prices = await page.evaluate(() => {
      const results: number[] = []

      // Primary: data-testid selectors AutoTrader uses for pricing
      const priceEls = document.querySelectorAll(
        '[data-testid="listing-price"], .price-amount, .price-value, [class*="price"] [class*="amount"]'
      )
      priceEls.forEach((el) => {
        const text = el.textContent ?? ''
        const cleaned = text.replace(/[^0-9]/g, '')
        const val = parseInt(cleaned, 10)
        // Plausible used car price range: $5,000 – $200,000
        if (val >= 5000 && val <= 200000) {
          results.push(val)
        }
      })

      if (results.length > 0) return results

      // Fallback: scan all text for $XX,XXX CAD price patterns
      const allText = document.body.innerText
      const matches = allText.matchAll(/\$\s*(\d{1,3}(?:,\d{3})+)/g)
      for (const m of matches) {
        const val = parseInt(m[1].replace(/,/g, ''), 10)
        if (val >= 5000 && val <= 200000) {
          results.push(val)
        }
      }

      return results
    })

    await browser.close()
    browser = null

    if (prices.length === 0) {
      // AutoTrader may have changed structure — surface graceful error
      await logEstimateEvent(supabase, 0, 0, priorBalance, 'no_listings_found')
      return NextResponse.json({ error: 'No comparables found on AutoTrader.ca' }, { status: 422 })
    }

    const medianPrice = Math.round(median(prices))
    const scrapedAt = new Date().toISOString()

    // F18 logging to agent_events
    const deltaPct =
      priorBalance > 0 ? ((medianPrice - priorBalance) / priorBalance) * 100 : null
    await logEstimateEvent(supabase, medianPrice, prices.length, priorBalance, 'ok', deltaPct)

    return NextResponse.json({
      median_price_cad: medianPrice,
      listing_count: prices.length,
      scraped_at: scrapedAt,
    } satisfies TeslaEstimateResult)
  } catch (err) {
    if (browser) {
      try {
        await browser.close()
      } catch {
        // ignore close error
      }
    }

    const message = err instanceof Error ? err.message : String(err)

    // Log failure
    await logEstimateEvent(supabase, 0, 0, priorBalance, `error: ${message.slice(0, 200)}`)

    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function logEstimateEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  medianPrice: number,
  listingCount: number,
  priorBalance: number,
  status: string,
  deltaPct?: number | null
) {
  try {
    await supabase.from('agent_events').insert({
      domain: 'net_worth',
      action: 'tesla_estimate',
      meta: {
        median_price_cad: medianPrice,
        listing_count: listingCount,
        prior_balance: priorBalance,
        delta_pct: deltaPct ?? null,
        status,
      },
    })
  } catch {
    // Non-blocking — never let logging failure surface to caller
  }
}
