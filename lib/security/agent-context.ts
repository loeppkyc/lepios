import { AsyncLocalStorage } from 'async_hooks'

const storage = new AsyncLocalStorage<{ agentId: string }>()

/**
 * Wraps fn in an agent context so downstream getSecret() calls can
 * infer the calling agent without explicit agentId threading.
 */
export function runWithAgentContext<T>(agentId: string, fn: () => T): T {
  return storage.run({ agentId }, fn)
}

/** Returns the agentId set by the nearest enclosing runWithAgentContext, or undefined. */
export function currentAgentId(): string | undefined {
  return storage.getStore()?.agentId
}
