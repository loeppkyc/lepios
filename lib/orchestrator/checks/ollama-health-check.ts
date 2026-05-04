import { healthCheck } from '@/lib/ollama/client'
import { OLLAMA_MODELS } from '@/lib/ollama/models'
import type { CheckResult, Flag } from '../types'

// Checks that Ollama is reachable and the primary analysis model is loaded.
export async function checkOllamaHealth(): Promise<CheckResult> {
  const start = Date.now()
  const flags: Flag[] = []
  const targetModel = OLLAMA_MODELS.ANALYSIS

  const health = await healthCheck()

  if (!health.reachable) {
    flags.push({
      severity: 'critical',
      message: `Ollama unreachable (tunnel_used: ${health.tunnel_used}, latency: ${health.latency_ms}ms)`,
      entity_type: 'ollama',
    })
    return {
      name: 'ollama_health',
      status: 'fail',
      flags,
      counts: { reachable: 0 },
      duration_ms: Date.now() - start,
    }
  }

  if (!health.models.includes(targetModel)) {
    flags.push({
      severity: 'warn',
      message: `${targetModel} not in available models: [${health.models.join(', ')}]`,
      entity_type: 'ollama',
    })
    return {
      name: 'ollama_health',
      status: 'warn',
      flags,
      counts: { reachable: 1, model_loaded: 0, models: health.models.length },
      duration_ms: Date.now() - start,
    }
  }

  return {
    name: 'ollama_health',
    status: 'pass',
    flags,
    counts: { reachable: 1, model_loaded: 1, models: health.models.length },
    duration_ms: Date.now() - start,
  }
}
