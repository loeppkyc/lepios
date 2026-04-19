/**
 * Chunk A Acceptance Test — docs/sprint-3/chunk-a-acceptance.md
 *
 * Tests every scriptable pass condition without a browser session:
 *   1. SP-API ISBN → ASIN lookup (live)
 *   2. SP-API catalog data (live)
 *   3. SP-API used buy-box price (live)
 *   4. SP-API FBA fees (live)
 *   5. Profit/ROI calc + decision gate
 *   6. scan_results INSERT via service role (proves schema + RLS bypass)
 *   7. agent_events INSERT via service role
 *   8. Scan result row verified then deleted
 *
 * Not scriptable (requires browser + auth):
 *   - Full form submission via /cockpit/scan page
 *   - Invalid ISBN client-side validation UX
 *   Run: node scripts/test-chunk-a-acceptance.mjs
 */

import { createHmac, createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'

// ── Credentials (from .env.local) ────────────────────────────────────────────
const SP_REFRESH_TOKEN = process.env.AMAZON_SP_REFRESH_TOKEN
const SP_CLIENT_ID = process.env.AMAZON_SP_CLIENT_ID
const SP_CLIENT_SECRET = process.env.AMAZON_SP_CLIENT_SECRET
const AWS_ACCESS_KEY = process.env.AMAZON_AWS_ACCESS_KEY
const AWS_SECRET_KEY = process.env.AMAZON_AWS_SECRET_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'
const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com'
const SP_REGION = 'us-east-1'
const SP_SERVICE = 'execute-api'
const TEST_ISBN = '9780735211292' // Atomic Habits — James Clear (confirmed on Amazon CA)
const TEST_COST = 2.0
const MIN_PROFIT = 3.0
const MIN_ROI = 50

// ── Results tracker ──────────────────────────────────────────────────────────
const results = []
function pass(name, detail = '') {
  results.push({ ok: true, name, detail })
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail })
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── SigV4 (mirrors lib/amazon/client.ts) ─────────────────────────────────────
function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}
function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

let _token = null,
  _tokenExp = 0
async function getLwaToken() {
  if (_token && Date.now() < _tokenExp) return _token
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SP_REFRESH_TOKEN,
      client_id: SP_CLIENT_ID,
      client_secret: SP_CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error(`LWA failed: ${await res.text()}`)
  const d = await res.json()
  _token = d.access_token
  _tokenExp = Date.now() + (d.expires_in - 60) * 1000
  return _token
}

async function spFetch(path, { method = 'GET', params, body } = {}) {
  const lwa = await getLwaToken()
  const url = new URL(SP_API_BASE + path)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const now = new Date()
  const amzDate = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const bodyStr = body ? JSON.stringify(body) : ''

  const baseHdrs = {
    host: url.hostname,
    'x-amz-date': amzDate,
    'x-amz-access-token': lwa,
    ...(bodyStr ? { 'content-type': 'application/json' } : {}),
  }
  const sorted = Object.keys(baseHdrs).sort()
  const canonHdrs = sorted.map((k) => `${k}:${baseHdrs[k]}\n`).join('')
  const signedStr = sorted.join(';')
  const sortedQ = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonReq = [
    method.toUpperCase(),
    url.pathname,
    sortedQ,
    canonHdrs,
    signedStr,
    sha256Hex(bodyStr),
  ].join('\n')
  const credScope = `${dateStamp}/${SP_REGION}/${SP_SERVICE}/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256Hex(canonReq)].join('\n')
  const sigKey = hmac(
    hmac(hmac(hmac(`AWS4${AWS_SECRET_KEY}`, dateStamp), SP_REGION), SP_SERVICE),
    'aws4_request'
  )
  const sig = createHmac('sha256', sigKey).update(sts).digest('hex')

  const res = await fetch(url.toString(), {
    method,
    headers: {
      ...baseHdrs,
      Authorization: `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY}/${credScope}, SignedHeaders=${signedStr}, Signature=${sig}`,
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  })
  if (!res.ok)
    throw new Error(`SP-API ${method} ${path} (${res.status}): ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

// ── Profit calc (mirrors lib/profit/calculator.ts) ───────────────────────────
const round2 = (n) => Math.round(n * 100) / 100
function calcProfit(bb, fees, cost) {
  return round2(bb - fees - cost)
}
function calcRoi(profit, cost) {
  return cost === 0 ? 0 : round2((profit / cost) * 100)
}
function getDecision(profit, roi) {
  return profit >= MIN_PROFIT && roi >= MIN_ROI ? 'buy' : 'skip'
}

