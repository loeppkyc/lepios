import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)
  const session = searchParams.get('session')
  const since = searchParams.get('since')

  if (!session) return NextResponse.json({ error: 'Missing session' }, { status: 400 })

  let query = supabase
    .from('phone_relay_scans')
    .select('id, isbn, scanned_at')
    .eq('session_code', session)
    .order('scanned_at', { ascending: true })

  if (since) query = query.gt('scanned_at', since)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scans: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body = (await req.json()) as { session_code: string; isbn: string }

  if (!body.session_code || !body.isbn) {
    return NextResponse.json({ error: 'Missing session_code or isbn' }, { status: 400 })
  }

  const { error } = await supabase
    .from('phone_relay_scans')
    .insert({ session_code: body.session_code, isbn: body.isbn })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
