/**
 * submitIdea — chat_ui Slice 5 action tool.
 *
 * Inserts a row into idea_inbox with source='manual_api'.
 * Approval-gated: call with dryRun: true (default) to preview,
 * then dryRun: false after Colin confirms in the conversation.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import { createServiceClient } from '@/lib/supabase/service'

type Input = {
  title: string
  summary?: string
  body?: string
  score?: number
  tags?: string[]
  dryRun?: boolean
}

type Output = {
  submitted: boolean
  preview: { title: string; summary?: string; score: number; tags: string[] }
  id?: string
  status?: string
}

export const submitIdeaTool: ChatTool<Input, Output> = {
  name: 'submitIdea',
  description:
    "Adds an idea to Colin's idea_inbox (source: manual_api). " +
    "ALWAYS call with dryRun: true first — show the idea preview to Colin and get his " +
    "explicit confirmation in the conversation before calling with dryRun: false.",
  parameters: z.object({
    title: z.string().min(1).max(500).describe('Short idea title'),
    summary: z.string().max(200).optional().describe('One-sentence summary (used in digest)'),
    body: z.string().max(10000).optional().describe('Full idea description (optional)'),
    score: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .default(0.5)
      .describe('Leverage score 0.0–1.0 (default 0.5)'),
    tags: z.array(z.string()).optional().default([]).describe('Tag strings'),
    dryRun: z
      .boolean()
      .optional()
      .default(true)
      .describe('true = preview only (default); false = actually submit'),
  }),
  capability: 'tool.chat_ui.action.idea_inbox',
  execute: async ({ title, summary, body, score, tags, dryRun }) => {
    const resolvedScore = score ?? 0.5
    const resolvedTags = tags ?? []
    const preview = { title, summary, score: resolvedScore, tags: resolvedTags }

    if (dryRun !== false) {
      return { submitted: false, preview }
    }

    const db = createServiceClient()
    const { data, error } = await db
      .from('idea_inbox')
      .insert({
        title,
        summary: summary ?? null,
        body: body ?? null,
        score: resolvedScore,
        tags: resolvedTags,
        source: 'manual_api',
        source_ref: 'chat_ui',
        status: 'parked',
      })
      .select('id, status')
      .single()

    if (error) throw new Error(`Failed to submit idea: ${error.message}`)
    return { submitted: true, preview, id: data.id, status: data.status }
  },
}
