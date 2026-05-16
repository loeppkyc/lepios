/**
 * smoke-test.mjs — Manual MCP server smoke test
 *
 * Usage:
 *   node mcp-server/smoke-test.mjs
 *
 * Starts the MCP server as a child process, sends a get_task_queue request
 * via the MCP JSON-RPC stdio protocol (newline-delimited JSON), prints the
 * result, and exits 0.
 *
 * This is NOT a vitest test — it is a manual verification script.
 * Run it after setup to confirm the server is working end-to-end.
 *
 * Exit codes:
 *   0 — server started, tool responded (result may be empty array if queue is empty)
 *   1 — server failed to start or tool returned an error
 */

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const serverPath = join(__dirname, 'index.mjs')

// MCP JSON-RPC 2.0 messages (newline-delimited, per SDK stdio transport)
const INIT_MESSAGE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-test', version: '1.0.0' },
  },
}

const INITIALIZED_NOTIFICATION = {
  jsonrpc: '2.0',
  method: 'notifications/initialized',
}

const CALL_TOOL_MESSAGE = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: 'get_task_queue',
    arguments: { status: 'queued' },
  },
}

function sendMessage(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + '\n')
}

function run() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stderr = ''
    let responded = false
    let phase = 'wait-init' // wait-init | wait-tool | done

    const rl = createInterface({ input: proc.stdout })

    rl.on('line', (line) => {
      if (!line.trim()) return

      let msg
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }

      if (phase === 'wait-init' && msg.id === 1) {
        // Init response — send initialized notification + tool call
        phase = 'wait-tool'
        sendMessage(proc, INITIALIZED_NOTIFICATION)
        sendMessage(proc, CALL_TOOL_MESSAGE)
      } else if (phase === 'wait-tool' && msg.id === 2) {
        responded = true
        phase = 'done'
        proc.kill()

        if (msg.error) {
          console.error('Tool call error:', JSON.stringify(msg.error, null, 2))
          reject(new Error(msg.error.message ?? 'Tool call failed'))
          return
        }

        const content = msg.result?.content ?? []
        const textItem = content.find((c) => c.type === 'text')
        if (textItem) {
          let parsed
          try {
            parsed = JSON.parse(textItem.text)
          } catch {
            parsed = textItem.text
          }

          if (parsed && typeof parsed === 'object' && parsed.error) {
            // Tool returned a domain error (e.g. missing credentials)
            console.log('Tool response (error — likely missing credentials):')
            console.log(JSON.stringify(parsed, null, 2))
            console.log(
              '\nSmoke test: PASS (server started and tool responded with error — expected when .env.local is absent)'
            )
            resolve()
          } else {
            console.log('get_task_queue result:')
            console.log(JSON.stringify(parsed, null, 2))
            console.log(`\nRow count: ${Array.isArray(parsed) ? parsed.length : 'N/A'}`)
            console.log('\nSmoke test: PASS')
            resolve()
          }
        } else {
          console.log('Tool response:', JSON.stringify(msg.result, null, 2))
          console.log('\nSmoke test: PASS')
          resolve()
        }
      }
    })

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to start server: ${err.message}`))
    })

    proc.on('close', (code) => {
      if (!responded && phase !== 'done') {
        console.error('Server stderr:', stderr)
        reject(new Error(`Server exited with code ${code} before responding`))
      }
    })

    // Send initialization message after server has had time to start
    setTimeout(() => {
      if (phase === 'wait-init') {
        sendMessage(proc, INIT_MESSAGE)
      }
    }, 500)

    // Timeout guard
    setTimeout(() => {
      if (!responded) {
        console.error('Server stderr:', stderr)
        proc.kill()
        reject(new Error('Smoke test timed out after 15 seconds'))
      }
    }, 15000)
  })
}

try {
  await run()
  process.exit(0)
} catch (err) {
  console.error('Smoke test FAILED:', err.message)
  process.exit(1)
}
