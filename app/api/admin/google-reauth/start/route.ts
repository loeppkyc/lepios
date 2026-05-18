/**
 * GET /api/admin/google-reauth/start
 *
 * Redirects Colin to Google's OAuth consent screen requesting both
 * Gmail (modify) and Sheets (readonly) scopes.
 *
 * After authorizing, Google redirects to /api/admin/google-reauth/callback
 * which exchanges the code for a new refresh_token.
 *
 * Auth: requireCronSecret (admin-only, not public).
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { google } from 'googleapis'

export const dynamic = 'force-dynamic'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
]

export async function GET(request: Request): Promise<NextResponse> {
  // Accept token via ?token= query param so the URL can be opened directly in a browser.
  // requireCronSecret checks the Authorization header first; fall back to ?token=.
  const url = new URL(request.url)
  const queryToken = url.searchParams.get('token')
  const reqWithHeader = queryToken
    ? new Request(request.url, {
        ...request,
        headers: new Headers({ ...Object.fromEntries(request.headers), Authorization: `Bearer ${queryToken}` }),
      })
    : request
  const unauth = requireCronSecret(reqWithHeader)
  if (unauth) return unauth

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
  const authUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',         // force consent screen so Google issues a fresh refresh_token
    scope: SCOPES,
  })

  return NextResponse.redirect(authUrl)
}
