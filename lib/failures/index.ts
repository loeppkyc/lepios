/**
 * lib/failures/index.ts
 *
 * Public surface for the failures-log subsystem.
 *
 * Capture path (F18 evidence):
 *   - failures_log table inserts via logFailure()
 *   - agent_events rows for export runs (action='failures_log.export_markdown')
 *     and promote-to-test actions (action='failures_log.promote_to_test')
 *   - Self-repair detector writes (trigger_context='self_repair')
 *
 * Surfacing:
 *   - /failures cockpit page
 *   - docs/claude-md/failures.md (auto-rendered via night-tick)
 *   - morning_digest line (planned)
 *
 * Benchmark: <5% recurrence rate (recurring rows / total fixed) over 30 days.
 */

export { logFailure, markFixed, findMatchingFailures } from './log'
export type { LogFailureInput, LogFailureResult } from './log'

export {
  buildSignature,
  signaturesEqual,
  type FailureType,
  type PatternSignature,
  type SignatureInput,
} from './signature'

export { listFailures, type FailureListRow } from './list'

export { buildMarkdown, exportFailuresMarkdown, type ExportResult } from './export-markdown'
