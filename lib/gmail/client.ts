// Server-side only — never import from client components.
// Auth: OAuth2 refresh_token flow via googleapis npm package.
import { google } from 'googleapis'
import type { gmail_v1 } from 'googleapis'
import { getSecret } from '@/lib/security/secrets'

export class GmailNotConfiguredError extends Error {
  constructor() {
    super('Gmail env vars not set: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN')
    this.name = 'GmailNotConfiguredError'
  }
}

/**
 * Returns an authenticated Gmail v1 service client.
 * Reads GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN from process.env.
 * Throws GmailNotConfiguredError if any of the three are missing or empty after trim.
 */
export async function createGmailService(): Promise<gmail_v1.Gmail> {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim()
  // getSecret provides capability audit trail; falls back to process.env on DB unavailability
  const clientSecret = (
    (await getSecret('GOOGLE_CLIENT_SECRET', { agentId: 'system' }).catch(
      () => process.env.GOOGLE_CLIENT_SECRET
    )) ?? ''
  ).trim()
  const refreshToken = (
    (await getSecret('GOOGLE_REFRESH_TOKEN', { agentId: 'system' }).catch(
      () => process.env.GOOGLE_REFRESH_TOKEN
    )) ?? ''
  ).trim()

  if (!clientId || !clientSecret || !refreshToken) {
    throw new GmailNotConfiguredError()
  }

  const oauthClient = new google.auth.OAuth2(clientId, clientSecret)
  oauthClient.setCredentials({ refresh_token: refreshToken })

  return google.gmail({ version: 'v1', auth: oauthClient })
}
