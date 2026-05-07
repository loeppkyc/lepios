import { NextResponse } from 'next/server'
import {
  badRequest,
  logHealthEvent,
  parsePersonHandle,
  requireHealthUser,
  serverError,
} from '../_lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireHealthUser()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return badRequest('Invalid JSON')

  const person = parsePersonHandle(body.person_handle)
  if (!person) return badRequest('Invalid person_handle')

  const workout_date = String(body.workout_date ?? '')
  const exercise = String(body.exercise ?? '').trim()
  const intensity = Number(body.intensity)
  const muscle_groups = Array.isArray(body.muscle_groups)
    ? (body.muscle_groups as unknown[]).map((m) => String(m))
    : []
  const notes = String(body.notes ?? '')

  if (!workout_date) return badRequest('workout_date is required')
  if (!exercise) return badRequest('exercise is required')
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) {
    return badRequest('intensity must be 1-10')
  }
  if (muscle_groups.length === 0) return badRequest('at least one muscle_group is required')

  const { data, error } = await auth.supabase
    .from('workouts')
    .insert({
      person_handle: person,
      workout_date,
      exercise,
      muscle_groups,
      intensity,
      notes,
    })
    .select('id')
    .single()

  if (error) return serverError(error.message)

  await logHealthEvent(auth.supabase, {
    user: auth.user,
    action: 'workout.add',
    summary: `${person} ${exercise} int=${intensity}`,
  })
  return NextResponse.json({ ok: true, id: data.id })
}
