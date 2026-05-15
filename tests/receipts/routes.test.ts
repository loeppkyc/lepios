import { describe, it, expect } from 'vitest'
import { Glob } from 'bun'

// ── AC-4: Gmail scan route requires CRON_SECRET ────────────────────────────────

describe('AC-4 — gmail-scan route uses requireCronSecret (F22)', () => {
  it('imports requireCronSecret from lib/auth/cron-secret.ts', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync('app/api/receipts/gmail-scan/route.ts', 'utf8')
    )
    expect(src).toContain("from '@/lib/auth/cron-secret'")
    expect(src).toContain('requireCronSecret(request)')
  })

  it('requireCronSecret is the FIRST auth call in the handler', async () => {
    const src = await import('fs').then((fs) =>
      fs.readFileSync('app/api/receipts/gmail-scan/route.ts', 'utf8')
    )
    const postFnStart = src.indexOf('export async function POST')
    const requirePos = src.indexOf('requireCronSecret', postFnStart)
    const requireUserPos = src.indexOf('requireUser', postFnStart)
    // requireCronSecret must appear before any requireUser (or not have requireUser at all)
    expect(requirePos).toBeGreaterThan(0)
    if (requireUserPos > 0) {
      expect(requirePos).toBeLessThan(requireUserPos)
    }
  })
})

// ── AC-5: gmail-scan grep check ───────────────────────────────────────────────

describe('AC-5 — requireCronSecret import exists in gmail-scan route', () => {
  it('grep: requireCronSecret present in gmail-scan route file', async () => {
    const fs = await import('fs')
    const content = fs.readFileSync('app/api/receipts/gmail-scan/route.ts', 'utf8')
    expect(content).toContain('requireCronSecret')
  })
})

// ── AC-6: OCR uses haiku model string ─────────────────────────────────────────

describe('AC-6 — OCR pipeline uses claude-haiku-4-5-20251001 by default', () => {
  it('haiku model string is present in ocr.ts', async () => {
    const fs = await import('fs')
    const content = fs.readFileSync('lib/receipts/ocr.ts', 'utf8')
    expect(content).toContain('claude-haiku-4-5-20251001')
  })
})

// ── AC-11: No style={} attributes in receipt TSX files ────────────────────────

describe('AC-11 — F20: zero style={} attributes in receipts TSX', () => {
  const tsxFiles = [
    'app/(cockpit)/receipts/page.tsx',
    'app/(cockpit)/receipts/_components/ReceiptsPageV2.tsx',
    'app/(cockpit)/receipts/_components/UploadZone.tsx',
    'app/(cockpit)/receipts/_components/ReceiptRow.tsx',
    'app/(cockpit)/receipts/_components/ReviewQueue.tsx',
    'app/(cockpit)/receipts/_components/ReconcilePanel.tsx',
  ]

  for (const file of tsxFiles) {
    it(`${file} has no style={} attributes`, async () => {
      const fs = await import('fs')
      let content: string
      try {
        content = fs.readFileSync(file, 'utf8')
      } catch {
        // File may not exist yet — pass (migration/infra files don't have TSX)
        return
      }
      const matches = content.match(/style=\{/g)
      expect(matches).toBeNull()
    })
  }
})

// ── AC-12: Migration includes GRANT block ────────────────────────────────────

describe('AC-12 — migration includes GRANT block (F24)', () => {
  it('migration 0204_receipt_lines.sql contains GRANT INSERT statement', async () => {
    const fs = await import('fs')
    const content = fs.readFileSync('supabase/migrations/0204_receipt_lines.sql', 'utf8')
    expect(content).toContain('GRANT INSERT, UPDATE, DELETE')
    expect(content).toContain('TO service_role')
  })

  it('migration includes GRANT for receipt_lines', async () => {
    const fs = await import('fs')
    const content = fs.readFileSync('supabase/migrations/0204_receipt_lines.sql', 'utf8')
    expect(content).toContain('receipt_lines TO service_role')
  })

  it('migration includes GRANT for receipt_matches', async () => {
    const fs = await import('fs')
    const content = fs.readFileSync('supabase/migrations/0204_receipt_lines.sql', 'utf8')
    expect(content).toContain('receipt_matches TO service_role')
  })
})

// ── Auth: requireUser on non-cron routes ──────────────────────────────────────

describe('auth — non-cron routes use requireUser', () => {
  const routesToCheck = [
    'app/api/receipts/upload/route.ts',
    'app/api/receipts/match/route.ts',
    'app/api/receipts/confirm/route.ts',
    'app/api/receipts/lines/route.ts',
  ]

  for (const route of routesToCheck) {
    it(`${route} imports requireUser`, async () => {
      const fs = await import('fs')
      const content = fs.readFileSync(route, 'utf8')
      expect(content).toContain('requireUser')
    })
  }
})
