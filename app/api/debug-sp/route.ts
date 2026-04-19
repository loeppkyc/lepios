import { NextResponse } from 'next/server'
import { createHmac, createHash } from 'crypto'

// Temporary debug endpoint — remove after diagnosis
export async function GET() {
  const refreshToken = process.env.AMAZON_SP_REFRESH_TOKEN ?? ''
  const clientId = process.env.AMAZON_SP_CLIENT_ID ?? ''
  const clientSecret = process.env.AMAZON_SP_CLIENT_SECRET ?? ''
  const awsKey = process.env.AMAZON_AWS_ACCESS_KEY ?? ''
  const awsSecret = process.env.AMAZON_AWS_SECRET_KEY ?? ''

  // LWA
  let accessToken = ''
  let lwaStatus = 0
  let lwaError = ''
  try {
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    })
    lwaStatus = res.status
    const d = await res.json() as { access_token?: string; error?: string; error_description?: string }
    if (d.access_token) accessToken = d.access_token
    else lwaError = `${d.error}: ${d.error_description}`
  } catch (e) { lwaError = String(e) }

  if (!accessToken) return NextResponse.json({ lwaStatus, lwaError })

  // Catalog search
  function hmac(key: Buffer | string, data: string) { return createHmac('sha256', key).update(data, 'utf8').digest() }
  function sha256Hex(data: string) { return createHash('sha256').update(data, 'utf8').digest('hex') }

  const isbn = '9780679308416'
  const MARKETPLACE_CA = 'A2EUQ1WTGCTBG2'
  const url = new URL('https://sellingpartnerapi-na.amazon.com/catalog/2022-04-01/items')
  url.searchParams.set('identifiers', isbn)
  url.searchParams.set('identifiersType', 'EAN')
  url.searchParams.set('marketplaceIds', MARKETPLACE_CA)
  url.searchParams.set('includedData', 'summaries')

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]/g,'').replace(/\.\d{3}Z$/,'Z')
  const dateStamp = amzDate.slice(0,8)
  const hdrs = { host: url.hostname, 'x-amz-date': amzDate, 'x-amz-access-token': accessToken }
  const sorted = Object.keys(hdrs).sort()
  const canonHdrs = sorted.map(k=>`${k}:${(hdrs as Record<string,string>)[k]}\n`).join('')
  const signedStr = sorted.join(';')
  const sortedQ = [...url.searchParams.entries()].sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  const canonReq = ['GET', url.pathname, sortedQ, canonHdrs, signedStr, sha256Hex('')].join('\n')
  const credScope = `${dateStamp}/us-east-1/execute-api/aws4_request`
  const sts = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256Hex(canonReq)].join('\n')
  const sigKey = hmac(hmac(hmac(hmac(`AWS4${awsSecret}`, dateStamp), 'us-east-1'), 'execute-api'), 'aws4_request')
  const sig = createHmac('sha256', sigKey).update(sts).digest('hex')

  let catalogResult: unknown
  try {
    const res = await fetch(url.toString(), {
      headers: { ...hdrs, Authorization: `AWS4-HMAC-SHA256 Credential=${awsKey}/${credScope}, SignedHeaders=${signedStr}, Signature=${sig}` },
    })
    const body = await res.text()
    catalogResult = { status: res.status, body: body.slice(0, 500) }
  } catch (e) { catalogResult = { error: String(e) } }

  return NextResponse.json({ lwaStatus, catalogResult })
}
