import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

// Vendors / vendor patterns for each vehicle.
// Tesla: Tesla branded vendors, Pembridge $334.96 split (60% Tesla per Colin), Rohit Management (charging spot)
// Corolla: Toyota maintenance, Pembridge $334.96 split (40% Corolla)
const TESLA_VENDOR_PATTERNS = ['tesla', 'canada custom autoworks', 'rohit management']
const CATEGORY_VEHICLE = ['Vehicle Insurance', 'Telsa Charging/Repairs', 'parking costs']

export interface VehicleSummary {
  name: 'Tesla Model Y' | 'Toyota Corolla'
  bookValue: number | null // from balance_sheet_entries
  loanRemaining: number // from liabilities
  ytdInsurance: number
  ytdCharging: number
  ytdMaintenance: number
  ytdParking: number
  ytdTotal: number
  monthlyAvg: number
}

export interface VehiclesResponse {
  vehicles: VehicleSummary[]
  ytdMileageKm: number
  combinedYtdCost: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function isTeslaVendor(vendor: string): boolean {
  const v = vendor.toLowerCase()
  return TESLA_VENDOR_PATTERNS.some((p) => v.includes(p))
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Vehicle-related expenses YTD
  const { data: expenses, error: expErr } = await supabase
    .from('business_expenses')
    .select('date, vendor, category, pretax, business_use_pct')
    .gte('date', '2026-01-01')
    .in('category', CATEGORY_VEHICLE)

  if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 })

  // Vehicle book values + loans from balance_sheet_entries
  const { data: bsRows, error: bsErr } = await supabase
    .from('balance_sheet_entries')
    .select('name, account_type, balance')
    .or('name.ilike.%Tesla%,name.ilike.%Corolla%,name.ilike.%Toyota%')

  if (bsErr) return NextResponse.json({ error: bsErr.message }, { status: 500 })

  // Mileage YTD
  const { data: mileage, error: mErr } = await supabase
    .from('mileage_log')
    .select('km, round_trip, trip_date')
    .gte('trip_date', '2026-01-01')

  let ytdKm = 0
  if (!mErr && Array.isArray(mileage)) {
    for (const m of mileage as unknown as { km: string | number; round_trip: boolean }[]) {
      const km = Number(m.km) || 0
      ytdKm += m.round_trip ? km * 2 : km
    }
  }

  // Build per-vehicle buckets
  const buckets = {
    tesla: { insurance: 0, charging: 0, maintenance: 0, parking: 0 },
    corolla: { insurance: 0, charging: 0, maintenance: 0, parking: 0 },
  }

  for (const e of expenses ?? []) {
    const pretax = Number(e.pretax) || 0
    const cat = e.category as string
    const vendor = (e.vendor ?? '') as string

    // Pembridge $334.96 = combined; split 60% Tesla / 40% Corolla per Colin
    if (cat === 'Vehicle Insurance' && vendor.toLowerCase().includes('pembridge')) {
      // Use business_use_pct to attribute (60 = Tesla portion, the rest = Corolla)
      const pct = Number(e.business_use_pct) || 100
      const teslaShare = pretax * (pct / 100)
      const corollaShare = pretax * ((100 - pct) / 100)
      buckets.tesla.insurance += teslaShare
      buckets.corolla.insurance += corollaShare
      continue
    }
    // Other vehicle insurance lines (e.g. SGI legacy) — assume Tesla
    if (cat === 'Vehicle Insurance') {
      buckets.tesla.insurance += pretax
      continue
    }
    // Telsa Charging/Repairs — split charging vs maintenance by vendor
    if (cat === 'Telsa Charging/Repairs') {
      if (vendor.toLowerCase().includes('canada custom autoworks')) {
        buckets.tesla.maintenance += pretax
      } else {
        buckets.tesla.charging += pretax
      }
      continue
    }
    // parking costs — Rohit Management = Tesla charging spot
    if (cat === 'parking costs') {
      if (isTeslaVendor(vendor)) {
        buckets.tesla.parking += pretax
      }
      // (Corolla parking $150/mo = personal, not in business_expenses)
      continue
    }
  }

  const teslaBookValue =
    bsRows?.find((r) => r.name.includes('Tesla') && r.account_type === 'asset')?.balance ?? null
  const teslaLoan =
    bsRows?.find((r) => r.name.includes('Tesla') && r.account_type === 'liability')?.balance ?? 0
  const corollaBookValue = null // Not tracked yet
  const corollaLoan = 0 // Paid off

  const tesla: VehicleSummary = {
    name: 'Tesla Model Y',
    bookValue: teslaBookValue != null ? Number(teslaBookValue) : null,
    loanRemaining: Number(teslaLoan),
    ytdInsurance: r2(buckets.tesla.insurance),
    ytdCharging: r2(buckets.tesla.charging),
    ytdMaintenance: r2(buckets.tesla.maintenance),
    ytdParking: r2(buckets.tesla.parking),
    ytdTotal: r2(
      buckets.tesla.insurance +
        buckets.tesla.charging +
        buckets.tesla.maintenance +
        buckets.tesla.parking
    ),
    monthlyAvg: r2(
      (buckets.tesla.insurance +
        buckets.tesla.charging +
        buckets.tesla.maintenance +
        buckets.tesla.parking) /
        Math.max(1, monthsElapsed())
    ),
  }
  const corolla: VehicleSummary = {
    name: 'Toyota Corolla',
    bookValue: corollaBookValue,
    loanRemaining: corollaLoan,
    ytdInsurance: r2(buckets.corolla.insurance),
    ytdCharging: 0,
    ytdMaintenance: r2(buckets.corolla.maintenance), // currently always 0 (personal vehicle, not in business books)
    ytdParking: 0, // personal, not in business books
    ytdTotal: r2(buckets.corolla.insurance + buckets.corolla.maintenance),
    monthlyAvg: r2(
      (buckets.corolla.insurance + buckets.corolla.maintenance) / Math.max(1, monthsElapsed())
    ),
  }

  return NextResponse.json({
    vehicles: [tesla, corolla],
    ytdMileageKm: r2(ytdKm),
    combinedYtdCost: r2(tesla.ytdTotal + corolla.ytdTotal),
  } satisfies VehiclesResponse)
}

function monthsElapsed(): number {
  const start = new Date('2026-01-01').getTime()
  const now = Date.now()
  const diffMs = now - start
  return Math.max(1, diffMs / (1000 * 60 * 60 * 24 * 30.4))
}
