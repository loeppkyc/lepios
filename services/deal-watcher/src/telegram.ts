import { supabase } from './supabase.js'

const PRODUCTION_URL = process.env.LEPIOS_URL ?? 'https://lepios-one.vercel.app'
const CRON_SECRET = process.env.CRON_SECRET ?? ''

export async function sendAlert(message: string): Promise<void> {
  await supabase.from('outbound_notifications').insert({
    channel: 'telegram',
    payload: { text: message, parse_mode: 'HTML' },
    status: 'pending',
  })
  // Fire the drain — best effort
  try {
    await fetch(`${PRODUCTION_URL}/api/harness/notifications-drain`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })
  } catch {
    // drain failure is non-fatal
  }
}
