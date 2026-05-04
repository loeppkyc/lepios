/**
 * lib/orb/twin-context.ts — per-message Twin context injection for the orb chat.
 *
 * Retrieves relevant personal knowledge chunks for a user message and formats
 * them as a context block to be prepended to the system prompt. This makes the
 * orb feel like it knows Colin without requiring an explicit queryTwin tool call.
 *
 * Called by app/api/chat/route.ts on every message with a 2s timeout.
 */

import { retrievePersonalChunks, buildContextString } from '@/lib/twin/query'

/**
 * Retrieves relevant Twin knowledge chunks for a user message.
 * Returns a formatted context string or null if nothing useful found.
 *
 * Never throws — any error returns null so chat is never blocked.
 */
export async function getTwinContext(userText: string): Promise<string | null> {
  try {
    const { chunks, retrieval_path } = await retrievePersonalChunks(userText, 5)

    if (retrieval_path === 'none' || chunks.length === 0) {
      return null
    }

    // For vector path: filter out low-signal chunks (similarity <= 0.25)
    const usableChunks =
      retrieval_path === 'vector' ? chunks.filter((c) => c.similarity > 0.25) : chunks

    if (usableChunks.length === 0) {
      return null
    }

    return `## Relevant context from your knowledge base\n${buildContextString(usableChunks)}`
  } catch {
    return null
  }
}
