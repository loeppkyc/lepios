// Message templates for night-watchman → daily-bot.
// Plain text (no Markdown) so we don't have to escape every dynamic value.

import type { CheckResult, ScanReport } from '@/lib/night_watchman/types'

const ICON: Record<string, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  blue: '🔵',
}

/** Format a Date in America/Edmonton local short-hand. */
function fmtLocal(d: Date = new Date()): string {
  // Manual MT formatter — server may not have Intl tzdata.
  const offset = isMTSummer(d) ? -6 : -7 // MDT = UTC-6, MST = UTC-7
  const local = new Date(d.getTime() + offset * 60 * 60 * 1000)
  const hh = String(local.getUTCHours()).padStart(2, '0')
  const mm = String(local.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm} MT`
}

/** Heuristic DST window — second Sunday in March to first Sunday in November. */
function isMTSummer(d: Date): boolean {
  const m = d.getUTCMonth() // 0-indexed
  if (m > 2 && m < 10) return true
  if (m < 2 || m > 10) return false
  // March or November — approximate; off by a few days at the boundary is acceptable.
  return m === 2
}

// ─── Heartbeat (sleep-window all-clear) ──────────────────────────────────────
export function renderHeartbeat(args: {
  scanCompletedAt: Date
  totalChecks: number
  okCount: number
  autoRepairs: number
  autoRepairSummary?: string // e.g. "1 cron retry"
  qualityScore?: number | null
}): string {
  const score = args.qualityScore != null ? `score=${args.qualityScore}.` : ''
  const repairs =
    args.autoRepairs > 0
      ? ` ${args.autoRepairs} auto-repair${args.autoRepairs === 1 ? '' : 's'}: ${args.autoRepairSummary ?? '(unspecified)'}.`
      : ''
  return `${ICON.green} ${fmtLocal(args.scanCompletedAt)}. All clear. ${score}${repairs} ${args.totalChecks} checks (${args.okCount} ok). No incidents.`
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Auto-repaired incident ──────────────────────────────────────────────────
export function renderAutoRepaired(args: {
  at: Date
  checkKey: string
  description: string // e.g. "Stuck task_queue job 8472"
  repairs: number
}): string {
  return `${ICON.yellow} ${fmtLocal(args.at)}. ${args.description} — auto-repaired in ${args.repairs} retry${args.repairs === 1 ? '' : 's'}. Clear.`
}

// ─── Human-required alert ────────────────────────────────────────────────────
export function renderHumanRequiredAlert(result: CheckResult, reason: string): string {
  const at = fmtLocal()
  const sev = result.severity ? ` (${result.severity})` : ''
  const lastWorking = (result.evidence.last_working as string | undefined) ?? null
  const diagnostic = (result.evidence.diagnostic_url as string | undefined) ?? null
  const lines = [
    `${ICON.red} ${at}. ${result.key}${sev} — ${reason}.`,
    diagnostic ? `Diagnostic: ${diagnostic}` : null,
    lastWorking ? `Last working: ${lastWorking}` : null,
  ].filter(Boolean)
  return lines.join(' ')
}

// ─── Daily roll-up (07:30 MT) ────────────────────────────────────────────────
export function renderDailyRollup(args: {
  scans: number
  totalRepairs: number
  totalIncidents: number
  scoreDelta: number | null // change vs previous day
  topGap?: string | null
  recentSummary: string[] // ≤ 5 short lines
}): string {
  const at = fmtLocal()
  const delta =
    args.scoreDelta != null
      ? `score Δ${args.scoreDelta >= 0 ? '+' : ''}${args.scoreDelta}`
      : 'score Δ–'
  const head = `${ICON.blue} ${at} — overnight roll-up. ${args.scans} scans, ${args.totalRepairs} repairs, ${args.totalIncidents} incidents, ${delta}.`
  const top = args.topGap ? `Top gap: ${args.topGap}.` : ''
  const tail = args.recentSummary.slice(0, 5).join('\n• ')
  return [head, top, tail ? `• ${tail}` : ''].filter(Boolean).join('\n')
}

// ─── Halt notification ────────────────────────────────────────────────────────
export function renderHaltNotice(reason: string): string {
  return `${ICON.red} ${fmtLocal()} — SELF_REPAIR_HALTED engaged. ${reason}. Manual ack required to resume.`
}

// ─── Resume notification ──────────────────────────────────────────────────────
export function renderResumeNotice(): string {
  return `${ICON.green} ${fmtLocal()} — SELF_REPAIR_HALTED cleared. Scanner resumes next tick.`
}

/** Per-scan summary used in dry-run output and morning roll-up. */
export function summarizeScan(report: ScanReport): string {
  const at = fmtLocal(new Date(report.startedAt))
  const status =
    report.totalEscalations > 0 ? ICON.red : report.totalRepairs > 0 ? ICON.yellow : ICON.green
  return `${status} ${at} scope=${report.scope} checks=${report.totalChecks} repairs=${report.totalRepairs} incidents=${report.totalIncidents} escalations=${report.totalEscalations}${report.halted ? ' [HALTED]' : ''}`
}
