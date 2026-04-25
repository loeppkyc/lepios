/**
 * lib/work-budget — re-exports
 */

export { parseBudgetCommand, handleBudgetCommand, runSelfGeneratedWorkPipeline } from './parser'
export type { ParsedBudget } from './parser'

export { estimateTask, readKeywordWeights, extractKeywordsAndScore } from './estimator'
export type { EstimateInput, EstimateResult } from './estimator'

export {
  getActiveSession,
  canClaimNextTask,
  incrementBudgetUsedMinutes,
  drainSession,
  stopSession,
  sendDrainSummary,
  buildDrainSummary,
  buildStatusMessage,
  MIN_CLAIMABLE_MINUTES,
} from './tracker'
export type { WorkBudgetSession } from './tracker'

export { runCalibration } from './calibrator'
