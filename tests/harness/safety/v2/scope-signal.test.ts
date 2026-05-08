/**
 * Unit tests for lib/harness/safety/v2/signals/scope.ts.
 *
 * Three sub-signals: LOC delta vs plan_loc, shared seam touch, net-new API route.
 */

import { describe, it, expect } from 'vitest'
import { detectScope } from '@/lib/harness/safety/v2/signals/scope'
import type { PRDiffInput } from '@/lib/harness/safety/v2/types'

function makeInput(overrides: Partial<PRDiffInput>): PRDiffInput {
  return {
    unified_diff: '',
    files_changed: [],
    loc_added: 0,
    loc_removed: 0,
    migration_files: [],
    new_files: [],
    plan_loc: null,
    ...overrides,
  }
}

describe('detectScope — LOC delta vs plan_loc', () => {
  it('flags LOC > 2× plan', () => {
    const out = detectScope(makeInput({ loc_added: 250, plan_loc: 100 }))
    expect(out.find((f) => f.id === 'loc_delta_2x')).toBeDefined()
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_LOC_DELTA_2X')
    expect(out[0].evidence).toContain('250')
    expect(out[0].evidence).toContain('100')
  })

  it('does not flag LOC == 2× plan', () => {
    const out = detectScope(makeInput({ loc_added: 200, plan_loc: 100 }))
    expect(out.find((f) => f.id === 'loc_delta_2x')).toBeUndefined()
  })

  it('does not flag LOC < 2× plan', () => {
    const out = detectScope(makeInput({ loc_added: 150, plan_loc: 100 }))
    expect(out.find((f) => f.id === 'loc_delta_2x')).toBeUndefined()
  })

  it('does not flag when plan_loc is null', () => {
    const out = detectScope(makeInput({ loc_added: 1000, plan_loc: null }))
    expect(out.find((f) => f.id === 'loc_delta_2x')).toBeUndefined()
  })

  it('does not flag when plan_loc is 0', () => {
    const out = detectScope(makeInput({ loc_added: 1000, plan_loc: 0 }))
    expect(out.find((f) => f.id === 'loc_delta_2x')).toBeUndefined()
  })
})

describe('detectScope — shared-seam touch', () => {
  it('flags package.json', () => {
    const out = detectScope(makeInput({ files_changed: ['package.json'] }))
    expect(out.find((f) => f.name.includes('package.json'))).toBeDefined()
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_SHARED_SEAM_TOUCH')
  })

  it('flags middleware.ts', () => {
    const out = detectScope(makeInput({ files_changed: ['middleware.ts'] }))
    expect(out.find((f) => f.name.includes('middleware.ts'))).toBeDefined()
  })

  it('flags tsconfig.json', () => {
    const out = detectScope(makeInput({ files_changed: ['tsconfig.json'] }))
    expect(out.find((f) => f.name.includes('tsconfig.json'))).toBeDefined()
  })

  it('flags multiple seams independently', () => {
    const out = detectScope(makeInput({ files_changed: ['package.json', 'tailwind.config.ts'] }))
    expect(out.filter((f) => f.weight_key === 'SAFETY_WEIGHT_SHARED_SEAM_TOUCH').length).toBe(2)
  })

  it('does not flag non-seam files', () => {
    const out = detectScope(makeInput({ files_changed: ['lib/x.ts', 'app/page.tsx'] }))
    expect(out.filter((f) => f.weight_key === 'SAFETY_WEIGHT_SHARED_SEAM_TOUCH')).toHaveLength(0)
  })

  it('does not flag a file that just contains the seam name as a substring', () => {
    const out = detectScope(makeInput({ files_changed: ['docs/about-package.json.md'] }))
    expect(out.filter((f) => f.weight_key === 'SAFETY_WEIGHT_SHARED_SEAM_TOUCH')).toHaveLength(0)
  })
})

describe('detectScope — net-new API route', () => {
  it('flags new app/api/.../route.ts', () => {
    const out = detectScope(
      makeInput({
        files_changed: ['app/api/foo/route.ts'],
        new_files: ['app/api/foo/route.ts'],
      })
    )
    expect(out.find((f) => f.name.includes('app/api/foo/route.ts'))).toBeDefined()
    expect(out[0].weight_key).toBe('SAFETY_WEIGHT_API_ROUTE_NETNEW')
  })

  it('flags new app/api/.../[id]/route.tsx', () => {
    const out = detectScope(
      makeInput({
        files_changed: ['app/api/x/[id]/route.tsx'],
        new_files: ['app/api/x/[id]/route.tsx'],
      })
    )
    expect(out.find((f) => f.weight_key === 'SAFETY_WEIGHT_API_ROUTE_NETNEW')).toBeDefined()
  })

  it('does not flag a modification to an existing route', () => {
    const out = detectScope(
      makeInput({
        files_changed: ['app/api/foo/route.ts'],
        new_files: [], // not in new_files = existing route modified
      })
    )
    expect(out.find((f) => f.weight_key === 'SAFETY_WEIGHT_API_ROUTE_NETNEW')).toBeUndefined()
  })

  it('does not flag non-route file under app/api/', () => {
    const out = detectScope(
      makeInput({
        files_changed: ['app/api/foo/helpers.ts'],
        new_files: ['app/api/foo/helpers.ts'],
      })
    )
    expect(out.find((f) => f.weight_key === 'SAFETY_WEIGHT_API_ROUTE_NETNEW')).toBeUndefined()
  })
})

describe('detectScope — combined ordering', () => {
  it('preserves order: LOC, seams, API routes', () => {
    const out = detectScope(
      makeInput({
        loc_added: 300,
        plan_loc: 100,
        files_changed: ['package.json', 'app/api/foo/route.ts'],
        new_files: ['app/api/foo/route.ts'],
      })
    )
    expect(out[0].id).toBe('loc_delta_2x')
    expect(out[1].weight_key).toBe('SAFETY_WEIGHT_SHARED_SEAM_TOUCH')
    expect(out[2].weight_key).toBe('SAFETY_WEIGHT_API_ROUTE_NETNEW')
  })

  it('clean PR returns no findings', () => {
    const out = detectScope(
      makeInput({
        loc_added: 50,
        plan_loc: 100,
        files_changed: ['lib/x.ts'],
        new_files: ['lib/x.ts'],
      })
    )
    expect(out).toHaveLength(0)
  })
})
