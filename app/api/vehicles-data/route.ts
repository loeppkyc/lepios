import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export interface VehicleMaintenanceRow {
  id: string
  vehicle_id: string
  service_date: string
  km: number | null
  service: string
  cost: number | null
  notes: string | null
}

export interface VehicleData {
  id: string
  name: string
  year: number
  make: string
  model: string
  trim: string | null
  classification: 'business' | 'personal' | 'mixed'
  business_use_pct: number
  purchased_at: string | null
  purchase_price: number | null
  km_at_purchase: number | null
  current_km: number | null
  current_value_estimate: number | null
  current_value_source: string | null
  current_value_notes: string | null
  current_value_updated_at: string | null
  loan_status: 'paid_off' | 'active' | 'unknown'
  loan_paid_off_at: string | null
  loan_remaining: number | null
  notes: string | null
  display_order: number
  // Computed
  km_driven: number | null
  months_owned: number | null
  km_per_month: number | null
  // Maintenance summary
  maintenance: VehicleMaintenanceRow[]
  total_maintenance_cost: number
}

export interface VehiclesDataResponse {
  vehicles: VehicleData[]
  totalCurrentValue: number
  totalMaintenanceCost: number
  combinedYtdMileage: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function computeStats(v: {
  purchased_at: string | null
  km_at_purchase: number | null
  current_km: number | null
}): { km_driven: number | null; months_owned: number | null; km_per_month: number | null } {
  let km_driven: number | null = null
  let months_owned: number | null = null
  let km_per_month: number | null = null
  if (v.km_at_purchase != null && v.current_km != null) {
    km_driven = Math.max(0, v.current_km - v.km_at_purchase)
  }
  if (v.purchased_at) {
    const purchasedAt = new Date(v.purchased_at + 'T00:00:00Z')
    const now = new Date()
    const ms = now.getTime() - purchasedAt.getTime()
    months_owned = Math.max(0, ms / (1000 * 60 * 60 * 24 * 30.4))
  }
  if (km_driven != null && months_owned != null && months_owned > 0) {
    km_per_month = km_driven / months_owned
  }
  return { km_driven, months_owned, km_per_month }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rawVehicles, error: vErr } = await supabase
    .from('vehicles')
    .select('*')
    .order('display_order', { ascending: true })

  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 })

  const { data: rawMaint, error: mErr } = await supabase
    .from('vehicle_maintenance')
    .select('id, vehicle_id, service_date, km, service, cost, notes')
    .order('service_date', { ascending: false })

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  const vehicles: VehicleData[] = (rawVehicles ?? []).map((v) => {
    const stats = computeStats({
      purchased_at: v.purchased_at,
      km_at_purchase: v.km_at_purchase,
      current_km: v.current_km,
    })
    const maintenance = (rawMaint ?? [])
      .filter((m) => m.vehicle_id === v.id)
      .map((m) => ({
        id: m.id,
        vehicle_id: m.vehicle_id,
        service_date: m.service_date,
        km: m.km,
        service: m.service,
        cost: m.cost == null ? null : Number(m.cost),
        notes: m.notes,
      }))
    const total_maintenance_cost = r2(maintenance.reduce((s, m) => s + (m.cost ?? 0), 0))
    return {
      ...v,
      purchase_price: v.purchase_price == null ? null : Number(v.purchase_price),
      current_value_estimate:
        v.current_value_estimate == null ? null : Number(v.current_value_estimate),
      loan_remaining: v.loan_remaining == null ? null : Number(v.loan_remaining),
      ...stats,
      maintenance,
      total_maintenance_cost,
    } as VehicleData
  })

  const totalCurrentValue = r2(vehicles.reduce((s, v) => s + (v.current_value_estimate ?? 0), 0))
  const totalMaintenanceCost = r2(vehicles.reduce((s, v) => s + v.total_maintenance_cost, 0))
  const combinedYtdMileage = vehicles.reduce((s, v) => s + (v.km_driven ?? 0), 0)

  return NextResponse.json({
    vehicles,
    totalCurrentValue,
    totalMaintenanceCost,
    combinedYtdMileage,
  } satisfies VehiclesDataResponse)
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 })
  }

  const allowed = [
    'name',
    'classification',
    'business_use_pct',
    'current_km',
    'current_value_estimate',
    'current_value_source',
    'current_value_notes',
    'loan_status',
    'loan_paid_off_at',
    'loan_remaining',
    'notes',
  ] as const

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  if (body.current_value_estimate !== undefined) {
    updates.current_value_updated_at = new Date().toISOString()
    if (!updates.current_value_source) updates.current_value_source = 'manual'
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('vehicles')
    .update(updates)
    .eq('id', body.id)
    .select('*')
    .single()
  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'vehicle not found' }, { status: 404 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Sync vehicle value into balance_sheet_entries when current_value_estimate changed.
  // Match by name containing the make + model. Soft-fail on sync errors (return vehicle anyway).
  if (body.current_value_estimate !== undefined && data) {
    try {
      const newValue = Number(body.current_value_estimate)
      const { data: existingRow } = await supabase
        .from('balance_sheet_entries')
        .select('id')
        .eq('account_type', 'asset')
        .ilike('name', `%${data.make}%${data.model}%`)
        .limit(1)
        .single()
      if (existingRow) {
        await supabase
          .from('balance_sheet_entries')
          .update({
            balance: newValue,
            as_of_date: new Date().toISOString().slice(0, 10),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingRow.id)
      } else {
        // Insert new row if none exists (e.g. Corolla)
        await supabase.from('balance_sheet_entries').insert({
          name: `${data.year} ${data.make} ${data.model}`,
          account_type: 'asset',
          category: 'equipment',
          balance: newValue,
          as_of_date: new Date().toISOString().slice(0, 10),
          sort_order: data.classification === 'business' ? 16 : 17,
          notes: `Auto-synced from /vehicles (${data.classification}). Edit on /vehicles to update.`,
        })
      }
    } catch (e) {
      console.warn('[vehicles-data] balance_sheet_entries sync failed:', e)
    }
  }

  return NextResponse.json({ vehicle: data })
}
