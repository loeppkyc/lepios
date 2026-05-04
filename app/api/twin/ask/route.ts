import { NextRequest, NextResponse } from 'next/server'
import { askTwin, type TwinResponse } from '@/lib/twin/query'

// Re-export types that external consumers (tests, client code) import from this module.
export type { TwinSource, TwinResponse, EscalateReason } from '@/lib/twin/query'

export async function POST(
  req: NextRequest
): Promise<NextResponse<TwinResponse | { error: string }>> {
  const body = (await req.json()) as { question?: string; context?: string; chunk_id?: string }
  const question = (body.question ?? '').trim()

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }

  const resp = await askTwin(question)
  return NextResponse.json<TwinResponse>(resp)
}
