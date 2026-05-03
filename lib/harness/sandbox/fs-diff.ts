import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface FsDiffResult {
  filesChanged: string[]
  diffStat: { insertions: number; deletions: number; files: number }
  diffHash: string
}

/**
 * Captures filesystem changes made inside a git worktree since baseSha.
 *
 * Uses git diff to capture:
 *   - tracked file changes (modified, deleted)
 *   - untracked files (new files not yet staged)
 *
 * baseSha is used as the diff base rather than HEAD so that git commits made
 * inside the cmd are still captured.
 *
 * LANG=C override ensures locale-safe output parsing.
 */
export async function captureFsDiff(worktreePath: string, baseSha: string): Promise<FsDiffResult> {
  const execOpts = { cwd: worktreePath, env: { ...process.env, LANG: 'C' } }

  // Tracked changes: modified + deleted files
  let trackedFiles: string[] = []
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', baseSha, 'HEAD'],
      execOpts
    )
    trackedFiles = stdout
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)
  } catch {
    // If HEAD === baseSha (no commits), git diff returns empty — not an error
    trackedFiles = []
  }

  // Untracked (new) files
  let untrackedFiles: string[] = []
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      execOpts
    )
    untrackedFiles = stdout
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)
  } catch {
    untrackedFiles = []
  }

  const filesChanged = [...new Set([...trackedFiles, ...untrackedFiles])]

  // Diff stat — insertions/deletions from tracked changes
  let insertions = 0
  let deletions = 0
  let statFiles = 0
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--stat', baseSha, 'HEAD'], execOpts)
    // Parse the summary line: "N files changed, X insertions(+), Y deletions(-)"
    const summaryMatch = stdout.match(
      /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?)?(?:,\s+(\d+)\s+deletions?)?/
    )
    if (summaryMatch) {
      statFiles = parseInt(summaryMatch[1] ?? '0', 10)
      insertions = parseInt(summaryMatch[2] ?? '0', 10)
      deletions = parseInt(summaryMatch[3] ?? '0', 10)
    }
  } catch {
    // No tracked changes — stat stays 0
  }

  // Include untracked in file count
  const totalFiles = Math.max(statFiles, filesChanged.length)

  // Diff hash — sha256 of the unified diff (stable for identical commands)
  let diffHash = ''
  try {
    const { stdout } = await execFileAsync('git', ['diff', baseSha, 'HEAD'], execOpts)
    // Include untracked file names in hash for stability
    const hashInput = stdout + '\n' + untrackedFiles.sort().join('\n')
    diffHash = createHash('sha256').update(hashInput).digest('hex')
  } catch {
    // No diff content — hash of empty string
    diffHash = createHash('sha256').update('').digest('hex')
  }

  return {
    filesChanged,
    diffStat: { insertions, deletions, files: totalFiles },
    diffHash,
  }
}
