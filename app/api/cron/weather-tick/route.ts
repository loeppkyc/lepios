/**
 * POST /api/cron/weather-tick
 *
 * Hourly cron (0 * * * * UTC).
 * Fetches current weather for Edmonton, AB from Open-Meteo (no API key required).
 * Writes one row to weather_log.
 *
 * Auth: requireCronSecret (F22)
 * Sprint 10 Chunk D
 *
 * Open-Meteo API docs: https://open-meteo.com/en/docs
 * WMO weather codes: https://open-meteo.com/en/docs#weathervariables
 */

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Edmonton, AB coordinates
const LATITUDE = 53.5461
const LONGITUDE = -113.4938

// WMO weather code → human-readable condition (subset)
// TODO: tune with real data — expand as needed
const WMO_CONDITIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
}

interface OpenMeteoResponse {
  current_weather?: {
    temperature: number
    windspeed: number
    weathercode: number
    time: string
  }
  hourly?: {
    time: string[]
    relativehumidity_2m: number[]
    apparent_temperature: number[]
    windspeed_10m: number[]
  }
}

export async function POST(request: Request) {
  // auth: see lib/auth/cron-secret.ts
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()

  // Fetch from Open-Meteo
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(LATITUDE))
  url.searchParams.set('longitude', String(LONGITUDE))
  url.searchParams.set('current_weather', 'true')
  url.searchParams.set('hourly', 'relativehumidity_2m,apparent_temperature,windspeed_10m')
  url.searchParams.set('forecast_days', '1')
  url.searchParams.set('timezone', 'America/Edmonton')

  let weatherData: OpenMeteoResponse | null = null
  try {
    const resp = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) {
      console.error('[weather-tick] Open-Meteo returned', resp.status)
      return NextResponse.json({ error: `Open-Meteo HTTP ${resp.status}` }, { status: 502 })
    }
    weatherData = (await resp.json()) as OpenMeteoResponse
  } catch (err) {
    console.error('[weather-tick] fetch failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }

  if (!weatherData?.current_weather) {
    return NextResponse.json({ error: 'No current_weather in response' }, { status: 502 })
  }

  const cw = weatherData.current_weather
  const now = new Date()

  // Find the closest hourly entry for humidity and apparent temperature
  let humidity: number | null = null
  let feelsLikeC: number | null = null

  if (weatherData.hourly?.time) {
    const nowHour = now.toISOString().slice(0, 13) // YYYY-MM-DDTHH
    const idx = weatherData.hourly.time.findIndex((t) => t.startsWith(nowHour))
    if (idx >= 0) {
      humidity = weatherData.hourly.relativehumidity_2m[idx] ?? null
      feelsLikeC = weatherData.hourly.apparent_temperature[idx] ?? null
    }
  }

  const condition = WMO_CONDITIONS[cw.weathercode] ?? `Code ${cw.weathercode}`

  const { error: insertErr } = await supabase.from('weather_log').insert({
    recorded_at: now.toISOString(),
    temp_c: cw.temperature,
    feels_like_c: feelsLikeC,
    condition,
    humidity,
    wind_kph: cw.windspeed,
    location: 'Edmonton, AB',
  })

  if (insertErr) {
    console.error('[weather-tick] insert failed:', insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    recorded_at: now.toISOString(),
    temp_c: cw.temperature,
    feels_like_c: feelsLikeC,
    condition,
    humidity,
    wind_kph: cw.windspeed,
  })
}
