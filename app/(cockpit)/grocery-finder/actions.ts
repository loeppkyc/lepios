'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { runFlippSync } from '@/lib/scraper/flipp-sync'
import type { FlippSyncResult } from '@/lib/scraper/flipp-sync'

export async function triggerFlippSync(): Promise<FlippSyncResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return runFlippSync()
}
