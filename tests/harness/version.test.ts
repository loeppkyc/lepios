import { describe, expect, it } from 'vitest'
import { HARNESS_VERSION } from '@/lib/harness/version'

describe('HARNESS_VERSION', () => {
  it('is 0.1.0', () => {
    expect(HARNESS_VERSION).toBe('0.1.0')
  })
})
