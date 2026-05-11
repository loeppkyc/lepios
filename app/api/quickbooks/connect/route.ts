import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const REDIRECT_URI = 'https://lepios-one.vercel.app/api/quickbooks/callback'
const SCOPE = 'com.intuit.quickbooks.accounting'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const state = crypto.randomUUID()
  const authUrl = new URL(QBO_AUTH_URL)
  authUrl.searchParams.set('client_id', process.env.QBO_CLIENT_ID!)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPE)
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
  authUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return response
}
