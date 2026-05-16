import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { requireUser } from '@/lib/auth/require-user'
import { logEvent } from '@/lib/knowledge/client'

// F18: amazon_legal / poa_draft events logged to agent_events with duration_ms + suspension_type

const POA_SYSTEM_PROMPT = `You are an expert Amazon seller appeal writer. Structure your response in exactly three sections labeled 'Root Cause:', 'Corrective Actions:', and 'Preventive Measures:'. Be specific, factual, and under 600 words total.`

/** Derive a suspension_type label from the notice text — heuristic, reference-only. */
function deriveSuspensionType(noticeText: string): string {
  const lower = noticeText.toLowerCase()
  if (lower.includes('inauthentic') || lower.includes('counterfeit')) return 'inauthentic_item'
  if (lower.includes('safety') || lower.includes('hazmat') || lower.includes('dangerous'))
    return 'product_safety'
  if (
    lower.includes('intellectual property') ||
    lower.includes('ip violation') ||
    lower.includes('trademark')
  )
    return 'ip_violation'
  if (lower.includes('condition') || lower.includes('used sold as new'))
    return 'condition_complaint'
  if (lower.includes('late shipment') || lower.includes('late delivery')) return 'late_shipment'
  if (lower.includes('order defect') || lower.includes('odr')) return 'order_defect_rate'
  if (lower.includes('review') || lower.includes('feedback manipulation'))
    return 'review_manipulation'
  if (lower.includes('account health') || lower.includes('account suspended'))
    return 'account_suspension'
  if (lower.includes('asin') || lower.includes('listing')) return 'listing_suspension'
  return 'other'
}

export async function POST(request: Request) {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  let body: { noticeText?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const noticeText = body.noticeText?.trim()
  if (!noticeText) {
    return NextResponse.json({ error: 'noticeText is required' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 500 })
  }

  const suspensionType = deriveSuspensionType(noticeText)
  const startMs = Date.now()

  try {
    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: POA_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Please draft a Plan of Action response for the following Amazon suspension notice:\n\n${noticeText}`,
        },
      ],
    })

    const durationMs = Date.now() - startMs

    // Extract text content from the response
    const draft = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    // F18 + F17: log event with suspension_type, duration_ms
    void logEvent('amazon_legal', 'poa_draft', {
      actor: gate.user.id,
      status: 'success',
      durationMs,
      meta: {
        suspension_type: suspensionType,
        notice_length: noticeText.length,
        draft_length: draft.length,
        model: 'claude-sonnet-4-6',
      },
    })

    return NextResponse.json({ draft, suspensionType, durationMs })
  } catch (err) {
    const durationMs = Date.now() - startMs
    const errorMessage = err instanceof Error ? err.message : String(err)

    void logEvent('amazon_legal', 'poa_draft', {
      actor: gate.user.id,
      status: 'failure',
      durationMs,
      meta: {
        suspension_type: suspensionType,
        error: errorMessage,
      },
    })

    return NextResponse.json({ error: `Claude API error: ${errorMessage}` }, { status: 502 })
  }
}
