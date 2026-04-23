/**
 * Principle 1 live test — FBA Inventory Summaries endpoint (v2 — with pagination).
 * Sprint 4 Chunk B Phase 2 gate.
 *
 * Fix from v1: nextToken is at body.pagination (top-level), NOT body.payload.pagination.
 * Fix from v1: inbound fields are direct numbers on inventoryDetails, not nested objects.
 *
 * Run: node --env-file=.env.local scripts/test-fba-inventory-live.mjs
 */

import { createHmac, createHash } from 'crypto'

const SP_REFRESH_TOKEN = process.env.AMAZON_SP_REFRESH_TOKEN
const SP_CLIENT_ID = process.env.AMAZON_SP_CLIENT_ID
const SP_CLIENT_SECRET = process.env.AMAZON_SP_CLIENT_SECRET
const AWS_ACCESS_KEY = process.env.AMAZON_AWS_ACCESS_KEY
const AWS_SECRET_KEY = process.env.AMAZON_AWS_SECRET_KEY

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'
const TARGET_ASIN = '0070960526' // Colin confirmed SC shows Inbound: 1 for this ASIN
const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com'
const SP_REGION = 'us-east-1'
const SP_SERVICE = 'execute-api'

if (!SP_REFRESH_TOKEN || !SP_CLIENT_ID || !SP_CLIENT_SECRET || !AWS_ACCESS_KEY || !AWS_SECRET_KEY) {
  console.error('FATAL: Missing SP-API credentials.')
  process.exit(1)
}

function hmac(key, data) { return createHmac('sha256', key).update(data, 'utf8').digest() }
function sha256Hex(data) { return createHash('sha256').update(data, 'utf8').digest('hex') }

let _token = null, _tokenExp = 0
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

async function spFetch(path, { params } = {}) {
  const lwa = await getLwaToken()
  const url = new URL(SP_API_BASE + path)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)
  const baseHdrs = { host: url.hostname, 'x-amz-date': amzDate, 'x-amz-access-token': lwa }
  const sorted = Object.keys(baseHdrs).sort()
  const canonHdrs = sorted.map(k => `${k}:${baseHdrs[k]}\n`).join('')
  const signedStr = sorted.join(';')
  const sortedQ = [...url.searchParams.entries()].sort(([a],[b]) => a < b ? -1 : 1).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const canonReq = ['GET', url.pathname, sortedQ, canonHdrs, signedStr, sha256Hex('')].join('\n')
  const credScope = `${dateStamp}/${SP_REGION}/${SP_SERVICE}/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256Hex(canonReq)].join('\n')
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${AWS_SECRET_KEY}`, dateStamp), SP_REGION), SP_SERVICE), 'aws4_request')
  const sig = createHmac('sha256', sigKey).update(sts).digest('hex')
  const res = await fetch(url.toString(), {
    headers: {
      ...baseHdrs,
      Authorization: `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY}/${credScope}, SignedHeaders=${signedStr}, Signature=${sig}`,
    },
  })
  const text = await res.text()
  if (!res.ok) throw Object.assign(new Error(`SP-API ${path} (${res.status}): ${text.slice(0, 600)}`), { status: res.status })
  return { status: res.status, body: JSON.parse(text) }
}

// ── Paginate through all inventory summaries ──────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════')
console.log('Fetching all FBA inventory pages (pagination fixed)...')
console.log('══════════════════════════════════════════════════════════\n')

const allSummaries = []
let pageCount = 0
// startDateTime: filter to SKUs updated in the last 90 days.
// Without this, the endpoint returns the full lifetime FBA catalog (14k+ SKUs,
// 300+ pages, 3+ minutes). With it, only recently-active inventory is returned.
const startDateTime = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
console.log(`  startDateTime filter: ${startDateTime} (90 days back)\n`)

