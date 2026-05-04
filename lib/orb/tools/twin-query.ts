/**
 * queryTwin — chat_ui Slice 3 tool.
 *
 * Queries Colin's personal knowledge corpus via askTwin().
 * Returns answer + confidence + escalation signal.
 *
 * Spec: docs/harness/CHAT_UI_SPEC.md §AD5 (S3 = Twin tool).
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import { askTwin } from '@/lib/twin/query'

type TwinQueryInput = { question: string }
type TwinQueryOutput = {
  answer: string
  confidence: number
  escalate: boolean
  escalate_reason: string | null
  retrieval_path: string
  sources_count: number
}

export const twinQueryTool: ChatTool<TwinQueryInput, TwinQueryOutput> = {
  name: 'queryTwin',
  description:
    "Queries Colin's personal knowledge corpus (principles, rules, decisions, personal knowledge base). " +
    'Returns an answer with confidence score. Use when Colin asks about his own views, principles, ' +
    'past decisions, or knowledge stored in his personal corpus.',
  parameters: z.object({
    question: z.string().describe("The question to ask Colin's digital twin"),
  }),
  capability: 'tool.chat_ui.read.twin',
  execute: async ({ question }) => {
    const resp = await askTwin(question)
    return {
      answer: resp.answer,
      confidence: resp.confidence,
      escalate: resp.escalate,
      escalate_reason: resp.escalate_reason,
      retrieval_path: resp.retrieval_path,
      sources_count: resp.sources.length,
    }
  },
}
