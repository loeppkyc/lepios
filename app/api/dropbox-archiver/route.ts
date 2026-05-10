import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DropboxAuditRun, DropboxArchiverResponse } from '@/lib/dropbox-archiver/types'

export const revalidate = 0
export type { DropboxAuditRun, DropboxArchiverResponse }

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('dropbox_audit_runs')
    .select('*')
    .eq('user_id', user.id)
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ latest: data ?? null } satisfies DropboxArchiverResponse)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = process.env.DROPBOX_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'DROPBOX_ACCESS_TOKEN not configured' }, { status: 503 })
  }

  const { cutoff_days = 90 } = (await req.json()) as { cutoff_days?: number }

  const cutoffMs = cutoff_days * 24 * 60 * 60 * 1000
  const cutoffDate = new Date(Date.now() - cutoffMs).toISOString()

  // Fetch Dropbox space usage
  const usageRes = await fetch('https://api.dropboxapi.com/2/users/get_space_usage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: 'null',
  })
  if (!usageRes.ok) {
    const err = await usageRes.text()
    return NextResponse.json({ error: `Dropbox API error: ${err}` }, { status: 502 })
  }
  const usage = (await usageRes.json()) as { used: number; allocation: { allocated: number } }
  const usedBytes = usage.used
  const quotaBytes = usage.allocation?.allocated ?? 0
  const usedGb = usedBytes / 1024 ** 3
  const quotaGb = quotaBytes / 1024 ** 3
  const pctUsed = quotaGb > 0 ? (usedGb / quotaGb) * 100 : 0

  // List files older than cutoff (first page only for count estimate)
  let archiveableTotal = 0
  let needDownloadTotal = 0
  let needDownloadBytes = 0
  let cursor: string | null = null
  let hasMore = true

  while (hasMore) {
    const listRes = await fetch(
      cursor
        ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
        : 'https://api.dropboxapi.com/2/files/list_folder',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: cursor
          ? JSON.stringify({ cursor })
          : JSON.stringify({ path: '', recursive: true, include_media_info: false }),
      }
    )
    if (!listRes.ok) break
    const list = (await listRes.json()) as {
      entries: Array<{ '.tag': string; client_modified?: string; size?: number }>
      has_more: boolean
      cursor: string
    }
    for (const entry of list.entries) {
      if (entry['.tag'] !== 'file') continue
      const mod = entry.client_modified ? new Date(entry.client_modified).toISOString() : null
      if (!mod || mod >= cutoffDate) continue
      archiveableTotal++
      needDownloadTotal++
      needDownloadBytes += entry.size ?? 0
    }
    hasMore = list.has_more
    cursor = list.cursor
    if (archiveableTotal > 5000) {
      hasMore = false
    } // cap scan at 5k files
  }

  const run = {
    user_id: user.id,
    cutoff_days,
    used_gb: Math.round(usedGb * 1000) / 1000,
    quota_gb: Math.round(quotaGb * 1000) / 1000,
    pct_used: Math.round(pctUsed * 100) / 100,
    archiveable_total: archiveableTotal,
    already_local: 0,
    need_download: needDownloadTotal,
    need_download_gb: Math.round((needDownloadBytes / 1024 ** 3) * 1000) / 1000,
  }

  const { data, error } = await supabase.from('dropbox_audit_runs').insert(run).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
