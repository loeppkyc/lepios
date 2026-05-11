import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { storeTokens } from '@/lib/quickbooks/client'

const REDIRECT_URI = 'https://lepios-one.vercel.app/api/quickbooks/callback'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const realmId = searchParams.get('realmId')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(
      new URL(`/quickbooks?error=${encodeURIComponent(error)}`, request.url)
    )
  }

  const storedState = request.cookies.get('qbo_oauth_state')?.value
  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(new URL('/quickbooks?error=invalid_state', request.url))
  }

  if (!code || !realmId) {
    return NextResponse.redirect(new URL('/quickbooks?error=missing_params', request.url))
  }

  try {
    await storeTokens(code, realmId, REDIRECT_URI)
  } catch (err) {
    console.error('QBO token exchange error:', err)
    return NextResponse.redirect(new URL('/quickbooks?error=token_exchange_failed', request.url))
  }

  const response = NextResponse.redirect(new URL('/quickbooks?connected=1', request.url))
  response.cookies.delete('qbo_oauth_state')
  return response
}
