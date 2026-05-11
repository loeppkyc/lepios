import { NextRequest, NextResponse } from 'next/server'
import { lookupBrandRisk, scanTitleForRisk, BRAND_DB } from '@/lib/reselling/brand-risk'

// GET /api/brand-risk?brand=Nike
// GET /api/brand-risk?title=Nike+Air+Max+...
// GET /api/brand-risk (returns full DB)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const brand = searchParams.get('brand')
  const title = searchParams.get('title')

  if (brand) {
    const result = lookupBrandRisk(brand)
    return NextResponse.json({ result })
  }

  if (title) {
    const results = scanTitleForRisk(title)
    return NextResponse.json({ results })
  }

  return NextResponse.json({ brands: BRAND_DB })
}