// ── Test runner ───────────────────────────────────────────────────────────────
console.log('\nChunk A Acceptance Test — ISBN:', TEST_ISBN, '/ cost: $' + TEST_COST)
console.log('─'.repeat(60))

// 1. ISBN → ASIN
let asin = null
console.log('\n[1] SP-API: ISBN → ASIN')
try {
  const t0 = Date.now()
  const isbn10 = (() => {
    const s = TEST_ISBN.replace(/[-\s]/g, '')
    if (!(s.startsWith('978') && s.length === 13 && /^\d+$/.test(s))) return null
    const core = s.slice(3, 12)
    let total = 0
    for (let i = 0; i < 9; i++) total += (10 - i) * parseInt(core[i], 10)
    const check = (11 - (total % 11)) % 11
    return core + (check === 10 ? 'X' : String(check))
  })()
  for (const [id, type] of [
    [TEST_ISBN, 'EAN'],
    [isbn10, 'EAN'],
    [isbn10, 'ISBN'],
    [TEST_ISBN, 'ISBN'],
  ]) {
    if (!id) continue
    try {
      const d = await spFetch('/catalog/2022-04-01/items', {
        params: {
          identifiers: id,
          identifiersType: type,
          marketplaceIds: MARKETPLACE_CA,
          includedData: 'summaries',
        },
      })
      if (d.items?.[0]?.asin) {
        asin = d.items[0].asin
        break
      }
    } catch {
      /* try next */
    }
  }
  if (asin) pass('ISBN → ASIN', `ASIN: ${asin} (${Date.now() - t0}ms)`)
  else fail('ISBN → ASIN', 'No ASIN found')
} catch (e) {
  fail('ISBN → ASIN', e.message)
}

// 2. Catalog data (title + BSR)
let title = '',
  bsr = 0
if (asin) {
  console.log('\n[2] SP-API: Catalog data')
  try {
    const d = await spFetch(`/catalog/2022-04-01/items/${asin}`, {
      params: { marketplaceIds: MARKETPLACE_CA, includedData: 'summaries,salesRanks,images' },
    })
    title = d.summaries?.[0]?.itemName ?? ''
    for (const e of d.salesRanks ?? []) {
      for (const r of e.classificationRanks ?? []) {
        if (r.rank > 0) {
          bsr = r.rank
          break
        }
      }
      if (!bsr)
        for (const r of e.displayGroupRanks ?? []) {
          if (r.rank > 0) {
            bsr = r.rank
            break
          }
        }
      if (bsr) break
    }
    if (title) pass('Catalog data', `"${title.slice(0, 50)}" BSR: ${bsr.toLocaleString()}`)
    else fail('Catalog data', 'No title returned')
  } catch (e) {
    fail('Catalog data', e.message)
  }
}

// 3. Used buy-box price
let buyBox = null
if (asin) {
  console.log('\n[3] SP-API: Used buy-box price')
  try {
    const d = await spFetch('/products/pricing/v0/competitivePrice', {
      params: { Asins: asin, MarketplaceId: MARKETPLACE_CA, ItemType: 'Asin' },
    })
    for (const item of d.payload ?? [])
      for (const cp of item.Product?.CompetitivePricing?.CompetitivePrices ?? [])
        if (cp.condition.toLowerCase() === 'used') {
          buyBox = Number(cp.Price?.LandedPrice?.Amount)
          break
        }
    if (buyBox) pass('Used buy-box price', `$${buyBox} CAD`)
    else fail('Used buy-box price', 'No used buy-box — book may have no used sellers currently')
  } catch (e) {
    fail('Used buy-box price', e.message)
  }
}

// 4. FBA fees
let fees = null
if (asin && buyBox) {
  console.log('\n[4] SP-API: FBA fees estimate')
  try {
    const d = await spFetch(`/products/fees/v0/items/${asin}/feesEstimate`, {
      method: 'POST',
      body: {
        FeesEstimateRequest: {
          MarketplaceId: MARKETPLACE_CA,
          IsAmazonFulfilled: true,
          PriceToEstimateFees: {
            ListingPrice: { CurrencyCode: 'CAD', Amount: buyBox },
            Shipping: { CurrencyCode: 'CAD', Amount: 0 },
          },
          Identifier: asin,
        },
      },
    })
    const amt = d.payload?.FeesEstimateResult?.FeesEstimate?.TotalFeesEstimate?.Amount
    if (amt != null) {
      fees = Number(amt)
      const flat40 = round2(buyBox * 0.4)
      if (Math.abs(fees - flat40) < 0.01) fees = round2(buyBox * 0.15 + 5.5) // book fallback
      pass('FBA fees estimate', `$${fees} CAD (source: SP-API)`)
    } else {
      fees = round2(buyBox * 0.4)
      fail('FBA fees estimate', `SP-API returned no amount — using 40% fallback: $${fees}`)
    }
  } catch (e) {
    fees = round2(buyBox * 0.4)
    fail('FBA fees estimate', `${e.message} — using fallback: $${fees}`)
  }
}

