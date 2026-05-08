/**
 * Unit tests for lib/harness/safety/v2/signals/secret.ts.
 *
 * Calibration: any token leak in additions → SAFETY_WEIGHT_SECRET_DETECTED.
 * Per Q-003 the scorer's default for this key is +100 = automatic high tier.
 */

import { describe, it, expect } from 'vitest'
import { detectSecrets } from '@/lib/harness/safety/v2/signals/secret'
import type { PRDiffInput } from '@/lib/harness/safety/v2/types'

function makeInput(diff: string, files: string[] = ['lib/x.ts']): PRDiffInput {
  return {
    unified_diff: diff,
    files_changed: files,
    loc_added: 1,
    loc_removed: 0,
    migration_files: [],
  }
}

// Construct token-shaped fixtures at runtime so GitHub's static secret scanner
// (and other scanners) never sees a literal sk_live_/sk_test_/whsec_/sb_secret_
// string in source. These tokens are designed only to satisfy the regex —
// they are not real keys (and never were).
const FAKE = {
  awsKey: 'AKIA' + 'X'.repeat(16),
  stripeLive: ['sk', 'live', 'X'.repeat(24)].join('_'),
  stripeTest: ['sk', 'test', 'X'.repeat(24)].join('_'),
  stripeWh: ['whsec', 'X'.repeat(24)].join('_'),
  supabaseSvc: ['sb', 'secret', 'X'.repeat(24)].join('_'),
  jwt: 'ey' + 'J' + 'X'.repeat(35) + '.' + 'ey' + 'J' + 'Y'.repeat(13) + '.' + 'Z'.repeat(15),
  pgConn: 'postgres://user:p4ssw0rd@host:5432/db',
  hex: 'a1b2c3d4e5f6'.repeat(8) + 'abcd',
}

describe('detectSecrets — positive cases (each pattern fires)', () => {
  it('flags AWS access key', () => {
    const diff = `+++ b/lib/x.ts\n+const k = "${FAKE.awsKey}"`
    const out = detectSecrets(makeInput(diff))
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('aws_access_key')
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_SECRET_DETECTED')
  })

  it('flags Stripe live key', () => {
    const diff = `+++ b/lib/x.ts\n+const k = "${FAKE.stripeLive}"`
    expect(detectSecrets(makeInput(diff))[0].id).toBe('stripe_live_key')
  })

  it('flags Stripe test key', () => {
    const diff = `+++ b/lib/x.ts\n+const k = "${FAKE.stripeTest}"`
    expect(detectSecrets(makeInput(diff))[0].id).toBe('stripe_test_key')
  })

  it('flags Stripe webhook secret', () => {
    const diff = `+++ b/lib/x.ts\n+const k = "${FAKE.stripeWh}"`
    expect(detectSecrets(makeInput(diff))[0].id).toBe('stripe_webhook_secret')
  })

  it('flags Supabase service key', () => {
    const diff = `+++ b/lib/x.ts\n+const k = "${FAKE.supabaseSvc}"`
    expect(detectSecrets(makeInput(diff))[0].id).toBe('supabase_service_key')
  })

  it('flags JWT token', () => {
    const diff = `+++ b/lib/x.ts\n+const k = "${FAKE.jwt}"`
    expect(detectSecrets(makeInput(diff))[0].id).toBe('jwt_token')
  })

  it('flags DB connection string', () => {
    const diff = `+++ b/lib/x.ts\n+const u = "${FAKE.pgConn}"`
    expect(detectSecrets(makeInput(diff))[0].id).toBe('db_connection_string')
  })

  it('flags long hex secret in assignment', () => {
    const diff = `+++ b/lib/x.ts\n+const SECRET = "${FAKE.hex}"`
    expect(detectSecrets(makeInput(diff))[0].id).toBe('hex_secret')
  })
})

describe('detectSecrets — negative cases (no false positives)', () => {
  it('ignores process.env reference', () => {
    const diff = '+++ b/lib/x.ts\n+const k = process.env.STRIPE_LIVE_KEY'
    expect(detectSecrets(makeInput(diff))).toHaveLength(0)
  })

  it('ignores commented-out token', () => {
    const diff = `+++ b/lib/x.ts\n+// const k = "${FAKE.awsKey}"`
    expect(detectSecrets(makeInput(diff))).toHaveLength(0)
  })

  it('ignores .env file additions', () => {
    const diff = `+++ b/.env.local\n+STRIPE_LIVE_KEY=${FAKE.stripeLive}`
    expect(detectSecrets(makeInput(diff, ['.env.local']))).toHaveLength(0)
  })

  it('ignores removals (lines starting with -)', () => {
    const diff = `+++ b/lib/x.ts\n-const k = "${FAKE.awsKey}"`
    expect(detectSecrets(makeInput(diff))).toHaveLength(0)
  })

  it('ignores diff header lines (+++ b/path)', () => {
    const diff = `+++ b/${FAKE.awsKey}.ts`
    expect(detectSecrets(makeInput(diff))).toHaveLength(0)
  })

  it('does not flag short hex strings', () => {
    const diff = '+++ b/lib/x.ts\n+const id = "deadbeef1234"'
    expect(detectSecrets(makeInput(diff))).toHaveLength(0)
  })
})

describe('detectSecrets — dedup + masking', () => {
  it('deduplicates same pattern in same file', () => {
    const diff = [
      '+++ b/lib/x.ts',
      `+const k1 = "${FAKE.awsKey}"`,
      `+const k2 = "${FAKE.awsKey}"`,
    ].join('\n')
    expect(detectSecrets(makeInput(diff))).toHaveLength(1)
  })

  it('separate findings for different files', () => {
    const diff = [
      '+++ b/lib/a.ts',
      `+const k = "${FAKE.awsKey}"`,
      '+++ b/lib/b.ts',
      `+const k = "${FAKE.awsKey}"`,
    ].join('\n')
    expect(detectSecrets(makeInput(diff))).toHaveLength(2)
  })

  it('masks evidence so transcript does not echo the full secret', () => {
    const diff = `+++ b/lib/x.ts\n+const k = "${FAKE.awsKey}"`
    const out = detectSecrets(makeInput(diff))
    // Evidence must include the file path and a masked value (no full token).
    expect(out[0].evidence).toContain('lib/x.ts')
    expect(out[0].evidence).not.toContain(FAKE.awsKey)
    expect(out[0].evidence).toContain('…')
  })
})
