/**
 * Monotonic timer helper — exposed so tests can mock it without touching
 * the entire runtime module.
 */
export function monotonicNow(): number {
  return Date.now()
}
