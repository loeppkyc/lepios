import { httpRequest } from './http'

export interface SmsOptions {
  to?: string
  agentId?: string
}

export interface SmsResult {
  ok: boolean
  sid?: string
  error?: string
  failure_type?: 'network_error' | 'upstream_error'
}

/**
 * Send an SMS via Twilio REST API.
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER env vars.
 */
export async function sms(
  message: string,
  options: SmsOptions = {}
): Promise<SmsResult> {
  const { to, agentId = 'harness' } = options

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  const defaultTo = to ?? process.env.TWILIO_TO_NUMBER

  if (!accountSid || !authToken || !from) {
    return { ok: false, error: 'Twilio credentials (SID, Token, From) not configured' }
  }
  if (!defaultTo) {
    return { ok: false, error: 'Recipient phone number not provided and TWILIO_TO_NUMBER not set' }
  }

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const result = await httpRequest({
    url: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    method: 'POST',
    capability: 'net.outbound.twilio',
    agentId,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: from,
      To: defaultTo,
      Body: message,
    }).toString(),
  })

  if (!result.ok) {
    let errorMessage = result.error ?? `Twilio API error ${result.status}`
    try {
      const body = JSON.parse(result.body) as { message?: string }
      if (body.message) errorMessage = body.message
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: errorMessage,
      failure_type: result.status === 0 ? 'network_error' : 'upstream_error',
    }
  }

  try {
    const parsed = JSON.parse(result.body) as { sid: string }
    return { ok: true, sid: parsed.sid }
  } catch {
    return { ok: result.ok }
  }
}