let currentParams = {
  details: 'true',
  granularityType: 'Marketplace',
  granularityId: MARKETPLACE_CA,
  marketplaceIds: MARKETPLACE_CA,
  startDateTime,
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

while (true) {
  let result
  let attempts = 0
  while (true) {
    attempts++
    try {
      result = await spFetch('/fba/inventory/v1/summaries', { params: currentParams })
      break
    } catch (err) {
      if (err.status === 429 && attempts <= 3) {
        process.stdout.write(`  [429 rate limit — waiting 2s, retry ${attempts}/3]\n`)
        await sleep(2000)
        continue
      }
      console.error(`HTTP ERROR on page ${pageCount + 1}: ${err.message}`)
      if (err.status === 403) console.error('403 → FBA Inventory role NOT enabled. Kill signal.')
      process.exit(1)
    }
  }

  pageCount++
  const summaries = result.body?.payload?.inventorySummaries ?? []
  allSummaries.push(...summaries)

  // nextToken is at top-level body.pagination, NOT inside payload
  const nextToken = result.body?.pagination?.nextToken
  process.stdout.write(`  Page ${pageCount}: ${summaries.length} records (total: ${allSummaries.length}) | nextToken: ${nextToken ? 'yes' : 'none'}\n`)

  if (!nextToken) break
  // SP-API FBA Inventory: all original params required alongside nextToken
  currentParams = {
    nextToken,
    details: 'true',
    granularityType: 'Marketplace',
    granularityId: MARKETPLACE_CA,
    marketplaceIds: MARKETPLACE_CA,
    startDateTime,
  }
  // Throttle: FBA Inventory Summaries rate limit is 2 req/s
  await sleep(700)
}

console.log(`\n  Total SKUs across all pages: ${allSummaries.length}`)

// ── Part 1: Shape confirmation ────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════')
console.log('Part 1 — Payload shape (first record with any non-zero qty)')
console.log('══════════════════════════════════════════════════════════\n')

const firstNonZero = allSummaries.find(s => (s.totalQuantity ?? 0) > 0 || (s.inventoryDetails?.fulfillableQuantity ?? 0) > 0)
const sampleRecord = firstNonZero ?? allSummaries[0]
if (sampleRecord) {
  for (const [k, v] of Object.entries(sampleRecord)) {
    console.log(`  ${k}: ${JSON.stringify(v)}`)
  }
} else {
  console.log('  (no records)')
}

// ── Part 2: ASIN 0070960526 lookup ────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════')
console.log(`Part 2 — Targeted ASIN lookup: ${TARGET_ASIN}`)
console.log('  (SC shows Inbound: 1 — API should match)')
console.log('══════════════════════════════════════════════════════════\n')

const targetRecords = allSummaries.filter(s => s.asin === TARGET_ASIN)
if (targetRecords.length === 0) {
  console.log(`  NOT FOUND in any page across ${allSummaries.length} records.`)
  console.log('  Possible causes: condition variant, different ASIN in CA marketplace, or SKU mismatch.')
} else {
  for (const r of targetRecords) {
    const d = r.inventoryDetails ?? {}
    const inboundTotal = (d.inboundWorkingQuantity ?? 0) + (d.inboundShippedQuantity ?? 0) + (d.inboundReceivingQuantity ?? 0)
    console.log(`  SKU: ${r.sellerSku} | condition: ${r.condition}`)
    console.log(`    fulfillable:   ${d.fulfillableQuantity ?? 0}`)
    console.log(`    inbound total: ${inboundTotal} (working: ${d.inboundWorkingQuantity ?? 0}, shipped: ${d.inboundShippedQuantity ?? 0}, receiving: ${d.inboundReceivingQuantity ?? 0})`)
    console.log(`    reserved:      ${d.reservedQuantity?.totalReservedQuantity ?? 0}`)
    console.log(`    unsellable:    ${d.unfulfillableQuantity?.totalUnfulfillableQuantity ?? 0}`)
    console.log(`    totalQuantity: ${r.totalQuantity ?? 0}`)
    console.log()
  }
}

// ── Part 3: Aggregated totals ─────────────────────────────────────────────────

console.log('══════════════════════════════════════════════════════════')
console.log('Part 3 — Aggregated totals across all pages')
console.log('══════════════════════════════════════════════════════════\n')

let fulfillable = 0, reserved = 0, inbound = 0, unsellable = 0, totalQty = 0

for (const s of allSummaries) {
  const d = s.inventoryDetails ?? {}
  fulfillable += d.fulfillableQuantity ?? 0
  reserved    += d.reservedQuantity?.totalReservedQuantity ?? 0
  inbound     += (d.inboundWorkingQuantity ?? 0) + (d.inboundShippedQuantity ?? 0) + (d.inboundReceivingQuantity ?? 0)
  unsellable  += d.unfulfillableQuantity?.totalUnfulfillableQuantity ?? 0
  totalQty    += s.totalQuantity ?? 0
}

console.log(`  Fulfillable (available):  ${fulfillable}`)
console.log(`  Reserved:                 ${reserved}`)
console.log(`  Inbound (all states):     ${inbound}`)
console.log(`  Unsellable:               ${unsellable}`)
console.log(`  totalQuantity sum:        ${totalQty}`)
console.log()
console.log('  ► Match "Fulfillable" to SC → Manage FBA Inventory → Available total.')
console.log('  ► Match "Inbound" to SC → Manage FBA Inventory → Inbound total.')
