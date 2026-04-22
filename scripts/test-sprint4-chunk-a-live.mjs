/**
 * Sprint 4 Chunk A — Live SP-API Probe
 *
 * Principle 1 live-test required before acceptance doc is approved.
 * Tests:
 *   1. SP-API Orders endpoint — today's orders in Amazon CA
 *   2. SP-API Finances endpoint — open settlement groups / pending balance
 *
 * Run: node --env-file=.env.local scripts/test-sprint4-chunk-a-live.mjs
 */

import { createHmac, createHash } from 'crypto'

const SP_REFRESH_TOKEN = process.env.AMAZON_SP_REFRESH_TOKEN
const SP_CLIENT_ID = process.env.AMAZON_SP_CLIENT_ID
const SP_CLIENT_SECRET = process.env.AMAZON_SP_CLIENT_SECRET
const AWS_ACCESS_KEY = process.env.AMAZON_AWS_ACCESS_KEY
const AWS_SECRET_KEY = process.env.AMAZON_AWS_SECRET_KEY

const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'
const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com'
const SP_REGION = 'us-east-1'
const SP_SERVICE = 'execute-api'

if (!SP_REFRESH_TOKEN || !SP_CLIENT_ID || !SP_CLIENT_SECRET || !AWS_ACCESS_KEY || !AWS_SECRET_KEY) {
  console.error('FATAL: Missing SP-API credentials. Run with --env-file=.env.local')
  process.exit(1)
}

// ── SigV4 (mirrors lib/amazon/client.ts) ─────────────────────────────────────
function hmac(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}
function sha256Hex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

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
  if (!res.ok) throw new Error(`LWA token exchange failed (${res.status}): ${await res.text()}`)
  const d = await res.json()
  _token = d.access_token
  _tokenExp = Date.now() + (d.expires_in - 60) * 1000
  return _token
}

async function spFetch(path, { method = 'GET', params } = {}) {
  const lwa = await getLwaToken()
  const url = new URL(SP_API_BASE + path)
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)

  const baseHdrs = {
    host: url.hostname,
    'x-amz-date': amzDate,
    'x-amz-access-token': lwa,
  }
  const sorted = Object.keys(baseHdrs).sort()
  const canonHdrs = sorted.map((k) => `${k}:${baseHdrs[k]}\n`).join('')
  const signedStr = sorted.join(';')
  const sortedQ = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonReq = [method, url.pathname, sortedQ, canonHdrs, signedStr, sha256Hex('')].join('\n')
  const credScope = `${dateStamp}/${SP_REGION}/${SP_SERVICE}/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256Hex(canonReq)].join('\n')
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${AWS_SECRET_KEY}`, dateStamp), SP_REGION), SP_SERVICE), 'aws4_request')
  const sig = createHmac('sha256', sigKey).update(sts).digest('hex')

  const res = await fetch(url.toString(), {
    method,
    headers: {
      ...baseHdrs,
      Authorization: `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY}/${credScope}, SignedHeaders=${signedStr}, Signature=${sig}`,
    },
  })

  const text = await res.text()
  if (!res.ok) {
    throw Object.assign(new Error(`SP-API ${path} (${res.status}): ${text.slice(0, 400)}`), { status: res.status, body: text })
  }
  return JSON.parse(text)
}

// ── Edmonton "today" boundaries ───────────────────────────────────────────────
// Streamlit uses America/Edmonton (UTC-6 standard / UTC-7 DST). April = MDT = UTC-6.
// We use offset arithmetic; Intl.DateTimeFormat is unavailable in some Node envs.
const now = new Date()
// Edmonton is UTC-6 (MDT in April)
const EDMONTON_OFFSET_MS = 6 * 60 * 60 * 1000
const edmontonNow = new Date(now.getTime() - EDMONTON_OFFSET_MS)
const todayStr = edmontonNow.toISOString().slice(0, 10) // YYYY-MM-DD in Edmonton time
const createdAfter = new Date(todayStr + 'T00:00:00-06:00').toISOString()
const createdBefore = new Date(todayStr + 'T23:59:59-06:00').toISOString()

