import { createClient } from '@supabase/supabase-js'

// Service role client — bypasses RLS for server-side operations.
// Use ONLY in server components and API routes. Never expose to the browser.
// Switch reads to the cookie-based client in Sprint 5 once auth is wired.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}
