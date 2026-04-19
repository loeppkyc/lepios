import { NextResponse } from 'next/server'

// Temporary debug endpoint — remove after diagnosis
export async function GET() {
  const refreshToken = process.env.AMAZON_SP_REFRESH_TOKEN
  const clientId = process.env.AMAZON_SP_CLIENT_ID
  const clientSecret = process.env.AMAZON_SP_CLIENT_SECRET

  // Step 1: check vars are present
  const vars = {
    hasRefreshToken: !!refreshToken,
    hasClientId: !!clientId,
    hasClientSecret: !!clientSecret,
    refreshTokenLength: refreshToken?.length,
    refreshTokenStart: refreshToken?.slice(0, 8),
  }

  // Step 2: try LWA exchange
  let lwaResult: unknown
  try {
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken ?? '',
        client_id: clientId ?? '',
        client_secret: clientSecret ?? '',
      }),
    })
    const body = await res.text()
    lwaResult = { status: res.status, body: body.slice(0, 300) }
  } catch (e) {
    lwaResult = { error: String(e) }
  }

  return NextResponse.json({ vars, lwaResult })
}
