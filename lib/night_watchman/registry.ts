// Pluggable check registry. Checks are registered at module-eval time;
// the scanner iterates a snapshot per run.

import type { CheckDef } from './types'

const registry = new Map<string, CheckDef>()

export function registerCheck(check: CheckDef): void {
  if (registry.has(check.key)) {
    throw new Error(
      `night_watchman: duplicate check key "${check.key}". Each check must be registered once.`
    )
  }
  registry.set(check.key, check)
}

export function getRegisteredChecks(): readonly CheckDef[] {
  return Array.from(registry.values())
}

export function findCheck(key: string): CheckDef | undefined {
  return registry.get(key)
}

/** Test-only — clears registry between unit tests. Throws in production. */
export function _resetRegistryForTests(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('night_watchman: _resetRegistryForTests() must not be called in production')
  }
  registry.clear()
}
