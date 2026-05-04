import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { runInSandbox } from '@/lib/harness/sandbox/runtime'
import { SandboxDeniedError } from '@/lib/security/sandbox-contract'
import { z } from 'zod'

// ── Request body schema ────────────────────────────────────────────────────────

const SandboxScopeSchema = z.object({
  fs: z.object({
    allowedPaths: z.array(z.string()).optional(),
    deniedPaths: z.array(z.string()).optional(),
    readOnly: z.boolean().optional(),
  }),
  net: z
    .object({
      allowedHosts: z.array(z.string()).optional(),
      denyAll: z.boolean().optional(),
    })
    .optional(),
  db: z
    .object({
      allowedTables: z.array(z.string()).optional(),
      readOnly: z.boolean().optional(),
    })
    .optional(),
})

const SandboxRunRequestSchema = z.object({
  cmd: z.union([z.string(), z.array(z.string())]),
  agentId: z.string().min(1),
  capability: z.string().min(1),
  scope: SandboxScopeSchema,
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  reason: z.string().optional(),
})

// ── Route handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // auth: see lib/auth/cron-secret.ts (F22)
  const authError = requireCronSecret(request)
  if (authError) return authError

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = SandboxRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const data = parsed.data

  // Build scope — SandboxScope.fs.allowedPaths is required (string[]);
  // the request body allows omitting it for brevity so we default to [].
  const scope = {
    fs: {
      allowedPaths: data.scope.fs.allowedPaths ?? [],
      ...(data.scope.fs.deniedPaths !== undefined
        ? { deniedPaths: data.scope.fs.deniedPaths }
        : {}),
    },
    ...(data.scope.net !== undefined ? { net: data.scope.net } : {}),
  }

  try {
    const result = await runInSandbox(data.cmd, {
      agentId: data.agentId,
      capability: data.capability,
      scope,
      timeoutMs: data.timeoutMs,
      cwd: data.cwd,
      env: data.env,
      reason: data.reason,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof SandboxDeniedError) {
      return NextResponse.json({ error: 'sandbox_denied', reason: err.reason }, { status: 403 })
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'internal', message }, { status: 500 })
  }
}