// ── Test 1: Orders ────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════')
console.log('Sprint 4 Chunk A — SP-API Live Probe')
console.log(`Edmonton today: ${todayStr}  (UTC window: ${createdAfter.slice(0, 16)} → ${createdBefore.slice(0, 16)})`)
console.log('══════════════════════════════════════════════════════════════\n')

console.log('[TEST 1] SP-API Orders — /orders/v0/orders')
console.log(`  CreatedAfter:  ${createdAfter}`)
console.log(`  CreatedBefore: ${createdBefore}`)
console.log(`  Marketplace:   ${MARKETPLACE_CA} (Amazon CA)\n`)

try {
  const t0 = Date.now()
  // SP-API rejects CreatedBefore if it's in the future or < 2 min ago.
  // For "today" queries, omit CreatedBefore and rely on CreatedAfter alone.
  const data = await spFetch('/orders/v0/orders', {
    params: {
      MarketplaceIds: MARKETPLACE_CA,
      CreatedAfter: createdAfter,
      OrderStatuses: 'Unshipped,PartiallyShipped,Shipped,Canceled',
    },
  })
  const elapsed = Date.now() - t0

  console.log(`  HTTP status:     200 OK (${elapsed}ms)`)
  const orders = data?.payload?.Orders ?? []
  console.log(`  payload.Orders:  ${Array.isArray(data?.payload?.Orders) ? 'present' : 'MISSING — unexpected shape'}`)
  console.log(`  Order count:     ${orders.length}`)

  if (orders.length > 0) {
    const sample = orders[0]
    console.log('\n  Sample order fields:')
    console.log(`    AmazonOrderId:           ${sample.AmazonOrderId ?? 'MISSING'}`)
    console.log(`    PurchaseDate:            ${sample.PurchaseDate ?? 'MISSING'}`)
    console.log(`    OrderTotal.Amount:       ${sample.OrderTotal?.Amount ?? 'MISSING'}`)
    console.log(`    OrderTotal.CurrencyCode: ${sample.OrderTotal?.CurrencyCode ?? 'MISSING'}`)
    console.log(`    NumberOfItemsShipped:    ${sample.NumberOfItemsShipped ?? 'MISSING'}`)
    console.log(`    NumberOfItemsUnshipped:  ${sample.NumberOfItemsUnshipped ?? 'MISSING'}`)
    console.log(`    OrderStatus:             ${sample.OrderStatus ?? 'MISSING'}`)
    console.log(`    FulfillmentChannel:      ${sample.FulfillmentChannel ?? 'MISSING'}`)

    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.OrderTotal?.Amount ?? 0), 0)
    const totalUnits = orders.reduce((sum, o) => sum + (Number(o.NumberOfItemsShipped ?? 0) + Number(o.NumberOfItemsUnshipped ?? 0)), 0)
    console.log(`\n  Aggregate (${orders.length} orders):`)
    console.log(`    Total revenue (pre-fees): $${totalRevenue.toFixed(2)} ${orders[0]?.OrderTotal?.CurrencyCode ?? ''}`)
    console.log(`    Total units:              ${totalUnits}`)
  } else {
    console.log('  (No orders today — check against Seller Central)')
  }

  if (data?.payload?.NextToken) {
    console.log(`\n  NextToken present — more pages exist (not fetched; pagination needed in builder)`)
  }

  console.log('\n  ACTION: Compare order count + revenue above against Seller Central → Orders → Today')
  console.log('  CONFIRM: Do counts match? If not, note discrepancy.')
} catch (err) {
  if (err.status === 403) {
    console.error('  *** 403 FORBIDDEN — SP-API app may be missing Orders role or credentials issue ***')
    console.error('  STOP: Report this to coordinator before proceeding.')
  } else {
    console.error(`  ERROR: ${err.message}`)
  }
}

