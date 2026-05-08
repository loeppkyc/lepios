/**
 * POST /api/failures/log
 *
 * Manual + system entry point for writing to failures_log. Two auth modes:
 *   - Cron-secret bearer (system writes from self-repair, safety_agent, cron)
 *   - User auth (Colin via /failures manual entry form)
 *
 * Body validates against LogFailureInput (see lib/failures/log.ts).
 *
 * Spec: docs/leverage-targets.md#t-006--failures-log-revised-2026-05-08
 * F22: uses requireCronSecret OR requireUser
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { requireUser } from '@/lib/auth/require-user'
import { logFailure } from '@/lib/failures/log'
import { buildSignature, type FailureType } from '@/lib/failures/signature'

export const dynamic = 'force-dynamic'

const FailureTypeSchema: z.ZodType<FailureType> = z.enum([
  'test-fail',
  'migration-error',
  'silent-skip',
  'cron-skip',
  'cross-system-drift',
  'auth-leak',
  'route-500',
  'manual',
])

const SignatureBodySchema = z.object({
  type: FailureTypeSchema,
  files: z.array(z.string()).max(20).optional(),
  error_message: z.string().max(2000).optional(),
  http_status: z.number().int().min(100).max(599).optional(),
  free_text: z.string().max(2000).optional(),
})

const PatternSignatureSchema = z.object({
  type: FailureTypeSchema,
  file_glob: z.string().optional(),
  error_class: z.string().optional(),
  touched_files: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
})

const PostBody = z.object({
  title: z.string().min(1).max(200),
  trigger_context: z.enum(['manual', 'self_repair', 'safety_agent', 'pr', 'workflow']),
  trigger_ref: z.string().nullish(),
  what_happened: z.string().min(1).max(8000),
  expected_behavior: z.string().max(4000).nullish(),
  actual_behavior: z.string().max(4000).nullish(),
  root_cause: z.string().max(8000).nullish(),
  fix_commit_sha: z.string().max(64).nullish(),
  lesson: z.string().max(2000).nullish(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),

  // Caller can supply either an inputs object (we'll build the signature) OR
  // a pre-built pattern_signature. Manual entry typically supplies inputs;
  // self-repair supplies pattern_signature directly because it has rich context.
  signature_input: SignatureBodySchema.optional(),
  pattern_signature: PatternSignatureSchema.optional(),
})

export async function POST(request: Request): Promise<NextResponse> {
  // Auth: cron-secret first (system writes), fall through to user auth (manual writes).
  const cronUnauth = requireCronSecret(request)
  const isCronAuth = cronUnauth === null
  if (!isCronAuth) {
    const userGate = await requireUser({ minRole: 'business' })
    if (!userGate.ok) return userGate.response
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = PostBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const data = parsed.data
  if (!data.signature_input && !data.pattern_signature) {
    return NextResponse.json(
      { ok: false, error: 'Either signature_input or pattern_signature must be provided' },
      { status: 400 }
    )
  }

  const signature = data.pattern_signature ?? buildSignature(data.signature_input!)

  const result = await logFailure({
    title: data.title,
    trigger_context: data.trigger_context,
    trigger_ref: data.trigger_ref ?? null,
    what_happened: data.what_happened,
    expected_behavior: data.expected_behavior ?? null,
    actual_behavior: data.actual_behavior ?? null,
    root_cause: data.root_cause ?? null,
    fix_commit_sha: data.fix_commit_sha ?? null,
    lesson: data.lesson ?? null,
    pattern_signature: signature,
    severity: data.severity,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    failure_number: result.failure_number,
    status: result.status,
    is_recurrence: result.is_recurrence,
    auth_mode: isCronAuth ? 'cron' : 'user',
  })
}
