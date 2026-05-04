// Server-side only — never import from client components.
// Auth: reuses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN (same OAuth2 app as Gmail).
import { google } from 'googleapis'

// Colin's main OS spreadsheet — Personal Expenses, Monthly P&L, Goal Tracking, etc.
const OS_SPREADSHEET_ID = '1arXxho2gD8IeWbQNcOt8IwZ7DRl2wz-qJzC3J4hiR4k'

function getAuth() {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? '').trim()
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? '').trim()
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN ?? '').trim()
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google credentials not configured: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN'
    )
  }
  const oauthClient = new google.auth.OAuth2(clientId, clientSecret)
  oauthClient.setCredentials({ refresh_token: refreshToken })
  return oauthClient
}

/** Read a named tab from the OS spreadsheet. Returns rows as string[][] (first row = headers). */
export async function readOsSheet(sheetName: string, maxRows = 500): Promise<string[][]> {
  const auth = getAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: OS_SPREADSHEET_ID,
    range: `'${sheetName}'!A1:AZ${maxRows}`,
  })
  return (response.data.values ?? []) as string[][]
}

/** Parse dollar strings like "$1,234.56", "-$1,234.56", "(1,234.56)", "$-", "" → number */
export function parseDollar(val: string | undefined): number {
  if (!val || val === '$-' || val === '-' || val.trim() === '') return 0
  const s = val.trim()
  const negative = s.startsWith('-') || s.startsWith('(')
  const cleaned = s.replace(/[^0-9.]/g, '')
  if (!cleaned) return 0
  const n = parseFloat(cleaned)
  return negative ? -n : n
}
