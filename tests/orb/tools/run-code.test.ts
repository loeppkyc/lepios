/**
 * runCodeTool — sandboxed JS execution tests.
 *
 * Tests execute() directly (no registry overhead, no capability mocking).
 * No external dependencies — pure vm module.
 */
import { describe, it, expect } from 'vitest'
import { runCodeTool } from '@/lib/orb/tools/run-code'

const CTX = { agentId: 'chat_ui' as const, conversationId: 'c', userId: 'u', toolCallId: 't' }

describe('runCodeTool — basic evaluation', () => {
  it('returns the value of the last expression', async () => {
    const r = await runCodeTool.execute({ code: '1 + 2' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.result).toBe('3')
  })

  it('returns string result', async () => {
    const r = await runCodeTool.execute({ code: '"hello " + "world"' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.result).toBe('hello world')
  })

  it('returns JSON for object results', async () => {
    const r = await runCodeTool.execute({ code: '({ a: 1, b: [2, 3] })' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) {
      const parsed = JSON.parse(r.result)
      expect(parsed).toEqual({ a: 1, b: [2, 3] })
    }
  })

  it('returns (no return value) for void expressions', async () => {
    const r = await runCodeTool.execute({ code: 'const x = 1; void x' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.result).toBe('(no return value)')
  })

  it('handles null result', async () => {
    const r = await runCodeTool.execute({ code: 'null' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.result).toBe('null')
  })

  it('Math is available', async () => {
    const r = await runCodeTool.execute({ code: 'Math.round(Math.PI * 100) / 100' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.result).toBe('3.14')
  })

  it('JSON is available', async () => {
    const r = await runCodeTool.execute({ code: 'JSON.stringify({x:1})' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.result).toBe('{"x":1}')
  })
})

describe('runCodeTool — console capture', () => {
  it('captures console.log output', async () => {
    const r = await runCodeTool.execute({ code: 'console.log("hello"); console.log("world")' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.stdout).toContain('hello')
      expect(r.stdout).toContain('world')
    }
  })

  it('captures console.error with [err] prefix', async () => {
    const r = await runCodeTool.execute({ code: 'console.error("oops")' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.stdout[0]).toMatch(/^\[err\] oops/)
  })

  it('captures console.warn with [warn] prefix', async () => {
    const r = await runCodeTool.execute({ code: 'console.warn("careful")' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.stdout[0]).toMatch(/^\[warn\] careful/)
  })

  it('stdout is empty when no console calls', async () => {
    const r = await runCodeTool.execute({ code: '1 + 1' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.stdout).toHaveLength(0)
  })
})

describe('runCodeTool — error handling', () => {
  it('returns failure on syntax error', async () => {
    const r = await runCodeTool.execute({ code: 'function {' }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBeTruthy()
  })

  it('returns failure on runtime error', async () => {
    const r = await runCodeTool.execute({ code: 'null.toString()' }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/null|Cannot/i)
  })

  it('returns failure on reference error', async () => {
    const r = await runCodeTool.execute({ code: 'notDefined + 1' }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/not defined/i)
  })

  it('stdout captured even on error', async () => {
    const r = await runCodeTool.execute({ code: 'console.log("before"); throw new Error("boom")' }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.stdout).toContain('before')
  })

  it('includes durationMs in failure result', async () => {
    const r = await runCodeTool.execute({ code: 'throw new Error("x")' }, CTX)
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })
})

describe('runCodeTool — sandbox isolation', () => {
  it('blocks access to process', async () => {
    const r = await runCodeTool.execute({ code: 'process.env.HOME' }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/process is not defined/i)
  })

  it('blocks require', async () => {
    const r = await runCodeTool.execute({ code: 'require("fs")' }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/require is not defined/i)
  })

  it('blocks global (node global object)', async () => {
    const r = await runCodeTool.execute({ code: 'global.process' }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/global is not defined/i)
  })

  it('blocks fetch', async () => {
    const r = await runCodeTool.execute({ code: 'fetch("https://example.com")' }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/fetch is not defined/i)
  })

  it('does not share state between calls', async () => {
    await runCodeTool.execute({ code: 'var secret = "abc"' }, CTX)
    const r = await runCodeTool.execute({ code: 'typeof secret' }, CTX)
    expect(r.success).toBe(true)
    if (r.success) expect(r.result).toBe('undefined')
  })
})

describe('runCodeTool — timeout', () => {
  it('enforces timeout on infinite loop', async () => {
    const r = await runCodeTool.execute({ code: 'while(true){}', timeoutMs: 100 }, CTX)
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toBeTruthy()
  }, 5_000)

  it('caps timeoutMs at MAX_TIMEOUT_MS (10s) regardless of input', async () => {
    // Schema validation enforces max 10_000 — values above fail Zod parse
    const schema = runCodeTool.parameters
    const parsed = schema.safeParse({ code: '1', timeoutMs: 99_999 })
    expect(parsed.success).toBe(false)
  })
})
