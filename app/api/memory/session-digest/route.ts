import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { buildSessionDigest } from '@/lib/memory/session-digest'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const url = new URL(request.url)
  const topic = url.searchParams.get('topic') ?? undefined
  const requested_by = url.searchParams.get('requested_by') ?? 'api'

  try {
    const digest = await buildSessionDigest({ topic, requested_by })
    return NextResponse.json(
      { markdown: digest.markdown, sections: digest.sections, bytes: digest.bytes, build_ms: digest.build_ms },
      { status: 200 },
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'digest build failed' },
      { status: 500 },
    )
  }
}
