/**
 * Full dump of CAD Group 3 + its financial events.
 * Goal: determine if $928.17 (API OriginalTotal) vs $917.83 (SC Total Balance)
 * gap is timing lag OR gross-vs-net-of-reserve.
 *
 * Run: node --env-file=.env.local scripts/dump-group3-detail.mjs
 */

import { createHmac, createHash } from 'crypto'

const SP_REFRESH_TOKEN = process.env.AMAZON_SP_REFRESH_TOKEN
const SP_CLIENT_ID = process.env.AMAZON_SP_CLIENT_ID
const SP_CLIENT_SECRET = process.env.AMAZON_SP_CLIENT_SECRET
const AWS_ACCESS_KEY = process.env.AMAZON_AWS_ACCESS_KEY
const AWS_SECRET_KEY = process.env.AMAZON_AWS_SECRET_KEY

const GROUP3_ID = 'Vt8Gbv1CylguE5Z-P505dikG68f-G0YiPDtAWp0500A'
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
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: SP_REFRESH_TOKEN, client_id: SP_CLIENT_ID, client_secret: SP_CLIENT_SECRET }),
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
  const res = await fetch(url.toString(), { headers: { ...baseHdrs, Authorization: `AWS4-HMAC-SHA256 Credential=${AWS_ACCESS_KEY}/${credScope}, SignedHeaders=${signedStr}, Signature=${sig}` } })
  const text = await res.text()
  if (!res.ok) throw Object.assign(new Error(`SP-API ${path} (${res.status}): ${text.slice(0, 400)}`), { status: res.status })
  return JSON.parse(text)
}

// ── Part 1: Full raw Group 3 object ──────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════')
console.log('Part 1 — Group 3 raw object (all fields)')
console.log('══════════════════════════════════════════════════════════\n')

const groupsData = await spFetch('/finances/v0/financialEventGroups', {
  params: { FinancialEventGroupStartedAfter: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(), MaxResultsPerPage: '100' },
})
const groups = groupsData?.payload?.FinancialEventGroupList ?? []
const group3 = groups.find(g => g.FinancialEventGroupId === GROUP3_ID)

if (!group3) {
  console.error('Group 3 not found — ID may have changed or rolled to closed.')
  process.exit(1)
}

// Print every field
for (const [k, v] of Object.entries(group3)) {
  console.log(`  ${k}: ${JSON.stringify(v)}`)
}

// ── Part 2: Financial events within Group 3 ───────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════')
console.log('Part 2 — Financial events within Group 3')
console.log('(Looking for Reserve, Hold, Retrocharge, Adjustment lines)')
console.log('══════════════════════════════════════════════════════════\n')

let eventsData
try {
  eventsData = await spFetch(`/finances/v0/financialEventGroups/${encodeURIComponent(GROUP3_ID)}/financialEvents`)
} catch (err) {
  if (err.status === 403) {
    console.error('403 on financialEvents endpoint — may need additional role.')
  } else if (err.status === 404) {
    console.error('404 — financialEvents endpoint not available or group ID invalid.')
  } else {
    console.error(`ERROR: ${err.message}`)
  }
  process.exit(1)
}

const events = eventsData?.payload ?? {}

// Print all event type keys and their lengths
const eventKeys = Object.keys(events)
console.log(`Event types present: ${eventKeys.join(', ') || '(none)'}`)
console.log()

// Focus on reserve/hold/adjustment-related keys first
const reserveKeys = eventKeys.filter(k =>
  /reserve|hold|retrocharge|adjustment|debt|balance|withhold|escrow/i.test(k)
)
const orderKeys = eventKeys.filter(k => /shipment|order|refund/i.test(k))
const feeKeys = eventKeys.filter(k => /fee|service/i.test(k))
const otherKeys = eventKeys.filter(k => !reserveKeys.includes(k) && !orderKeys.includes(k) && !feeKeys.includes(k))

function sumAmounts(items, amountPath) {
  let total = 0
  for (const item of (items ?? [])) {
    let val = item
    for (const seg of amountPath.split('.')) val = val?.[seg]
    if (typeof val === 'number') total += val
  }
  return total
}

function printEventSection(title, keys) {
  if (!keys.length) return
  console.log(`── ${title} ──────────────────────────────────────────────`)
  for (const k of keys) {
    const list = events[k]
    if (!Array.isArray(list) || list.length === 0) {
      console.log(`  ${k}: (empty)`)
      continue
    }
    console.log(`  ${k}: ${list.length} item(s)`)
    // Print first item fully, summarise the rest
    if (list.length > 0) {
      console.log('  First item:')
      for (const [fk, fv] of Object.entries(list[0])) {
        console.log(`    ${fk}: ${JSON.stringify(fv)}`)
      }
    }
    if (list.length > 1) console.log(`  ... and ${list.length - 1} more`)
    console.log()
  }
}

printEventSection('RESERVE / HOLD / ADJUSTMENT (gap candidates)', reserveKeys)
printEventSection('ORDER / SHIPMENT / REFUND', orderKeys)
printEventSection('FEE / SERVICE', feeKeys)
printEventSection('OTHER', otherKeys)

// ── Part 3: Arithmetic check ─────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════')
console.log('Part 3 — Arithmetic')
console.log('══════════════════════════════════════════════════════════\n')
console.log(`  Group 3 OriginalTotal:          $${group3.OriginalTotal?.CurrencyAmount ?? 'n/a'} ${group3.OriginalTotal?.CurrencyCode ?? ''}`)
console.log(`  Group 3 BeginningBalance:       $${group3.BeginningBalance?.CurrencyAmount ?? 'n/a'} ${group3.BeginningBalance?.CurrencyCode ?? ''}`)
console.log(`  Seller Central Total Balance:   $917.83 CAD`)
console.log(`  Gap (OriginalTotal - SC):        $${((group3.OriginalTotal?.CurrencyAmount ?? 0) - 917.83).toFixed(2)}`)
console.log()
console.log('  Hypothesis A (timing lag): SC snapshot is stale; no structural difference.')
console.log('  Hypothesis B (gross vs net): SC shows OriginalTotal minus reserve/hold.')
console.log('  Hypothesis C (definition): SC "Total Balance" uses a different field altogether.')
console.log()
console.log('  Resolve by: checking reserve/hold event lines above.')
console.log('  If ReserveEventList / AdjustmentEventList sums to ~$10.34, that is Hypothesis B.')
console.log('  If those lists are empty or irrelevant, Hypothesis A (timing) remains.')
