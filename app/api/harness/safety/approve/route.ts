import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import {
  decideApproval,
  getApprovalStatus,
  type Decision,
} from '@/lib/harness/safety/approval'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const VALID_DECISIONS: Decision[] = ['approve', 'block', 'defer']

interface ApproveBody {
  approval_id?: string
  decision?: string
  decided_by?: string
  rationale?: string
}

export async function POST(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: ApproveBody
  try {
    body = (await request.json()) as ApproveBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 })
  }

  if (!body.approval_id) {
    return NextResponse.json({ ok: false, error: 'approval_id required' }, { status: 400 })
  }
  if (!body.decision || !VALID_DECISIONS.includes(body.decision as Decision)) {
    return NextResponse.json(
      { ok: false, error: `decision must be one of: ${VALID_DECISIONS.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const result = await decideApproval({
      approvalId: body.approval_id,
      decision: body.decision as Decision,
      decidedBy: body.decided_by ?? 'api_safety_approve',
      rationale: body.rationale,
    })
    return NextResponse.json({ ok: true, status: result.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('not found')) {
      return NextResponse.json({ ok: false, error: msg }, { status: 404 })
    }
    if (msg.includes('already decided') || msg.includes('not a safety.review.requested')) {
      return NextResponse.json({ ok: false, error: msg }, { status: 409 })
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const url = new URL(request.url)
  const id = url.searchParams.get('approval_id')
  if (!id) {
    return NextResponse.json({ ok: false, error: 'approval_id query param required' }, { status: 400 })
  }

  const status = await getApprovalStatus(id)
  if (!status) {
    return NextResponse.json({ ok: false, error: 'approval not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, status })
}
