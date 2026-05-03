// Sandbox contract types — updated in Slice 2 to add checkSandboxAction().

import { checkCapability } from '@/lib/security/capability'
import type { CapabilityResult } from '@/lib/security/types'

export interface SandboxFsScope {
  /** Paths the sandbox cmd is expected to read/write (advisory in slice 1 — not enforced). */
  allowedPaths: string[]
  /** Paths the sandbox cmd must never touch (advisory in slice 1 — emits fs_isolation_advisory warning). */
  deniedPaths?: string[]
}

export interface SandboxNetScope {
  /** Hostnames the cmd is expected to reach (advisory in slice 1 — emits net_isolation_not_enforced warning). */
  allowedHosts?: string[]
}

/**
 * Describes the expected resource scope for a sandbox run.
 * Slice 1: scope is recorded and surfaced in warnings; no enforcement occurs.
 * Slice 2+: checkSandboxAction() uses scope to enforce capability grants.
 */
export interface SandboxScope {
  fs: SandboxFsScope
  net?: SandboxNetScope
}

export interface SandboxCheckRequest {
  agentId: string
  sandboxId: string
  capability: string
  scope: SandboxScope
}

export class SandboxDeniedError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly capability: string,
    public readonly reason: string,
    public readonly auditId: string
  ) {
    super(`Sandbox denied: ${agentId} → ${capability} (${reason})`)
    this.name = 'SandboxDeniedError'
  }
}

export async function checkSandboxAction(req: SandboxCheckRequest): Promise<CapabilityResult> {
  return checkCapability({
    agentId: req.agentId,
    capability: req.capability,
    target: req.sandboxId,
    context: { sandboxId: req.sandboxId },
  })
}
