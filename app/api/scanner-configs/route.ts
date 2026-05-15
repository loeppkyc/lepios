import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { ScannerConfig } from '@/lib/retail/types'

export const dynamic = 'force-dynamic'

// GET /api/scanner-configs — list all scanner configs
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('scanner_configs')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ configs: data as ScannerConfig[] })
}

// POST /api/scanner-configs — create a scanner config
// Body: { store_code: string, min_discount_pct?: number, keywords?: string, enabled?: boolean }
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const storeCode = body.store_code
  if (typeof storeCode !== 'string' || !storeCode.trim()) {
    return NextResponse.json({ error: 'store_code required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('scanner_configs')
    .insert({
      store_code: storeCode.trim(),
      min_discount_pct: typeof body.min_discount_pct === 'number' ? body.min_discount_pct : 30,
      keywords: typeof body.keywords === 'string' ? body.keywords || null : null,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ config: data as ScannerConfig }, { status: 201 })
}
