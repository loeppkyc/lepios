/**
 * Dump all open FinancialEventGroups for gap investigation.
 * Sprint 4 Chunk A — Principle 1 grounding fail: $928.17 API vs $917.83 SC.
 * Run: node --env-file=.env.local scripts/dump-open-finance-groups.mjs
 */

import { createHmac, createHash } from 'crypto'

const SP_REFRESH_TOKEN = process.env.AMAZON_SP_REFRESH_TOKEN
const SP_CLIENT_ID = process.env.AMAZON_SP_CLIENT_ID
const SP_CLIENT_SECRET = process.env.AMAZON_SP_CLIENT_SECRET
const AWS_ACCESS_KEY = process.env.AMAZON_AWS_ACCESS_KEY
const AWS_SECRET_KEY = process.env.AMAZON_AWS_SECRET_KEY

const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com'
const SP_REGION = 'us-east-1'
const SP_SERVICE = 'execute-api'

if (!SP_REFRESH_TOKEN || !SP_CLIENT_ID || !SP_CLIENT_SECRET || !AWS_ACCESS_KEY || !AWS_SECRET_KEY) {
  console.error('FATAL: Missing SP-API credentials. Run with --env-file=.env.local')
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
  if (!res.ok) throw Object.assign(new Error(`SP-API ${path} (${res.status}): ${text.slice(0,400)}`), { status: res.status })
  return JSON.parse(text)
}

const startedAfter = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()
const data = await spFetch('/finances/v0/financialEventGroups', {
  params: { FinancialEventGroupStartedAfter: startedAfter, MaxResultsPerPage: '100' },
})

const groups = data?.payload?.FinancialEventGroupList ?? []
const open = groups.filter(g => !g.FundTransferStatus || g.FundTransferStatus === '')
const closed = groups.filter(g => g.FundTransferStatus && g.FundTransferStatus !== '')

console.log(`\nTotal groups: ${groups.length}  |  Open: ${open.length}  |  Closed: ${closed.length}`)
console.log(`\nSeller Central "Total Balance": $917.83 CAD`)

let sumAll = 0, sumCAD = 0
console.log('\n── All open groups ──────────────────────────────────────────────────\n')
for (const [i, g] of open.entries()) {
  const amt = Number(g.OriginalTotal?.CurrencyAmount ?? 0)
  const cur = g.OriginalTotal?.CurrencyCode ?? 'MISSING'
  if (cur === 'CAD') sumCAD += amt
  sumAll += amt

  console.log(`Group ${i + 1}:`)
  console.log(`  FinancialEventGroupId:    ${g.FinancialEventGroupId ?? 'MISSING'}`)
  console.log(`  FundTransferStatus:       ${JSON.stringify(g.FundTransferStatus)} (absent = open)`)
  console.log(`  OriginalTotal.Amount:     ${amt}`)
  console.log(`  OriginalTotal.Currency:   ${cur}`)
  console.log(`  ConvertedTotal.Amount:    ${g.ConvertedTotal?.CurrencyAmount ?? 'n/a'}`)
  console.log(`  ConvertedTotal.Currency:  ${g.ConvertedTotal?.CurrencyCode ?? 'n/a'}`)
  console.log(`  AccountTail:              ${g.AccountTail ?? 'MISSING'}`)
  console.log(`  FinancialEventGroupStart: ${g.FinancialEventGroupStart ?? 'MISSING'}`)
  console.log(`  FinancialEventGroupEnd:   ${g.FinancialEventGroupEnd ?? 'MISSING/still open'}`)
  console.log(`  ProcessingStatus:         ${g.ProcessingStatus ?? 'MISSING'}`)
  console.log(`  FundTransferDate:         ${g.FundTransferDate ?? 'n/a'}`)
  // Print every key we haven't shown
  const shown = new Set(['FinancialEventGroupId','FundTransferStatus','OriginalTotal','ConvertedTotal','AccountTail','FinancialEventGroupStart','FinancialEventGroupEnd','ProcessingStatus','FundTransferDate'])
  const extra = Object.keys(g).filter(k => !shown.has(k))
  if (extra.length) {
    for (const k of extra) console.log(`  ${k}: ${JSON.stringify(g[k])}`)
  }
  console.log()
}

console.log('── Sums ──────────────────────────────────────────────────────────────')
console.log(`  Sum all open (all currencies):  $${sumAll.toFixed(2)}`)
console.log(`  Sum CAD open only:              $${sumCAD.toFixed(2)}`)
console.log(`  Seller Central Total Balance:   $917.83`)
console.log(`  Gap (API CAD - SC):             $${(sumCAD - 917.83).toFixed(2)}`)
console.log()
