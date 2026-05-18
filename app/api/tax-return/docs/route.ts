import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10)

  const { data, error } = await supabase
    .from('tax_return_docs')
    .select('*')
    .eq('tax_year', year)
    .order('doc_type', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ docs: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { tax_year, doc_type, description, amount, file_url } = body as Record<string, unknown>

  if (!description || typeof description !== 'string')
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  if (!doc_type || typeof doc_type !== 'string')
    return NextResponse.json({ error: 'doc_type is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('tax_return_docs')
    .insert({
      user_id: user.id,
      tax_year: typeof tax_year === 'number' ? tax_year : new Date().getFullYear(),
      doc_type,
      description: description.trim(),
      amount: typeof amount === 'number' ? amount : null,
      file_url: typeof file_url === 'string' && file_url ? file_url.trim() : null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ doc: data }, { status: 201 })
}
