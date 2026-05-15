'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface FocusSession {
  id: string
  label: string
  duration_minutes: number
  elapsed_seconds: number
  status: 'active' | 'paused' | 'completed' | 'abandoned'
  pomodoro_type: 'work' | 'short_break' | 'long_break'
  time_block_id: string | null
  started_at: string
  completed_at: string | null
  created_at: string
}

interface OpenLoop {
  id: string
  text: string
  status: 'open' | 'resolved' | 'dismissed'
  resolved_at: string | null
  created_at: string
}

interface TimeBlock {
  id: string
  block_date: string
  start_hour: number
  end_hour: number
  label: string
  color: string
  pomodoros_planned: number
  created_at: string
}

const MODES = {
  work: { label: 'WORK', minutes: 25, accent: 'var(--color-accent-gold)' },
  short_break: { label: 'SHORT BREAK', minutes: 5, accent: '#4ade80' },
  long_break: { label: 'LONG BREAK', minutes: 15, accent: '#60a5fa' },
} as const
type ModeKey = keyof typeof MODES

const RING_R = 80
const RING_CIRC = 2 * Math.PI * RING_R

function fmt(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function FocusPage() {
  const [mode, setMode] = useState<ModeKey>('work')
  const [timeLeft, setTimeLeft] = useState(MODES.work.minutes * 60)
  const [isRunning, setIsRunning] = useState(false)
  const [pomodoroCount, setPomodoroCount] = useState(0)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionLabel, setSessionLabel] = useState('Focus Session')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)

  const [todaySessions, setTodaySessions] = useState<FocusSession[]>([])
  const [openLoops, setOpenLoops] = useState<OpenLoop[]>([])
  const [timeBlocks, setTimeBlocks] = useState<TimeBlock[]>([])

  const [sessionsTick, setSessionsTick] = useState(0)
  const [loopsTick, setLoopsTick] = useState(0)
  const [blocksTick, setBlocksTick] = useState(0)
  const refreshSessions = useCallback(() => setSessionsTick((n) => n + 1), [])
  const refreshLoops = useCallback(() => setLoopsTick((n) => n + 1), [])
  const refreshBlocks = useCallback(() => setBlocksTick((n) => n + 1), [])

  const [loopInput, setLoopInput] = useState('')
  const [loopCapturing, setLoopCapturing] = useState(false)

  const [showBlockForm, setShowBlockForm] = useState(false)
  const [blockLabel, setBlockLabel] = useState('')
  const [blockStartHour, setBlockStartHour] = useState(9)
  const [blockEndHour, setBlockEndHour] = useState(10)
  const [blockColor, setBlockColor] = useState('#4a9eff')
  const [blockPomodoros, setBlockPomodoros] = useState(0)
  const [blockSaving, setBlockSaving] = useState(false)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/focus/sessions')
      .then((r) => (r.ok ? (r.json() as Promise<{ sessions: FocusSession[] }>) : null))
      .then((data) => {
        if (!cancelled && data) setTodaySessions(data.sessions ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionsTick])

  useEffect(() => {
    let cancelled = false
    fetch('/api/focus/open-loops?status=open')
      .then((r) => (r.ok ? (r.json() as Promise<{ loops: OpenLoop[] }>) : null))
      .then((data) => {
        if (!cancelled && data) setOpenLoops(data.loops ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [loopsTick])

  useEffect(() => {
    let cancelled = false
    const today = new Date().toISOString().slice(0, 10)
    fetch(`/api/focus/time-blocks?date=${today}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ blocks: TimeBlock[] }>) : null))
      .then((data) => {
        if (!cancelled && data) setTimeBlocks(data.blocks ?? [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [blocksTick])

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        elapsedRef.current += 1
        setTimeLeft((t) => {
          if (t <= 1) {
            clearInterval(intervalRef.current!)
            if (activeSessionId) {
              fetch(`/api/focus/sessions/${activeSessionId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'completed', elapsed_seconds: elapsedRef.current }),
              })
                .then(() => refreshSessions())
                .catch(() => {})
            }
            setIsRunning(false)
            if (mode === 'work') setPomodoroCount((c) => c + 1)
            setActiveSessionId(null)
            return 0
          }
          return t - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning, activeSessionId, mode, refreshSessions])

  function switchMode(m: ModeKey) {
    if (isRunning) return
    setMode(m)
    setTimeLeft(MODES[m].minutes * 60)
    elapsedRef.current = 0
    setActiveSessionId(null)
  }

  function handleStart() {
    if (isRunning) {
      setIsRunning(false)
      if (activeSessionId) {
        fetch(`/api/focus/sessions/${activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'paused', elapsed_seconds: elapsedRef.current }),
        }).catch(() => {})
      }
    } else {
      if (!activeSessionId) {
        elapsedRef.current = 0
        fetch('/api/focus/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: sessionLabel,
            duration_minutes: MODES[mode].minutes,
            pomodoro_type: mode,
            ...(selectedBlockId ? { time_block_id: selectedBlockId } : {}),
          }),
        })
          .then((r) => (r.ok ? (r.json() as Promise<{ session: FocusSession }>) : null))
          .then((data) => {
            if (data) setActiveSessionId(data.session.id)
          })
          .catch(() => {})
      } else {
        fetch(`/api/focus/sessions/${activeSessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        }).catch(() => {})
      }
      setIsRunning(true)
    }
  }

  function handleReset() {
    setIsRunning(false)
    setTimeLeft(MODES[mode].minutes * 60)
    elapsedRef.current = 0
    if (activeSessionId) {
      fetch(`/api/focus/sessions/${activeSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'abandoned', elapsed_seconds: elapsedRef.current }),
      })
        .then(() => refreshSessions())
        .catch(() => {})
      setActiveSessionId(null)
    }
  }

  function captureLoop() {
    if (!loopInput.trim()) return
    setLoopCapturing(true)
    fetch('/api/focus/open-loops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: loopInput.trim() }),
    })
      .then(() => {
        setLoopInput('')
        refreshLoops()
      })
      .catch(() => {})
      .finally(() => setLoopCapturing(false))
  }

  function resolveLoop(id: string, newStatus: 'resolved' | 'dismissed') {
    fetch(`/api/focus/open-loops/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
      .then(() => refreshLoops())
      .catch(() => {})
  }

  function addBlock() {
    if (!blockLabel.trim() || blockEndHour <= blockStartHour) return
    setBlockSaving(true)
    fetch('/api/focus/time-blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: blockLabel.trim(),
        start_hour: blockStartHour,
        end_hour: blockEndHour,
        color: blockColor,
        pomodoros_planned: blockPomodoros,
      }),
    })
      .then(() => {
        setBlockLabel('')
        setBlockPomodoros(0)
        setShowBlockForm(false)
        refreshBlocks()
      })
      .catch(() => {})
      .finally(() => setBlockSaving(false))
  }

  function deleteBlock(id: string) {
    fetch(`/api/focus/time-blocks/${id}`, { method: 'DELETE' })
      .then(() => refreshBlocks())
      .catch(() => {})
  }

  const totalSeconds = MODES[mode].minutes * 60
  const strokeDashoffset = RING_CIRC * (timeLeft / totalSeconds)
  const accent = MODES[mode].accent
  const workDone = todaySessions.filter(
    (s) => s.pomodoro_type === 'work' && s.status === 'completed'
  ).length
  const dotsInSet = pomodoroCount % 4

  return (
    <div className="min-h-screen p-6" style={{ background: 'var(--surface-base)' }}>
      <h1 className="mb-6 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        Focus
      </h1>

      <div className="gap-6" style={{ display: 'grid', gridTemplateColumns: '1fr 320px 280px' }}>
        {/* Timer */}
        <div className="rounded-lg p-6" style={{ background: 'var(--surface-card)' }}>
          <div className="mb-6 flex gap-2">
            {(Object.keys(MODES) as ModeKey[]).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                disabled={isRunning}
                className="rounded px-3 py-1 text-xs font-medium transition-all"
                style={{
                  background: mode === m ? accent : 'var(--surface-muted)',
                  color: mode === m ? '#000' : 'var(--text-secondary)',
                  opacity: isRunning && mode !== m ? 0.4 : 1,
                }}
              >
                {MODES[m].label}
              </button>
            ))}
          </div>

          <div className="mb-6 flex flex-col items-center">
            <svg width="200" height="200" className="mb-2">
              <circle
                cx="100"
                cy="100"
                r={RING_R}
                fill="none"
                stroke="var(--surface-muted)"
                strokeWidth="8"
              />
              <circle
                cx="100"
                cy="100"
                r={RING_R}
                fill="none"
                stroke={accent}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={RING_CIRC}
                strokeDashoffset={strokeDashoffset}
                style={{
                  transform: 'rotate(-90deg)',
                  transformOrigin: '100px 100px',
                  transition: 'stroke-dashoffset 0.5s linear',
                }}
              />
              <text
                x="100"
                y="108"
                textAnchor="middle"
                fontSize="36"
                fontWeight="600"
                fill="var(--text-primary)"
              >
                {fmt(timeLeft)}
              </text>
            </svg>

            <div className="mb-3 flex gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-3 w-3 rounded-full"
                  style={{ background: i < dotsInSet ? accent : 'var(--surface-muted)' }}
                />
              ))}
            </div>

            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {workDone} pomodoro{workDone !== 1 ? 's' : ''} completed today
            </p>
          </div>

          <input
            value={sessionLabel}
            onChange={(e) => setSessionLabel(e.target.value)}
            disabled={isRunning}
            placeholder="Session label..."
            className="mb-3 w-full rounded px-3 py-2 text-sm"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              outline: 'none',
            }}
          />

          {timeBlocks.length > 0 && (
            <select
              value={selectedBlockId ?? ''}
              onChange={(e) => setSelectedBlockId(e.target.value || null)}
              disabled={isRunning}
              className="mb-3 w-full rounded px-3 py-2 text-sm"
              style={{
                background: 'var(--surface-muted)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                outline: 'none',
              }}
            >
              <option value="">No time block</option>
              {timeBlocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.start_hour}:00–{b.end_hour}:00 {b.label}
                </option>
              ))}
            </select>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleStart}
              className="flex-1 rounded py-3 text-sm font-semibold"
              style={{ background: accent, color: '#000' }}
            >
              {isRunning ? 'PAUSE' : activeSessionId ? 'RESUME' : 'START'}
            </button>
            <button
              onClick={handleReset}
              className="rounded px-4 py-3 text-sm"
              style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)' }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Open Loops */}
        <div className="rounded-lg p-5" style={{ background: 'var(--surface-card)' }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Open Loops
            </h2>
            {openLoops.length > 0 && (
              <span
                className="rounded-full px-2 py-0.5 text-xs"
                style={{ background: 'var(--surface-muted)', color: 'var(--text-secondary)' }}
              >
                {openLoops.length}
              </span>
            )}
          </div>

          <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Capture anything pulling at your attention
          </p>

          <textarea
            value={loopInput}
            onChange={(e) => setLoopInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                captureLoop()
              }
            }}
            placeholder="What's on your mind?"
            rows={2}
            className="mb-2 w-full resize-none rounded px-3 py-2 text-sm"
            style={{
              background: 'var(--surface-muted)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              outline: 'none',
            }}
          />
          <button
            onClick={captureLoop}
            disabled={loopCapturing || !loopInput.trim()}
            className="mb-4 w-full rounded py-2 text-xs font-medium"
            style={{
              background: loopInput.trim() ? accent : 'var(--surface-muted)',
              color: loopInput.trim() ? '#000' : 'var(--text-secondary)',
            }}
          >
            Capture
          </button>

          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '340px' }}>
            {openLoops.length === 0 && (
              <p className="py-4 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                Clear mind — no open loops
              </p>
            )}
            {openLoops.map((loop) => (
              <div
                key={loop.id}
                className="flex items-start gap-2 rounded p-2"
                style={{ background: 'var(--surface-muted)' }}
              >
                <p className="flex-1 text-xs" style={{ color: 'var(--text-primary)' }}>
                  {loop.text}
                </p>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => resolveLoop(loop.id, 'resolved')}
                    className="flex h-6 w-6 items-center justify-center rounded text-xs"
                    style={{ background: '#4ade8022', color: '#4ade80' }}
                    title="Resolve"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => resolveLoop(loop.id, 'dismissed')}
                    className="flex h-6 w-6 items-center justify-center rounded text-xs"
                    style={{ background: 'var(--surface-base)', color: 'var(--text-secondary)' }}
                    title="Dismiss"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Time Blocks */}
        <div className="rounded-lg p-5" style={{ background: 'var(--surface-card)' }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {"Today's Blocks"}
            </h2>
            <button
              onClick={() => setShowBlockForm((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded text-sm font-bold"
              style={{ background: 'var(--color-accent-gold)', color: '#000' }}
              title="Add block"
            >
              +
            </button>
          </div>

          {showBlockForm && (
            <div
              className="mb-4 space-y-2 rounded p-3"
              style={{ background: 'var(--surface-muted)' }}
            >
              <input
                value={blockLabel}
                onChange={(e) => setBlockLabel(e.target.value)}
                placeholder="Block label"
                className="w-full rounded px-2 py-1 text-xs"
                style={{
                  background: 'var(--surface-base)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  outline: 'none',
                }}
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label
                    className="mb-0.5 block text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Start
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={blockStartHour}
                    onChange={(e) => setBlockStartHour(Number(e.target.value))}
                    className="w-full rounded px-2 py-1 text-xs"
                    style={{
                      background: 'var(--surface-base)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      outline: 'none',
                    }}
                  />
                </div>
                <div className="flex-1">
                  <label
                    className="mb-0.5 block text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    End
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={blockEndHour}
                    onChange={(e) => setBlockEndHour(Number(e.target.value))}
                    className="w-full rounded px-2 py-1 text-xs"
                    style={{
                      background: 'var(--surface-base)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
              <div className="flex items-end gap-2">
                <div>
                  <label
                    className="mb-0.5 block text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Color
                  </label>
                  <input
                    type="color"
                    value={blockColor}
                    onChange={(e) => setBlockColor(e.target.value)}
                    className="h-7 w-8 cursor-pointer rounded"
                    style={{ border: 'none', padding: 0 }}
                  />
                </div>
                <div className="flex-1">
                  <label
                    className="mb-0.5 block text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Pomodoros planned
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={16}
                    value={blockPomodoros}
                    onChange={(e) => setBlockPomodoros(Number(e.target.value))}
                    className="w-full rounded px-2 py-1 text-xs"
                    style={{
                      background: 'var(--surface-base)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
              <button
                onClick={addBlock}
                disabled={blockSaving || !blockLabel.trim() || blockEndHour <= blockStartHour}
                className="w-full rounded py-1.5 text-xs font-medium"
                style={{ background: 'var(--color-accent-gold)', color: '#000' }}
              >
                {blockSaving ? 'Saving...' : 'Add Block'}
              </button>
            </div>
          )}

          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '400px' }}>
            {timeBlocks.length === 0 && (
              <p className="py-4 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                No blocks planned — add one above
              </p>
            )}
            {timeBlocks.map((b) => (
              <div
                key={b.id}
                className="flex items-start gap-2 rounded p-2"
                style={{ background: 'var(--surface-muted)', borderLeft: `3px solid ${b.color}` }}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-xs font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {b.label}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {b.start_hour}:00–{b.end_hour}:00
                    {b.pomodoros_planned > 0 && ` · ${b.pomodoros_planned} pomodoros`}
                  </p>
                </div>
                <button
                  onClick={() => deleteBlock(b.id)}
                  className="shrink-0 text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
