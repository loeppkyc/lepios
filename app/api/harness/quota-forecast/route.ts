import { NextResponse } from 'next/server'
import { forecastQuotaBeforeStart } from '@/lib/harness/quota-forecast'
import { requireUser } from '@/lib/auth/require-user'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireUser({ minRole: 'admin' })
  if (!gate.ok) return gate.response

  const forecast = await forecastQuotaBeforeStart()
  return NextResponse.json(forecast)
}

export async function POST() {
  return GET()
}
