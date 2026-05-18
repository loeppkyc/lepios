import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSellerInfo } from '@/lib/keepa/finder'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const sellerId = searchParams.get('sellerId')
  const domainParam = searchParams.get('domain')

  if (!sellerId || !sellerId.trim()) {
    return NextResponse.json({ error: 'sellerId is required' }, { status: 400 })
  }

  const domain = domainParam ? Number(domainParam) : 6

  const { seller, tokensLeft } = await getSellerInfo(sellerId.trim().toUpperCase(), domain)

  return NextResponse.json({ seller, tokensLeft })
}
