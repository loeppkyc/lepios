import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCategoryInfo } from '@/lib/keepa/finder'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const categoryIdParam = searchParams.get('categoryId')
  const domainParam = searchParams.get('domain')

  if (!categoryIdParam) {
    return NextResponse.json({ error: 'categoryId is required' }, { status: 400 })
  }

  const categoryId = Number(categoryIdParam)
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    return NextResponse.json({ error: 'categoryId must be a positive integer' }, { status: 400 })
  }

  const domain = domainParam ? Number(domainParam) : 6

  const { category, tokensLeft } = await getCategoryInfo(categoryId, domain)

  return NextResponse.json({ category, tokensLeft })
}
