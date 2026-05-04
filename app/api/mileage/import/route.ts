import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'

const MAX_BYTES = 1024 * 1024 // 1 MB — CSV files are tiny

export interface ParsedTrip {
  date: string
  from_location: string
  to_location: string
  km: number
  purpose: string
  round_trip: boolean
  notes: string
}

const PARSE_PROMPT = `You are parsing a MileIQ CSV export into structured trip records.

MileIQ exports may have varying column names. Common formats:
- "Drive Date" or "Date" for the date
- "Distance (km)" or "Distance (mi)" for distance — if miles, convert to km (1 mi = 1.60934 km)
- "Start Location" or "Start" for the origin
- "End Location" or "End" for the destination
- "Purpose" for the trip description
- "Classification" — include ONLY rows where Classification = "Business" (case-insensitive)
- "Note" or "Notes" for extra info

Rules:
- Include ONLY Business-classified drives (skip Personal, or unclassified)
- date: YYYY-MM-DD format
- from_location and to_location: use address or location name as-is
- km: one-way distance as a float, rounded to 1 decimal — convert from miles if needed
- purpose: use the Purpose field; if empty use "Business drive"
- round_trip: always false (MileIQ logs each leg separately)
- notes: the Note/Notes field if present, else empty string

Return ONLY a valid JSON array — no markdown, no explanation:
[
  {
    "date": "YYYY-MM-DD",
    "from_location": "...",
    "to_location": "...",
    "km": 12.5,
    "purpose": "...",
    "round_trip": false,
    "notes": ""
  }
]

If there are no Business drives, return [].`

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 1 MB limit' }, { status: 413 })
  }

  const csv = new TextDecoder().decode(bytes).slice(0, 200_000)

  const client = new Anthropic()
  let raw: string
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${PARSE_PROMPT}\n\nCSV content:\n${csv}`,
        },
      ],
    })
    raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  } catch (e) {
    return NextResponse.json(
      { error: `AI parse failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    )
  }

  let trips: ParsedTrip[]
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    trips = JSON.parse(match ? match[0] : raw) as ParsedTrip[]
    if (!Array.isArray(trips)) throw new Error('not array')
  } catch {
    return NextResponse.json({ error: 'Failed to parse AI response as JSON', raw }, { status: 500 })
  }

  // Sanitise
  trips = trips
    .filter((t) => t.date && t.from_location && t.to_location && t.km > 0)
    .map((t) => ({
      date: t.date,
      from_location: String(t.from_location).trim(),
      to_location: String(t.to_location).trim(),
      km: Math.round(Number(t.km) * 10) / 10,
      purpose: String(t.purpose || 'Business drive').trim(),
      round_trip: false,
      notes: String(t.notes || '').trim(),
    }))

  return NextResponse.json({ trips, count: trips.length })
}
