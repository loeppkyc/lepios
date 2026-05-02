export type EnforcementMode = 'log_only' | 'warn' | 'enforce'

export type ActionType =
  | 'cap_check'
  | 'secret_read'
  | 'destructive_op'
  | 'sandbox_check'
  | 'override'

export type ActionResult = 'allowed' | 'allowed_log_only' | 'allowed_warn' | 'denied' | 'error'

export interface CapabilityCheck {
  agentId: string
  capability: string
  target?: string
  context?: {
    taskId?: string
    sessionId?: string
    sandboxId?: string
    reason?: string
    [key: string]: unknown
  }
}

export interface CapabilityResult {
  allowed: boolean
  reason: string
  enforcement_mode: EnforcementMode
  audit_id: string
}

export class CapabilityDeniedError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly capability: string,
    public readonly reason: string
  ) {
    super(`Capability denied: ${agentId} → ${capability} (${reason})`)
    this.name = 'CapabilityDeniedError'
  }
}
