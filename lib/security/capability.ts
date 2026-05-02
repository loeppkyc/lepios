import { createServiceClient } from '@/lib/supabase/service'
import { logAgentAction } from './audit'
import { CapabilityDeniedError } from './types'
import type { CapabilityCheck, CapabilityResult, EnforcementMode } from './types'
export { CapabilityDeniedError } from './types'
export type { CapabilityCheck, CapabilityResult, EnforcementMode } from './types'

interface RegistryRow {
  capability: string
  default_enforcement: EnforcementMode
}

interface GrantRow {
  capability: string
  enforcement_mode: EnforcementMode
  target_pattern: string | null
}

// Exact match first, then wildcard: grant 'db.read.*' matches 'db.read.knowledge'
// but only one segment deep — 'db.*' does NOT match 'db.read.knowledge'.
function findGrant(
  grants: GrantRow[],
  capability: string
): { grant: GrantRow; isWildcard: boolean } | null {
  const exact = grants.find((g) => g.capability === capability)
  if (exact) return { grant: exact, isWildcard: false }

  const capParts = capability.split('.')
  for (const g of grants) {
    if (!g.capability.endsWith('.*')) continue
    const prefix = g.capability.slice(0, -2)
    const prefixParts = prefix.split('.')
    if (
      capParts.length === prefixParts.length + 1 &&
      prefixParts.every((p, i) => p === capParts[i])
    ) {
      return { grant: g, isWildcard: true }
    }
  }

  return null
}

// Internal: evaluate a capability check and return the result + whether to throw.
// Called by all public variants so the logic lives in one place.
async function evaluate(
  check: CapabilityCheck
): Promise<{ result: CapabilityResult; shouldThrow: boolean }> {
  const db = createServiceClient()

  // Step 1: verify capability is in the registry
  const { data: regRow } = (await db
    .from('capability_registry')
    .select('capability, default_enforcement')
    .eq('capability', check.capability)
    .maybeSingle()) as { data: RegistryRow | null; error: unknown }

  if (!regRow) {
    const audit_id = await logAgentAction({
      agentId: check.agentId,
      capability: check.capability,
      actionType: 'cap_check',
      result: 'denied',
      reason: 'unknown_capability',
      enforcementMode: 'enforce',
      target: check.target,
      context: check.context as Record<string, unknown> | undefined,
    })
    return {
      result: {
        allowed: false,
        reason: 'unknown_capability',
        enforcement_mode: 'enforce',
        audit_id,
      },
      shouldThrow: true,
    }
  }

  // Step 2: load all grants for this agent
  const { data: grantsData } = (await db
    .from('agent_capabilities')
    .select('capability, enforcement_mode, target_pattern')
    .eq('agent_id', check.agentId)) as { data: GrantRow[] | null; error: unknown }

  const grants = grantsData ?? []
  const match = findGrant(grants, check.capability)
  const hasGrant = match !== null

  // Step 3: determine enforcement mode and reason
  const enforcementMode: EnforcementMode = hasGrant
    ? match!.grant.enforcement_mode
    : regRow.default_enforcement

  let reason: string
  if (hasGrant) {
    reason = match!.isWildcard ? 'wildcard_grant' : 'in_scope'
  } else {
    reason = grants.length === 0 ? 'unregistered_agent' : 'no_grant_for_agent'
  }

  // Step 4: compute allowed/result
  let allowed: boolean
  let resultStr: 'allowed' | 'allowed_log_only' | 'allowed_warn' | 'denied'

  if (hasGrant) {
    allowed = true
    resultStr = 'allowed'
  } else {
    switch (enforcementMode) {
      case 'log_only':
        allowed = true
        resultStr = 'allowed_log_only'
        break
      case 'warn':
        allowed = true
        resultStr = 'allowed_warn'
        break
      case 'enforce':
      default:
        allowed = false
        resultStr = 'denied'
        break
    }
  }

  const audit_id = await logAgentAction({
    agentId: check.agentId,
    capability: check.capability,
    actionType: 'cap_check',
    result: resultStr,
    reason,
    enforcementMode,
    target: check.target,
    context: check.context as Record<string, unknown> | undefined,
  })

  return {
    result: { allowed, reason, enforcement_mode: enforcementMode, audit_id },
    shouldThrow: !allowed,
  }
}

// requireCapability: throws CapabilityDeniedError when enforcement=enforce and no grant.
// In log_only/warn mode, always returns allowed=true even with no grant.
export async function requireCapability(check: CapabilityCheck): Promise<CapabilityResult> {
  const { result, shouldThrow } = await evaluate(check)
  if (shouldThrow) {
    throw new CapabilityDeniedError(check.agentId, check.capability, result.reason)
  }
  return result
}

// assertCapability: same as requireCapability but returns void (for callers that only care about success).
export async function assertCapability(check: CapabilityCheck): Promise<void> {
  await requireCapability(check)
}

// checkCapability: never throws. Returns CapabilityResult even when denied.
export async function checkCapability(check: CapabilityCheck): Promise<CapabilityResult> {
  const { result } = await evaluate(check)
  return result
}

// hasCapability: lightweight boolean check — does this agent have an explicit grant?
// Does NOT write to agent_actions. Use for conditional logic; use requireCapability for enforcement.
export async function hasCapability(agentId: string, capability: string): Promise<boolean> {
  const db = createServiceClient()
  const { data: grants } = (await db
    .from('agent_capabilities')
    .select('capability, enforcement_mode, target_pattern')
    .eq('agent_id', agentId)) as { data: GrantRow[] | null; error: unknown }

  return findGrant(grants ?? [], capability) !== null
}
