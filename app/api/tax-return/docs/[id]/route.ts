import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  const { tax_year, doc_type, description, amount, file_url, is_confirmed } = body as Record<
    string,
    unknown
  >

  const update: Record<string, unknown> = {}
  if (typeof tax_year === 'number') update.tax_year = tax_year
  if (typeof doc_type === 'string') update.doc_type = doc_type
  if (typeof description === 'string') update.description = description.trim()
  if (amount !== undefined) update.amount = typeof amount === 'number' ? amount : null
  if (file_url !== undefined)
    update.file_url = typeof file_url === 'string' && file_url ? file_url.trim() : null
  if (typeof is_confirmed === 'boolean') update.is_confirmed = is_confirmed

  const { data, error } = await supabase
    .from('tax_return_docs')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ doc: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from('tax_return_docs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
