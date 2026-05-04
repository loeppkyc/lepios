import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { hasFillerPhrase, VOICE_FILLER_PHRASES } from '@/lib/llm/lepios-voice'

// ── hasFillerPhrase ────────────────────────────────────────────────────────────

describe('hasFillerPhrase', () => {
  it.each([
    ['Great question, let me explain.', true],
    ["Certainly! Here's the answer.", true],
    ['Certainly, let me help.', true],
    ["I'd be happy to assist.", true],
    ['I would be happy to walk you through this.', true],
    ['Of course, here we go.', true],
    ['Absolutely! That makes sense.', true],
    ['Happy to help with that.', true],
    ['Excellent question!', true],
  ])('detects filler opener in %s', (text, expected) => {
    expect(hasFillerPhrase(text) !== null).toBe(expected)
  })

  it.each([
    ['No. The data does not support that.', false],
    ['The deploy is failing because of a missing env var.', false],
    ['Three options: A, B, C.', false],
    ['Migration 0042 applied cleanly.', false],
    ['It depends — the threshold is configurable.', false],
  ])('returns null for direct responses: %s', (text, expected) => {
    expect(hasFillerPhrase(text) !== null).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(hasFillerPhrase('GREAT QUESTION here.')).not.toBeNull()
    expect(hasFillerPhrase('CERTAINLY! Fine.')).not.toBeNull()
  })

  it('returns the matched phrase', () => {
    const phrase = hasFillerPhrase('Great question, here is my answer.')
    expect(phrase).toBe('great question')
  })
})

// ── lepios.md prompt completeness ─────────────────────────────────────────────

describe('LEPIOS system prompt (lib/llm/prompts/lepios.md)', () => {
  const lepiosMd = fs
    .readFileSync(path.join(process.cwd(), 'lib/llm/prompts/lepios.md'), 'utf-8')
    .trim()

  it('contains LEPIOS identity declaration', () => {
    expect(lepiosMd).toContain('You are LEPIOS')
  })

  it('contains voice rules section', () => {
    expect(lepiosMd).toContain('Voice:')
    expect(lepiosMd).toContain('No filler')
    expect(lepiosMd).toContain('No trailing summaries')
  })

  it('contains format rules section', () => {
    expect(lepiosMd).toContain('Format:')
    expect(lepiosMd).toContain('Code blocks')
  })

  it('declares tool capabilities', () => {
    expect(lepiosMd).toContain('getHarnessRollup')
    expect(lepiosMd).toContain('queryTwin')
    expect(lepiosMd).toContain('sendTelegramMessage')
  })

  it('does not open with a filler phrase', () => {
    expect(hasFillerPhrase(lepiosMd)).toBeNull()
  })
})

// ── Modelfile integrity ────────────────────────────────────────────────────────

describe('Modelfile integrity', () => {
  it('Modelfile.lepios SYSTEM block contains the full lepios.md content', () => {
    const lepiosMd = fs
      .readFileSync(path.join(process.cwd(), 'lib/llm/prompts/lepios.md'), 'utf-8')
      .trim()

    const modelfile = fs.readFileSync(
      path.join(process.cwd(), 'infra/ollama/Modelfile.lepios'),
      'utf-8'
    )

    expect(modelfile).toContain(lepiosMd)
  })

  it('Modelfile.lepios targets qwen2.5:14b (post-GPU model)', () => {
    const modelfile = fs.readFileSync(
      path.join(process.cwd(), 'infra/ollama/Modelfile.lepios'),
      'utf-8'
    )
    expect(modelfile).toMatch(/^FROM qwen2\.5:14b/m)
  })
})
