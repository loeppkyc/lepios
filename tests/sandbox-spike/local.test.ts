/**
 * Sandbox Slice 0 — local process.kill(-pgid) test.
 *
 * Runs the spawn+kill sequence in-process and asserts the kill works on the
 * test environment. On Windows (non-WSL) this test is expected to fail —
 * record that result in the spike report and proceed to the Vercel test.
 */

import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('sandbox spike — process.kill(-pgid)', () => {
  it(
    'spawns bash -c "sleep 60" detached and kills the process group',
    { timeout: 10_000 },
    async () => {
      // Skip on Windows where process groups are unsupported.
      if (process.platform === 'win32') {
        console.log(
          'SKIP: process.kill(-pgid) is not supported on win32 — record as "fails (Windows native)" in spike report'
        )
        return
      }

      const child = spawn('bash', ['-c', 'sleep 60'], {
        detached: true,
        stdio: 'pipe',
      })

      expect(child.pid).toBeDefined()
      const pid = child.pid!
      const pgid = pid

      await sleep(200)

      // Kill the process group.
      let killThrew = false
      try {
        process.kill(-pgid, 'SIGTERM')
      } catch {
        killThrew = true
      }

      expect(killThrew).toBe(false)

      // Verify dead within 2 seconds.
      const deadline = Date.now() + 2000
      let dead = false

      while (Date.now() < deadline) {
        await sleep(100)
        try {
          process.kill(-pgid, 0)
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
            dead = true
            break
          }
        }
      }

      if (!dead) {
        // Clean up before failing.
        try {
          process.kill(-pgid, 'SIGKILL')
        } catch {
          // ignore
        }
      }

      expect(dead).toBe(true)
    },
    { timeout: 10_000 }
  )
})
