#!/usr/bin/env node
/**
 * LepiOS local exec server — runs on Colin's machine, exposed via Cloudflare tunnel.
 * Receives sandboxed command requests from Vercel, executes in Docker, returns results.
 *
 * Usage: EXEC_SECRET=<secret> node scripts/exec-server.js
 *
 * Add to cloudflared config.yml:
 *   - hostname: exec.<your-tunnel-domain>
 *     service: http://localhost:8002
 */

'use strict'

const http = require('http')
const { spawn } = require('child_process')
const { createHmac, timingSafeEqual } = require('crypto')

const PORT = parseInt(process.env.PORT ?? '8002', 10)
const EXEC_SECRET = process.env.EXEC_SECRET

if (!EXEC_SECRET) {
  console.error('FATAL: EXEC_SECRET env var is not set. Refusing to start.')
  process.exit(1)
}

const MAX_TIMEOUT_MS = 300_000
const DEFAULT_TIMEOUT_MS = 60_000

/**
 * Read the full request body as a string.
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Verify HMAC-SHA256 signature from the Authorization header.
 * Header format: "HMAC <hex-signature>"
 * Signature = HMAC-SHA256(rawBodyString, EXEC_SECRET)
 *
 * @param {http.IncomingMessage} req
 * @param {string} bodyStr
 * @returns {boolean}
 */
function verifyHmac(req, bodyStr) {
  const authHeader = req.headers['authorization'] ?? ''
  if (!authHeader.startsWith('HMAC ')) return false
  const providedHex = authHeader.slice(5).trim()

  let providedBuf
  try {
    providedBuf = Buffer.from(providedHex, 'hex')
  } catch {
    return false
  }
  if (providedBuf.length === 0) return false

  const expectedHex = createHmac('sha256', EXEC_SECRET).update(bodyStr).digest('hex')
  const expectedBuf = Buffer.from(expectedHex, 'hex')

  if (providedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(providedBuf, expectedBuf)
}

/**
 * Send a JSON response.
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {unknown} body
 */
function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload, 'utf8'),
  })
  res.end(payload)
}

/**
 * POST /exec handler — runs a command in Docker and returns results.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} bodyStr
 */
async function handleExec(req, res, bodyStr) {
  let parsed
  try {
    parsed = JSON.parse(bodyStr)
  } catch {
    sendJson(res, 400, { error: 'invalid_json' })
    return
  }

  const { cmd, cwd, env, timeoutMs: rawTimeout } = parsed

  if (typeof cmd !== 'string' || !cmd.trim()) {
    sendJson(res, 400, { error: 'cmd_required' })
    return
  }

  const timeoutMs = Math.min(
    typeof rawTimeout === 'number' && rawTimeout > 0 ? rawTimeout : DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  )

  // Build Docker env args
  const dockerEnvArgs = []
  if (env && typeof env === 'object') {
    for (const [k, v] of Object.entries(env)) {
      if (typeof k === 'string' && typeof v === 'string') {
        dockerEnvArgs.push('-e', `${k}=${v}`)
      }
    }
  }

  // Build Docker cwd args
  const dockerCwdArgs = []
  if (typeof cwd === 'string' && cwd.trim()) {
    dockerCwdArgs.push('-w', cwd)
  }

  const dockerArgs = [
    'run',
    '--rm',
    '--network=none',
    '-m', '256m',
    '--cpus=0.5',
    ...dockerEnvArgs,
    ...dockerCwdArgs,
    'alpine:3.19',
    'sh', '-c', cmd,
  ]

  const startMs = Date.now()
  let stdout = ''
  let stderr = ''
  let exitCode = null
  let timedOut = false

  await new Promise((resolve) => {
    let child
    try {
      child = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (spawnErr) {
      if (spawnErr && spawnErr.code === 'ENOENT') {
        sendJson(res, 503, { error: 'docker_not_available' })
        resolve(undefined)
        return
      }
      sendJson(res, 500, { error: String(spawnErr) })
      resolve(undefined)
      return
    }

    // ENOENT fires on child 'error' event when using spawn (not try/catch)
    let enoentSent = false

    child.on('error', (err) => {
      if (err.code === 'ENOENT' && !enoentSent) {
        enoentSent = true
        sendJson(res, 503, { error: 'docker_not_available' })
      }
      clearTimeout(killTimer)
      resolve(undefined)
    })

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })

    const killTimer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }, 2000)
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(killTimer)
      exitCode = timedOut ? null : code
      resolve(undefined)
    })
  })

  // If response was already sent (docker not available), stop here
  if (res.writableEnded) return

  const durationMs = Date.now() - startMs

  sendJson(res, 200, {
    exitCode,
    stdout,
    stderr,
    timedOut,
    durationMs,
  })
}

const server = http.createServer(async (req, res) => {
  // Health check — no auth required
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true })
    return
  }

  // POST /exec
  if (req.method === 'POST' && req.url === '/exec') {
    let bodyStr
    try {
      bodyStr = await readBody(req)
    } catch {
      sendJson(res, 400, { error: 'read_body_failed' })
      return
    }

    if (!verifyHmac(req, bodyStr)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }

    await handleExec(req, res, bodyStr)
    return
  }

  // All other routes
  sendJson(res, 404, { error: 'not_found' })
})

server.listen(PORT, () => {
  console.log(`LepiOS exec-server listening on port ${PORT}`)
})
