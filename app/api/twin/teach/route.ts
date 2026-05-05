import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { saveKnowledge, logEvent } from '@/lib/knowledge/client'

export const dynamic = 'force-dynamic'

interface TeachBody {
  question?: string
  answer?: string
  source_event_id?: string
}

export async function POST(request: Request): Promise<NextResponse> {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: TeachBody
  try {
    body = (await request.json()) as TeachBody
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const question = (body.question ?? '').trim()
  const answer = (body.answer ?? '').trim()

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 })
  }
  if (!answer) {
    return NextResponse.json({ error: 'answer is required' }, { status: 400 })
  }

  const title = question.length > 100 ? `${question.slice(0, 97)}...` : question

  const knowledgeId = await saveKnowledge('principle', 'twin', title, {
    problem: question,
    solution: answer,
    context: 'Captured from twin escalation; taught by Colin via /api/twin/teach',
    entity: 'twin-teach',
    confidence: 0.85,
    sourceEvents: body.source_event_id ? [body.source_event_id] : undefined,
  })

  if (!knowledgeId) {
    void logEvent('twin', 'twin.teach', {
      actor: 'colin',
      status: 'error',
      inputSummary: question.slice(0, 200),
      outputSummary: 'saveKnowledge returned null',
    })
    return NextResponse.json({ error: 'failed to save knowledge' }, { status: 500 })
  }

  void logEvent('twin', 'twin.teach', {
    actor: 'colin',
    status: 'success',
    inputSummary: question.slice(0, 200),
    outputSummary: `taught: ${title}`,
    meta: { knowledge_id: knowledgeId, source_event_id: body.source_event_id ?? null },
  })

  return NextResponse.json({ knowledge_id: knowledgeId }, { status: 200 })
}
