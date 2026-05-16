// Circuit breaker for external API calls — Facebook resilience model.
// Sections can fail; the whole system never goes down.
// State is stored in harness_config so it survives restarts and is visible to all processes.
// For in-process use (no Supabase available), use the in-memory breaker returned by createBreaker().

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface BreakerConfig {
  name: string
  failureThreshold?: number   // failures before OPEN (default: 3)
  successThreshold?: number   // successes in HALF_OPEN to close (default: 1)
  timeoutMs?: number          // ms to wait before trying HALF_OPEN (default: 60_000)
}

interface BreakerData {
  state: BreakerState
  failures: number
  successes: number
  openedAt: number | null
}

const registry = new Map<string, BreakerData>()

function get(name: string): BreakerData {
  if (!registry.has(name)) {
    registry.set(name, { state: 'CLOSED', failures: 0, successes: 0, openedAt: null })
  }
  return registry.get(name)!
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker OPEN: ${name}`)
    this.name = 'CircuitOpenError'
  }
}

export function createBreaker(config: BreakerConfig) {
  const failureThreshold = config.failureThreshold ?? 3
  const successThreshold = config.successThreshold ?? 1
  const timeoutMs = config.timeoutMs ?? 60_000

  async function call<T>(fn: () => Promise<T>): Promise<T> {
    const data = get(config.name)

    if (data.state === 'OPEN') {
      const elapsed = Date.now() - (data.openedAt ?? 0)
      if (elapsed >= timeoutMs) {
        data.state = 'HALF_OPEN'
        data.successes = 0
      } else {
        throw new CircuitOpenError(config.name)
      }
    }

    try {
      const result = await fn()
      onSuccess(data)
      return result
    } catch (err) {
      onFailure(data)
      throw err
    }
  }

  function onSuccess(data: BreakerData) {
    if (data.state === 'HALF_OPEN') {
      data.successes++
      if (data.successes >= successThreshold) {
        data.state = 'CLOSED'
        data.failures = 0
        data.successes = 0
        data.openedAt = null
      }
    } else {
      data.failures = 0
    }
  }

  function onFailure(data: BreakerData) {
    data.failures++
    if (data.state === 'HALF_OPEN' || data.failures >= failureThreshold) {
      data.state = 'OPEN'
      data.openedAt = Date.now()
    }
  }

  function getState(): BreakerState {
    return get(config.name).state
  }

  function reset() {
    registry.set(config.name, { state: 'CLOSED', failures: 0, successes: 0, openedAt: null })
  }

  return { call, getState, reset }
}

// Named breakers for LepiOS external dependencies
export const keepaBreaker = createBreaker({ name: 'keepa', failureThreshold: 3, timeoutMs: 120_000 })
export const spApiBreaker = createBreaker({ name: 'sp-api', failureThreshold: 5, timeoutMs: 60_000 })
export const qboBreaker = createBreaker({ name: 'qbo', failureThreshold: 3, timeoutMs: 300_000 })
export const dropboxBreaker = createBreaker({ name: 'dropbox', failureThreshold: 3, timeoutMs: 60_000 })
export const telegramBreaker = createBreaker({ name: 'telegram', failureThreshold: 5, timeoutMs: 30_000 })

// Health snapshot — used by /api/health to surface breaker states
export function getBreakerHealth(): Record<string, BreakerState> {
  return Object.fromEntries([...registry.entries()].map(([k, v]) => [k, v.state]))
}