// ── Test 2: Finances ──────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────────────────────')
console.log('[TEST 2] SP-API Finances — /finances/v0/financialEventGroups')

const startedAfter = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString()
console.log(`  FinancialEventGroupStartedAfter: ${startedAfter}`)
console.log(`  MaxResultsPerPage: 100\n`)

try {
  const t0 = Date.now()
  const data = await spFetch('/finances/v0/financialEventGroups', {
    params: {
      FinancialEventGroupStartedAfter: startedAfter,
      MaxResultsPerPage: '100',
    },
  })
  const elapsed = Date.now() - t0

  console.log(`  HTTP status: 200 OK (${elapsed}ms)`)
  const groups = data?.payload?.FinancialEventGroupList ?? []
  console.log(`  payload.FinancialEventGroupList: ${Array.isArray(data?.payload?.FinancialEventGroupList) ? 'present' : 'MISSING — unexpected shape'}`)
  console.log(`  Total groups returned: ${groups.length}`)

  if (groups.length > 0) {
    const openGroups = groups.filter(g => !g.FundTransferStatus || g.FundTransferStatus === '')
    const closedGroups = groups.filter(g => g.FundTransferStatus && g.FundTransferStatus !== '')

    console.log(`\n  Open groups (no FundTransferStatus): ${openGroups.length}`)
    console.log(`  Closed groups (transferred):          ${closedGroups.length}`)

    let pendingBalance = 0
    for (const g of openGroups) {
      const amt = Number(g.OriginalTotal?.CurrencyAmount ?? 0)
      pendingBalance += amt
    }
    console.log(`\n  Pending balance (sum of open OriginalTotal.CurrencyAmount): $${pendingBalance.toFixed(2)}`)

    if (openGroups.length > 0) {
      const s = openGroups[0]
      console.log('\n  Sample open group fields:')
      console.log(`    FinancialEventGroupId:         ${s.FinancialEventGroupId ?? 'MISSING'}`)
      console.log(`    FundTransferStatus:            ${JSON.stringify(s.FundTransferStatus) ?? 'MISSING'} (should be absent/empty)`)
      console.log(`    OriginalTotal.CurrencyAmount:  ${s.OriginalTotal?.CurrencyAmount ?? 'MISSING'}`)
      console.log(`    OriginalTotal.CurrencyCode:    ${s.OriginalTotal?.CurrencyCode ?? 'MISSING'}`)
      console.log(`    AccountTail:                   ${s.AccountTail ?? 'MISSING'}`)
      console.log(`    FinancialEventGroupStart:      ${s.FinancialEventGroupStart ?? 'MISSING'}`)
    }
  } else {
    console.log('  (No financial event groups returned — this is unexpected if account is active)')
  }

  if (data?.payload?.NextToken) {
    console.log(`\n  NextToken present — more pages exist (builder will need pagination)`)
  }

  console.log('\n  ACTION: Compare pending balance above against Seller Central → Payments → Statement View → Pending')
  console.log('  CONFIRM: Does pending balance match? Note any discrepancy.')
} catch (err) {
  if (err.status === 403) {
    console.error('  *** 403 FORBIDDEN — SP-API app is MISSING the Finances role ***')
    console.error('  STOP: Add Finances role in Amazon Seller Central → Apps & Services → Develop Apps')
    console.error('  Then re-run this script before doc approval.')
    process.exit(1)
  } else {
    console.error(`  ERROR: ${err.message}`)
    console.error('  Full error body:', err.body?.slice(0, 300))
  }
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log('Paste results back to coordinator. Include:')
console.log('  - Test 1: order count + whether it matches Seller Central')
console.log('  - Test 2: pending balance + whether it matches Seller Central')
console.log('  - Any 403 errors')
console.log('══════════════════════════════════════════════════════════════\n')
