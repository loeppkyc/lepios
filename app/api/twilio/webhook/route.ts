import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { postSms } from '@/lib/orchestrator/sms'
import {
  handleRunCommand,
  handleQueueRunCommand,
  handleQueueStatusCommand,
  handleHaltCommand,
  handleResumeCommand,
} from '@/lib/harness/coordinator-commands'

export const dynamic = 'force-dynamic'

/**
 * Twilio SMS Webhook handler.
 * Expects application/x-www-form-urlencoded POST from Twilio.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get('Content-Type') || ''
  
  let body: string
  let from: string

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData()
    body = (formData.get('Body') as string) || ''
    from = (formData.get('From') as string) || ''
  } else {
    // Fallback for testing/JSON
    try {
      const json = await request.json()
      body = json.Body || json.body || ''
      from = json.From || json.from || ''
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 })
    }
  }

  const colinNumber = process.env.TWILIO_TO_NUMBER
  
  // Security: Whitelist Colin's number
  if (from !== colinNumber && colinNumber) {
    console.warn(`Ignoring SMS from unknown sender: ${from}`)
    // Return empty TwiML to satisfy Twilio
    return new Response('<Response></Response>', { 
      headers: { 'Content-Type': 'text/xml' } 
    })
  }

  // Log the interaction to agent_events for traceability
  const db = createServiceClient()
  await db.from('agent_events').insert({
    domain: 'orchestrator',
    action: 'sms_webhook',
    actor: 'colin',
    status: 'success',
    task_type: 'sms_command',
    output_summary: `received SMS command: ${body.slice(0, 50)}`,
    meta: { from, body },
    tags: ['sms', 'webhook'],
  }).catch(() => {})

  const cmd = body.trim().toLowerCase()
  
  try {
    // Route to appropriate coordinator command
    if (cmd.startsWith('run ') || cmd === 'run') {
      // Normalize for the parser which expects /run
      await handleRunCommand(cmd.startsWith('/') ? body : `/${body}`)
    } else if (cmd.startsWith('queue run')) {
      await handleQueueRunCommand(body)
    } else if (cmd === 'status' || cmd === 'queue status') {
      await handleQueueStatusCommand()
    } else if (cmd === 'halt') {
      await handleHaltCommand()
    } else if (cmd === 'resume') {
      await handleResumeCommand()
    } else if (cmd === 'help') {
      await postSms('Commands: status, run <task>, halt, resume, queue run.')
    } else {
      await postSms(`LepiOS: Unrecognized command "${body}". Reply "help" for options.`)
    }
  } catch (err) {
    console.error('SMS Command Execution Error:', err)
    await postSms(`LepiOS Error: ${err instanceof Error ? err.message : 'Unknown error during execution.'}`)
  }

  // Return empty TwiML (replies are handled asynchronously via postSms/Telegram)
  return new Response('<Response></Response>', { 
    headers: { 'Content-Type': 'text/xml' } 
  })
}
