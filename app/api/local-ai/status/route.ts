import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const tunnelUrl = process.env.OLLAMA_TUNNEL_URL?.replace(/\/$/, '')
  if (!tunnelUrl) {
    return NextResponse.json({ ok: false, error: 'OLLAMA_TUNNEL_URL not configured' })
  }

  try {
    const r = await fetch(`${tunnelUrl}/api/tags`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) {
      return NextResponse.json({ ok: false, error: `Ollama returned ${r.status}` })
    }
    const data = (await r.json()) as { models?: unknown[] }
    return NextResponse.json({ ok: true, models: data.models ?? [] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: msg })
  }
}
