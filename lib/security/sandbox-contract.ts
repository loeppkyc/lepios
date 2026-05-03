// Sandbox contract types — Slice 1 stub.
// Only SandboxScope is needed for Slice 1. checkSandboxAction() is Slice 2 (security_layer slice 6).

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
