import { NextResponse } from 'next/server'
import { forecastQuotaBeforeStart } from '@/lib/harness/quota-forecast'

export const dynamic = 'force-dynamic'

export async function GET() {
  const forecast = await forecastQuotaBeforeStart()
  return NextResponse.json(forecast)
}

export async function POST() {
  return GET()
}
