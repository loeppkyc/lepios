'use client'

import { useState, useEffect, useRef } from 'react'

const SIZE = 128
const R = 48
const CX = 64
const CY = 64
const CIRC = 2 * Math.PI * R

function useCountUp(target: number, duration = 900) {
  const [display, setDisplay] = useState(target)
  const prevRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (target === prevRef.current) return
    const start = prevRef.current
    const startTime = performance.now()
    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(start + (target - start) * eased))
      if (t < 1) rafRef.current = requestAnimationFrame(animate)
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
    prevRef.current = target
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration])

  return display
}

function gaugeStroke(value: number | null, inverted: boolean): string {
  if (value == null) return '#1e1e30'
  const v = inverted ? 100 - value : value
  if (v >= 80) return 'var(--color-positive)'
  if (v >= 60) return 'var(--color-warning)'
  return 'var(--color-critical)'
}

function gaugeTextClass(value: number | null, inverted: boolean): string {
  if (value == null) return 'text-muted-foreground'
  const v = inverted ? 100 - value : value
  if (v >= 80) return 'text-positive'
  if (v >= 60) return 'text-warning'
  return 'text-critical'
}

interface GaugePressureProps {
  label: string
  value: number | null
  sublabel?: string
  note?: string
  inverted?: boolean
}

export function GaugePressure({
  label,
  value,
  sublabel,
  note,
  inverted = false,
}: GaugePressureProps) {
  const display = useCountUp(Math.round(value ?? 0))
  const fillPct = value != null ? Math.min(Math.max(value / 100, 0), 1) : 0
  const fill = CIRC * fillPct
  const gap = CIRC - fill
  const stroke = gaugeStroke(value, inverted)
  const textCls = gaugeTextClass(value, inverted)

  return (
    <div className="flex min-w-[128px] flex-col items-center gap-2.5">
      <div className="relative h-32 w-32">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1e1e30" strokeWidth={11} />
          {value != null && fill > 0 && (
            <circle
              cx={CX}
              cy={CY}
              r={R}
              fill="none"
              stroke={stroke}
              strokeWidth={11}
              strokeLinecap="butt"
              strokeDasharray={`${fill} ${gap}`}
              transform={`rotate(-90 ${CX} ${CY})`}
              className="gauge-arc"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className={`font-mono text-[1.1rem] leading-none font-bold ${textCls}`}>
            {value != null ? `${display}%` : '—'}
          </span>
          {sublabel && (
            <span className="text-muted-foreground text-center font-sans text-[0.55rem] leading-tight tracking-wider uppercase">
              {sublabel}
            </span>
          )}
        </div>
      </div>
      <span className={`font-sans text-[0.78rem] font-semibold ${textCls}`}>{label}</span>
      {note && (
        <span className="text-muted-foreground text-center font-sans text-[0.65rem] leading-tight">
          {note}
        </span>
      )}
    </div>
  )
}
