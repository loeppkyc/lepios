import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'
import { createClient } from '@/lib/supabase/server'

type CheckResult = { ok: boolean; message: string }
type Results = Record<string, CheckResult>

async function checkOllama(tunnelUrl: string): Promise<CheckResult> {
  try {
    const r = await fetch(`${tunnelUrl}/api/tags`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) return { ok: false, message: `Ollama returned ${r.status}` }
    const data = (await r.json()) as { models?: { name: string }[] }
    const models = data.models ?? []
    return {
      ok: true,
      message: `${models.length} models loaded: ${models
        .slice(0, 4)
        .map((m) => m.name)
        .join(', ')}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unreachable'
    return { ok: false, message: `Ollama not reachable via tunnel — ${msg}` }
  }
}

async function checkColinModel(tunnelUrl: string): Promise<CheckResult> {
  try {
    const r = await fetch(`${tunnelUrl}/api/tags`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) return { ok: false, message: `Could not reach Ollama (${r.status})` }
    const data = (await r.json()) as { models?: { name: string }[] }
    const names = (data.models ?? []).map((m) => m.name)
    const found = names.find((n) => n.includes('colin-assistant'))
    if (found) return { ok: true, message: `${found} is available` }
    return {
      ok: false,
      message:
        'colin-assistant not found — run: ollama create colin-assistant -f tools/colin_assistant.Modelfile',
    }
  } catch {
    return { ok: false, message: 'Could not check models' }
  }
}

async function checkEmbedModel(tunnelUrl: string): Promise<CheckResult> {
  try {
    const r = await fetch(`${tunnelUrl}/api/tags`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) return { ok: false, message: `Could not reach Ollama (${r.status})` }
    const data = (await r.json()) as { models?: { name: string }[] }
    const names = (data.models ?? []).map((m) => m.name)
    if (names.some((n) => n.includes('nomic-embed'))) {
      return { ok: true, message: 'nomic-embed-text available for RAG embeddings' }
    }
    return { ok: false, message: 'nomic-embed-text not found — run: ollama pull nomic-embed-text' }
  } catch {
    return { ok: false, message: 'Could not check embedding model' }
  }
}

async function checkAnthropic(): Promise<CheckResult> {
  const key = process.env.ANTHROPIC_API_KEY ?? ''
  if (key && key.startsWith('sk-')) {
    return { ok: true, message: 'Anthropic API key configured — Claude escalation ready' }
  }
  return { ok: false, message: 'ANTHROPIC_API_KEY not set in Vercel env' }
}

async function checkMemory(): Promise<CheckResult> {
  try {
    const supabase = await createClient()
    const { count, error } = await supabase
      .from('knowledge')
      .select('id', { count: 'exact', head: true })
    if (error) return { ok: false, message: `Supabase error: ${error.message}` }
    const n = count ?? 0
    if (n > 0) return { ok: true, message: `${n} knowledge documents indexed in Supabase` }
    return { ok: false, message: 'No knowledge documents found — run ingest to populate' }
  } catch {
    return { ok: false, message: 'Could not query knowledge table' }
  }
}

export async function GET() {
  const gate = await requireUser()
  if (!gate.ok) return gate.response

  const tunnelUrl = (process.env.OLLAMA_TUNNEL_URL ?? '').replace(/\/$/, '')

  const noTunnel: CheckResult = {
    ok: false,
    message: 'OLLAMA_TUNNEL_URL not configured in Vercel env',
  }

  const [ollama, colinModel, embedModel, anthropic, memory] = await Promise.all([
    tunnelUrl ? checkOllama(tunnelUrl) : Promise.resolve(noTunnel),
    tunnelUrl ? checkColinModel(tunnelUrl) : Promise.resolve(noTunnel),
    tunnelUrl ? checkEmbedModel(tunnelUrl) : Promise.resolve(noTunnel),
    checkAnthropic(),
    checkMemory(),
  ])

  const results: Results = {
    ollama,
    colin_model: colinModel,
    embed_model: embedModel,
    anthropic,
    memory,
  }

  return NextResponse.json({ results })
}
