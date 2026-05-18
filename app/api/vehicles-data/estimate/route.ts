import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { logClaudeTokens } from '@/lib/ai/log-tokens'

export const revalidate = 0

interface EstimateRequest {
  year: number
  make: string
  model: string
  trim?: string
  km: number
  condition: 'Excellent' | 'Good' | 'Fair' | 'Poor'
  province?: string
}

export async function POST(request: Request) {
  let body: EstimateRequest
  try {
    body = (await request.json()) as EstimateRequest
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!body.year || !body.make || !body.model || body.km == null || !body.condition) {
    return NextResponse.json(
      { error: 'year, make, model, km, condition required' },
      { status: 400 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY not configured on server' },
      { status: 500 }
    )
  }
  const client = new Anthropic({ apiKey })

  const province = body.province || 'Alberta'
  const prompt = `I need a Canadian used car market value estimate for:
  Vehicle: ${body.year} ${body.make} ${body.model}${body.trim ? ' ' + body.trim : ''}
  Odometer: ${body.km.toLocaleString()} km
  Condition: ${body.condition}
  Province: ${province}, Canada

Based on current Canadian used car market conditions (AutoTrader.ca, Kijiji Autos, CarGurus Canada pricing), provide:
1. Estimated private sale value range (low–high)
2. Estimated dealer trade-in value
3. Key factors affecting this vehicle's value (mileage, trim, market demand)
4. One tip for maximizing sale price

Be specific with dollar amounts. Use CAD.`

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })
    logClaudeTokens(msg, 'vehicles')
    const text = msg.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('\n')
      .trim()
    return NextResponse.json({ estimate: text, model: msg.model })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Anthropic API error' },
      { status: 502 }
    )
  }
}
