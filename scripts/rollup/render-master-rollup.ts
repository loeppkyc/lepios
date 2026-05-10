import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RollupReport } from './types'

const DOC_PATH = join(process.cwd(), 'docs/standing/master-rollup.md')
const FENCE_START = '<!-- AUTO-ROLLUP:START -->'
const FENCE_END = '<!-- AUTO-ROLLUP:END -->'

function fmtEdmonton(isoUtc: string): string {
  // Edmonton = America/Edmonton = UTC-6 (MDT) or UTC-7 (MST)
  const d = new Date(isoUtc)
  const offsetMs = 6 * 60 * 60 * 1000 // MDT (UTC-6); adjust to -7 in winter if needed
  const local = new Date(d.getTime() - offsetMs)
  return local.toISOString().slice(0, 16).replace('T', ' ') + ' MT'
}

function renderFencedBlock(report: RollupReport): string {
  const { strategic_pct, delta_vs_prev, tracks, computed_at } = report
  const deltaStr =
    delta_vs_prev !== null
      ? delta_vs_prev >= 0
        ? ` ↑ +${delta_vs_prev.toFixed(1)} pts vs prev run`
        : ` ↓ ${delta_vs_prev.toFixed(1)} pts vs prev run`
      : ' (first run)'

  const t = (id: string) => tracks.find((tr) => tr.track === id)

  const trackLine = (id: string): string => {
    const tr = t(id)
    if (!tr) return ''
    const undercount = tr.known_undercount ? ' ⚠ undercount' : ''
    const stale = tr.source_stale
      ? tr.source_last_updated
        ? ` (doc stale — last updated ${tr.source_last_updated})`
        : ' (doc stale)'
      : ''
    const err = tr.error ? ` [ERROR: ${tr.error}]` : ''
    return `| **${tr.label}** | **${tr.rollup_pct.toFixed(1)}%** | ${tr.strategic_weight_pct}% | ${tr.source}${undercount}${stale}${err} |`
  }

  const t2 = t('t2')
  const t2Note =
    t2?.source_stale && t2?.source_last_updated
      ? `\n> T2 Amazon Pipeline: doc-sourced, last human-updated ${t2.source_last_updated}. Does not auto-update — edit \`docs/lepios/amazon-pipeline-rollup.md\` to reflect new PRs.`
      : ''

  const t4 = t('t4')
  const t4Note = t4?.known_undercount
    ? `\n> T4 Streamlit Port: tier-weighted, known undercount until \`feat/streamlit-modules-lock\` lands port_status sync. PageProfit and other live branches not yet reflected.`
    : ''

  return `${FENCE_START}
<!-- Regenerated automatically by /api/admin/rollup/refresh — do not edit between fences -->
<!-- Last run: ${fmtEdmonton(computed_at)} (${computed_at}) -->

## Portfolio Rollup

| Track | Rollup | Weight | Source |
|-------|--------|--------|--------|
${trackLine('t1')}
${trackLine('t1b')}
${trackLine('t2')}
${trackLine('t3')}
${trackLine('t4')}
${trackLine('t5')}

**Strategic rollup: ${strategic_pct.toFixed(1)}%**${deltaStr}

Strategic math: ${tracks
    .filter((tr) => !tr.error)
    .map(
      (tr) =>
        `T${tr.track.replace('t', '')} ${tr.strategic_weight_pct}%×${tr.rollup_pct.toFixed(1)}=${((tr.strategic_weight_pct * tr.rollup_pct) / 100).toFixed(2)}`
    )
    .join(' · ')} · **sum=${strategic_pct.toFixed(2)}**
${t2Note}${t4Note}
${FENCE_END}`
}

export function patchMasterRollup(report: RollupReport): {
  patched: boolean
  error: string | null
} {
  try {
    const original = readFileSync(DOC_PATH, 'utf-8')
    const startIdx = original.indexOf(FENCE_START)
    const endIdx = original.indexOf(FENCE_END)

    if (startIdx === -1 || endIdx === -1) {
      return {
        patched: false,
        error: `Fence markers not found in ${DOC_PATH}. Add <!-- AUTO-ROLLUP:START --> and <!-- AUTO-ROLLUP:END --> to master-rollup.md first.`,
      }
    }

    const before = original.slice(0, startIdx)
    const after = original.slice(endIdx + FENCE_END.length)
    const patched = before + renderFencedBlock(report) + after

    writeFileSync(DOC_PATH, patched, 'utf-8')
    return { patched: true, error: null }
  } catch (err) {
    return {
      patched: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