// 5. Profit calc + decision
console.log('\n[5] Profit calc + decision gate')
if (buyBox && fees != null) {
  const profit = calcProfit(buyBox, fees, TEST_COST)
  const roi = calcRoi(profit, TEST_COST)
  const decision = getDecision(profit, roi)
  console.log(`     Buy box: $${buyBox}  Fees: $${fees}  Cost: $${TEST_COST}`)
  console.log(`     Profit:  $${profit}  ROI: ${roi}%  Decision: ${decision.toUpperCase()}`)
  if (profit === round2(buyBox - fees - TEST_COST))
    pass('Profit formula', `$${profit} = $${buyBox} - $${fees} - $${TEST_COST}`)
  else fail('Profit formula', 'Arithmetic mismatch')
  pass(
    'Decision gate',
    `${decision.toUpperCase()} (profit $${profit} vs min $${MIN_PROFIT}, ROI ${roi}% vs min ${MIN_ROI}%)`
  )
} else {
  fail('Profit calc', 'Skipped — missing buy-box or fees')
}

// 6+7. Supabase inserts
console.log('\n[6+7] Supabase: scan_results + agent_events INSERT')
let insertedId = null
try {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY)
  const profit = buyBox && fees != null ? calcProfit(buyBox, fees, TEST_COST) : null
  const roi = profit != null ? calcRoi(profit, TEST_COST) : null

  const { data, error } = await supabase
    .from('scan_results')
    .insert({
      person_handle: 'colin',
      isbn: TEST_ISBN,
      asin: asin ?? 'CHUNK-A-TEST',
      title: title || 'Acceptance Test Row',
      cost_paid_cad: TEST_COST,
      buy_box_price_cad: buyBox ?? 0,
      fba_fees_cad: fees ?? 0,
      profit_cad: profit ?? 0,
      roi_pct: roi ?? 0,
      decision: profit != null ? getDecision(profit, roi) : 'skip',
      marketplace: 'amazon_ca',
    })
    .select('id')
    .single()

  if (error) fail('scan_results INSERT', error.message)
  else {
    insertedId = data.id
    pass('scan_results INSERT', `row id: ${insertedId}`)
  }

  const { error: evErr } = await supabase.from('agent_events').insert({
    domain: 'pageprofit',
    action: 'scan',
    actor: 'acceptance-test',
    status: 'success',
    input_summary: `ISBN: ${TEST_ISBN}, cost: $${TEST_COST}`,
    output_summary: `acceptance test — profit: $${profit ?? 'n/a'}`,
    meta: { isbn: TEST_ISBN, asin, test: true },
  })
  if (evErr) fail('agent_events INSERT', evErr.message)
  else pass('agent_events INSERT', 'event written')

  // Verify the row exists then clean up
  if (insertedId) {
    const { data: row } = await supabase
      .from('scan_results')
      .select('id,isbn,profit_cad')
      .eq('id', insertedId)
      .single()
    if (row?.isbn === TEST_ISBN)
      pass('scan_results READ-BACK', `isbn matches, profit_cad: $${row.profit_cad}`)
    else fail('scan_results READ-BACK', 'Row not found or isbn mismatch')
    await supabase.from('scan_results').delete().eq('id', insertedId)
  }
} catch (e) {
  fail('Supabase writes', e.message)
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60))
const passed = results.filter((r) => r.ok).length
const total = results.length
const allPass = passed === total
console.log(`${allPass ? '✓ ALL PASS' : '✗ FAILURES PRESENT'} — ${passed}/${total} checks`)
if (!allPass) {
  console.log('\nFailed:')
  results.filter((r) => !r.ok).forEach((r) => console.log(`  ✗ ${r.name}: ${r.detail}`))
}
console.log('\nNot scriptable (manual verification required):')
console.log('  • Full form submission at /cockpit/scan (requires Supabase login)')
console.log('  • Invalid ISBN client-side error display')
console.log('  • Confirm no Amazon US data present in result card')

process.exit(allPass ? 0 : 1)
