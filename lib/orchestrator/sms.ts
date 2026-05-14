import { sms } from '@/lib/harness/arms-legs/sms'

/**
 * High-level helper to send an SMS notification to Colin.
 * Reuses the default TWILIO_TO_NUMBER from env if none provided.
 */
export async function postSms(text: string, to?: string): Promise<boolean> {
  const result = await sms(text, { to, agentId: 'orchestrator' })
  if (!result.ok) {
    console.error(`postSms failed: ${result.error}`)
  }
  return result.ok
}
