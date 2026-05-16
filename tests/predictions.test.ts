/**
 * Unit tests for /api/predictions business logic.
 * Tests the calibration gap computation and stats math — the ~20% business logic
 * from the A7 Predictive Behavioral Engine acceptance doc.
 *
 * No database calls. No API calls. Pure math tests.
 */

// ── Calibration gap computation ───────────────────────────────────────────────

type Outcome = 'correct' | 'wrong' | 'partial'

interface SettledPrediction {
  confidence: number // 1-10
  outcome: Outcome
}

/** Mirror of the calibration gap logic in /api/predictions GET and page.tsx */
function computeStats(settled: SettledPrediction[]) {
  const settledCount = settled.length
  if (settledCount === 0) {
    return {
      settled: 0,
      pct_correct: null,
      pct_wrong: null,
      pct_partial: null,
      avg_confidence: null,
      calibration_gap: null,
    }
  }

  const correctCount = settled.filter((r) => r.outcome === 'correct').length
  const wrongCount = settled.filter((r) => r.outcome === 'wrong').length
  const partialCount = settled.filter((r) => r.outcome === 'partial').length

  const pctCorrect = Math.round((correctCount / settledCount) * 1000) / 10
  const pctWrong = Math.round((wrongCount / settledCount) * 1000) / 10
  const pctPartial = Math.round((partialCount / settledCount) * 1000) / 10
  const avgConfidence =
    Math.round((settled.reduce((s, r) => s + r.confidence, 0) / settledCount) * 10) / 10

  // Calibration gap: avg confidence (as %) minus % correct
  // Confidence 7/10 = 70%, if 60% correct → gap = +10 (overconfident)
  const calibrationGap = Math.round((avgConfidence * 10 - pctCorrect) * 10) / 10

  return {
    settled: settledCount,
    pct_correct: pctCorrect,
    pct_wrong: pctWrong,
    pct_partial: pctPartial,
    avg_confidence: avgConfidence,
    calibration_gap: calibrationGap,
  }
}

/** Mirror of per-prediction delta logic in PredictionTable.tsx */
function computeDelta(confidence: number, outcome: Outcome): number {
  const accuracyPct = outcome === 'correct' ? 100 : outcome === 'wrong' ? 0 : 50
  return Math.round((confidence * 10 - accuracyPct) * 10) / 10
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function test(name: string, fn: () => void) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (err) {
    console.error(`  FAIL  ${name}`)
    console.error(`        ${err instanceof Error ? err.message : String(err)}`)
    failed++
  }
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`)
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${JSON.stringify(actual)}`)
      }
    },
    toBeCloseTo(expected: number, precision = 1) {
      const diff = Math.abs((actual as number) - expected)
      if (diff >= Math.pow(10, -precision) / 2) {
        throw new Error(`Expected ${expected} ± ${Math.pow(10, -precision) / 2} but got ${actual}`)
      }
    },
  }
}

// ── Empty state ───────────────────────────────────────────────────────────────

test('empty settled list returns all nulls', () => {
  const stats = computeStats([])
  expect(stats.settled).toBe(0)
  expect(stats.pct_correct).toBeNull()
  expect(stats.calibration_gap).toBeNull()
})

// ── All correct ───────────────────────────────────────────────────────────────

test('all correct: 100% correct, gap = confidence% - 100', () => {
  const stats = computeStats([
    { confidence: 7, outcome: 'correct' },
    { confidence: 8, outcome: 'correct' },
  ])
  expect(stats.pct_correct).toBe(100)
  expect(stats.pct_wrong).toBe(0)
  // avg confidence = 7.5, gap = 75 - 100 = -25 (underconfident — calibrated)
  expect(stats.avg_confidence).toBe(7.5)
  expect(stats.calibration_gap).toBe(-25)
})

// ── All wrong ─────────────────────────────────────────────────────────────────

test('all wrong: 0% correct, gap = confidence%', () => {
  const stats = computeStats([
    { confidence: 6, outcome: 'wrong' },
  ])
  expect(stats.pct_correct).toBe(0)
  // avg confidence = 6, gap = 60 - 0 = +60 (overconfident)
  expect(stats.calibration_gap).toBe(60)
})

// ── Mixed outcomes ────────────────────────────────────────────────────────────

test('mixed: 2 correct 1 wrong 1 partial → 50% correct', () => {
  const stats = computeStats([
    { confidence: 8, outcome: 'correct' },
    { confidence: 7, outcome: 'correct' },
    { confidence: 6, outcome: 'wrong' },
    { confidence: 5, outcome: 'partial' },
  ])
  expect(stats.settled).toBe(4)
  expect(stats.pct_correct).toBe(50)
  expect(stats.pct_wrong).toBe(25)
  expect(stats.pct_partial).toBe(25)
})

// ── Per-prediction delta ──────────────────────────────────────────────────────

test('delta: confidence 5, correct → -50% (underconfident)', () => {
  // 5 * 10 = 50%, accuracy = 100% → gap = -50
  expect(computeDelta(5, 'correct')).toBe(-50)
})

test('delta: confidence 10, wrong → +100% (severely overconfident)', () => {
  // 10 * 10 = 100%, accuracy = 0% → gap = +100
  expect(computeDelta(10, 'wrong')).toBe(100)
})

test('delta: confidence 5, partial → 0% (perfectly calibrated for partial)', () => {
  // 5 * 10 = 50%, accuracy = 50% → gap = 0
  expect(computeDelta(5, 'partial')).toBe(0)
})

test('delta: confidence 7, wrong → +70% (overconfident)', () => {
  // 7 * 10 = 70%, accuracy = 0% → gap = +70
  expect(computeDelta(7, 'wrong')).toBe(70)
})

// ── Calibration gap sign convention ──────────────────────────────────────────

test('calibration gap: positive = overconfident', () => {
  // avg confidence 9/10 = 90%, correct 50% → gap = +40
  const stats = computeStats([
    { confidence: 9, outcome: 'correct' },
    { confidence: 9, outcome: 'wrong' },
  ])
  expect(stats.calibration_gap).toBe(40)
})

test('calibration gap: negative = underconfident (good)', () => {
  // avg confidence 3/10 = 30%, correct 100% → gap = -70
  const stats = computeStats([
    { confidence: 3, outcome: 'correct' },
    { confidence: 3, outcome: 'correct' },
  ])
  expect(stats.calibration_gap).toBe(-70)
})

// ── Rounding ──────────────────────────────────────────────────────────────────

test('rounding: 1 of 3 correct → 33.3%', () => {
  const stats = computeStats([
    { confidence: 7, outcome: 'correct' },
    { confidence: 7, outcome: 'wrong' },
    { confidence: 7, outcome: 'wrong' },
  ])
  expect(stats.pct_correct).toBeCloseTo(33.3)
})

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\nPrediction calibration unit tests')
console.log(`Results: ${passed} passed, ${failed} failed\n`)

if (failed > 0) {
  process.exit(1)
}
