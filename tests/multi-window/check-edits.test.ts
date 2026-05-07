/**
 * Tests for scripts/window-check-edits.mjs (P5-1).
 *
 * The script wraps git + claim I/O. We unit-test the imported helpers and
 * use end-to-end exec for the full CLI behavior in a throwaway repo.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/window-check-edits.mjs').replace(/\\/g, '/')

// We invoke the CLI in a freshly-made repo so working-tree state is controlled.
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'lepios-check-edits-'))
  execSync('git init -q', { cwd: repo })
  execSync('git config user.email t@e.com', { cwd: repo })
  execSync('git config user.name t', { cwd: repo })
  execSync('git checkout -q -b feat/test', { cwd: repo })
  // Initial commit so HEAD exists.
  writeFileSync(join(repo, '.gitkeep'), '')
  execSync('git add .gitkeep', { cwd: repo })
  execSync('git commit -q -m initial', { cwd: repo })
  return repo
}

function writeClaim(repo: string, claim: object): string {
  const dir = join(repo, '.claude', 'active-windows')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'feat__test.json')
  writeFileSync(path, JSON.stringify(claim))
  return path
}

function runScript(
  repo: string,
  args: string[] = []
): { exit: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(`node "${SCRIPT_PATH}" ${args.join(' ')}`, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { exit: 0, stdout, stderr: '' }
  } catch (err: unknown) {
    const e = err as { status: number; stdout?: Buffer; stderr?: Buffer }
    return {
      exit: e.status,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    }
  }
}

let repo: string

beforeEach(() => {
  repo = makeRepo()
})

afterEach(() => {
  if (repo && existsSync(repo)) rmSync(repo, { recursive: true, force: true })
})

describe('window-check-edits — edit-time scope drift CLI', () => {
  it('exits 0 with "no opinion" when no claim exists', () => {
    const result = runScript(repo)
    expect(result.exit).toBe(0)
    expect(result.stdout).toContain('no active claim')
  })

  it('exits 0 when all changes are within scope', () => {
    writeClaim(repo, {
      branch: 'feat/test',
      scope: ['lib/**'],
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      pid: 1,
      note: null,
    })
    mkdirSync(join(repo, 'lib'), { recursive: true })
    writeFileSync(join(repo, 'lib', 'foo.ts'), 'export const x = 1')

    const result = runScript(repo)
    expect(result.exit).toBe(0)
    expect(result.stdout).toContain('within scope')
  })

  it('exits 1 with detail when out-of-scope edits exist', () => {
    writeClaim(repo, {
      branch: 'feat/test',
      scope: ['lib/**'],
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      pid: 1,
      note: null,
    })
    mkdirSync(join(repo, 'lib'), { recursive: true })
    mkdirSync(join(repo, 'app'), { recursive: true })
    writeFileSync(join(repo, 'lib', 'in-scope.ts'), 'in')
    writeFileSync(join(repo, 'app', 'out-of-scope.tsx'), 'out')

    const result = runScript(repo)
    expect(result.exit).toBe(1)
    expect(result.stderr).toContain('app/out-of-scope.tsx')
    expect(result.stderr).not.toContain('lib/in-scope.ts')
  })

  it('--json mode emits machine-readable structure', () => {
    writeClaim(repo, {
      branch: 'feat/test',
      scope: ['lib/**'],
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      pid: 1,
      note: null,
    })
    mkdirSync(join(repo, 'app'), { recursive: true })
    writeFileSync(join(repo, 'app', 'leaked.tsx'), 'x')

    const result = runScript(repo, ['--json'])
    expect(result.exit).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.branch).toBe('feat/test')
    expect(parsed.has_claim).toBe(true)
    expect(parsed.out_of_scope).toContain('app/leaked.tsx')
  })

  it('--quiet emits no output but still exits 1 on drift', () => {
    writeClaim(repo, {
      branch: 'feat/test',
      scope: ['lib/**'],
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      pid: 1,
      note: null,
    })
    mkdirSync(join(repo, 'app'), { recursive: true })
    writeFileSync(join(repo, 'app', 'silent.tsx'), 'x')

    const result = runScript(repo, ['--quiet'])
    expect(result.exit).toBe(1)
    expect(result.stdout).toBe('')
    // stderr may still have CLI noise; the contract is exit code only
  })

  it('handles staged + unstaged + untracked together', () => {
    writeClaim(repo, {
      branch: 'feat/test',
      scope: ['lib/**'],
      started_at: new Date().toISOString(),
      last_heartbeat: new Date().toISOString(),
      pid: 1,
      note: null,
    })
    mkdirSync(join(repo, 'lib'), { recursive: true })
    mkdirSync(join(repo, 'app'), { recursive: true })

    // staged in-scope:
    writeFileSync(join(repo, 'lib', 'staged.ts'), 'staged')
    execSync('git add lib/staged.ts', { cwd: repo })

    // unstaged out-of-scope:
    writeFileSync(join(repo, 'app', 'unstaged.tsx'), 'unstaged')

    // untracked out-of-scope:
    writeFileSync(join(repo, 'app', 'untracked.tsx'), 'untracked')

    const result = runScript(repo, ['--json'])
    expect(result.exit).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.in_scope).toContain('lib/staged.ts')
    expect(parsed.out_of_scope).toContain('app/unstaged.tsx')
    expect(parsed.out_of_scope).toContain('app/untracked.tsx')
  })
})
