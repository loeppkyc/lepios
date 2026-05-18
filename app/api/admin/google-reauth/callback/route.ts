/**
 * GET /api/admin/google-reauth/callback
 *
 * Receives the OAuth authorization code from Google, exchanges it for
 * tokens, and returns the new refresh_token (masked).
 *
 * After this returns, copy the new refresh_token to Vercel:
 *   Dashboard → lepios → Settings → Environment Variables → GOOGLE_REFRESH_TOKEN
 * Then redeploy once for it to take effect.
 */

import { NextResponse } from 'next/server'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    return NextResponse.json({ error: `Google OAuth error: ${error}` }, { status: 400 })
  }
  if (!code) {
    return NextResponse.json({ error: 'Missing code param' }, { status: 400 })
  }

  const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim()
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim()
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured' },
      { status: 500 }
    )
  }

  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lepios-one.vercel.app'
  const redirectUri = `${base}/api/admin/google-reauth/callback`

  const oauthClient = new google.auth.OAuth2(clientId, clientSecret, redirectUri)

  let tokens: { refresh_token?: string | null; access_token?: string | null }
  try {
    const { tokens: t } = await oauthClient.getToken(code)
    tokens = t
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Token exchange failed: ${msg}` }, { status: 500 })
  }

  const refreshToken = tokens.refresh_token
  if (!refreshToken) {
    return NextResponse.json(
      {
        error:
          'Google did not return a refresh_token. Visit the start URL again — make sure prompt=consent is set.',
      },
      { status: 500 }
    )
  }

  // Mask per security rules: show first 4 + last 4 chars only
  const masked =
    refreshToken.length > 8
      ? `${refreshToken.slice(0, 4)}${'·'.repeat(refreshToken.length - 8)}${refreshToken.slice(-4)}`
      : '****'

  return NextResponse.json({
    ok: true,
    message:
      'New refresh_token obtained. Copy the full token from below and update GOOGLE_REFRESH_TOKEN in Vercel.',
    refresh_token_masked: masked,
    refresh_token: refreshToken,
    scopes: 'gmail.modify + spreadsheets.readonly',
    next_step:
      'Vercel Dashboard → lepios → Settings → Environment Variables → GOOGLE_REFRESH_TOKEN → edit → paste → Save → Redeploy',
  })
}
