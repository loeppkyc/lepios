import { NextResponse } from 'next/server'
import { forecastQuotaBeforeStart } from '@/lib/harness/quota-forecast'
import { requireCronSecret } from '@/lib/auth/cron-secret'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const forecast = await forecastQuotaBeforeStart()
  return NextResponse.json(forecast)
}

export async function POST(request: Request) {
  return GET(request)
}
