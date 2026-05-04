/**
 * readFileTool security and behaviour tests.
 *
 * Tests the execute function directly (no registry overhead).
 * Uses real fs for the allowed-path happy-path — no mocks for file reads
 * since the test suite runs inside the repo and lib/ files are present.
 */
import { describe, it, expect } from 'vitest'
import { readFileTool } from '@/lib/orb/tools/read-file'

const CTX = { agentId: 'chat_ui' as const, conversationId: 'c', userId: 'u', toolCallId: 't' }

describe('readFileTool — path security', () => {
  it('blocks path traversal (../../)', async () => {
    const result = await readFileTool.execute({ path: '../../.env' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks leading slash bypass (/etc/passwd)', async () => {
    const result = await readFileTool.execute({ path: '/etc/passwd' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks non-allowed prefix (config/)', async () => {
    const result = await readFileTool.execute({ path: 'config/something.ts' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks .env pattern in allowed prefix', async () => {
    const result = await readFileTool.execute({ path: 'lib/.env.local' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks "secret" keyword in path', async () => {
    const result = await readFileTool.execute({ path: 'lib/my-secrets.ts' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks "credential" keyword in path', async () => {
    const result = await readFileTool.execute({ path: 'lib/credentials.json' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks ".pem" extension', async () => {
    const result = await readFileTool.execute({ path: 'lib/cert.pem' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })
})

describe('readFileTool — happy path', () => {
  it('reads an allowed lib/ file and returns content', async () => {
    const result = await readFileTool.execute({ path: 'lib/llm/prompts/lepios.md' }, CTX)
    expect(result).toMatchObject({
      path: 'lib/llm/prompts/lepios.md',
      truncated: false,
    })
    expect((result as { content: string }).content).toContain('You are LEPIOS')
  })

  it('returns not_found for a non-existent allowed path', async () => {
    const result = await readFileTool.execute({ path: 'lib/__does_not_exist__.ts' }, CTX)
    expect(result).toMatchObject({ error: 'not_found', path: 'lib/__does_not_exist__.ts' })
  })

  it('tool capability is a read capability (not action)', () => {
    expect(readFileTool.capability).toContain('read')
  })
})
