// http-handlers.ts — wires http.ts and telegram.ts into the dispatch registry.
//
// These registrations happen at module load time (side-effectful import).
// Import this module for side effects only:
//   import '@/lib/harness/arms-legs/http-handlers'
//
// Double cap-check note:
//   dispatch.ts calls checkCapability before invoking any handler.
//   httpRequest() internally calls requireCapability as well.
//   Both are in log_only mode — the extra row is harmless.
//   S2 Phase E will remove the internal cap check from httpRequest.

import { httpRequest } from './http'
import type { HttpRequestArgs } from './http'
import { telegram } from './telegram'
import type { TelegramOptions } from './telegram'
import { registerHandler } from './dispatch'
import type { Capability } from './types'

// ── Telegram handler ──────────────────────────────────────────────────────────

registerHandler<
  { message: string; options?: TelegramOptions },
  Awaited<ReturnType<typeof telegram>>
>('net.outbound.telegram', async (payload, ctx) => {
  return telegram(payload.message, { ...payload.options, agentId: ctx.agentId })
})

// ── HTTP handlers for all net.outbound.* capabilities ────────────────────────

// Payload type: all HttpRequestArgs fields except agentId and capability
// (those are injected from the handler context / capability string).
type HttpPayload = Omit<HttpRequestArgs, 'agentId' | 'capability'>

const HTTP_CAPABILITIES: Capability[] = [
  'net.outbound.vercel.read',
  'net.outbound.vercel.deploy',
  'net.outbound.supabase',
  'net.outbound.anthropic',
  'net.outbound.github',
  'net.outbound.openai',
  'net.outbound.*',
]

for (const cap of HTTP_CAPABILITIES) {
  registerHandler<HttpPayload, Awaited<ReturnType<typeof httpRequest>>>(
    cap,
    async (payload, ctx) => {
      return httpRequest({ ...payload, agentId: ctx.agentId, capability: ctx.capability })
    }
  )
}
