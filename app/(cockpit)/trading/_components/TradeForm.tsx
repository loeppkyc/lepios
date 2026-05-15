'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { INSTRUMENTS, MOOD_VALUES, ALL_INSTRUMENTS } from '@/lib/trading/types'
import type { PredictionRow, TradeInsert } from '@/lib/trading/types'

interface TradeFormProps {
  todayPredictions: PredictionRow[]
  prefillTicker?: string
  prefillDirection?: 'long' | 'short'
  prefillEntryPrice?: number
  prefillStopPrice?: number
  prefillPredictionId?: string
  onSuccess: () => void
}

const MOOD_EMOJIS: Record<string, string> = {
  Calm: '😌',
  Confident: '😎',
  Casual: '🙂',
  Eager: '🔥',
  Excited: '🚀',
  Tired: '😴',
  Anxious: '😰',
  Panicky: '😱',
  Stubborn: '😤',
  Emotional: '😢',
  Other: '🤷',
  Neutral: '😐',
}

export function TradeForm({
  todayPredictions,
  prefillTicker,
  prefillDirection,
  prefillEntryPrice,
  prefillStopPrice,
  prefillPredictionId,
  onSuccess,
}: TradeFormProps) {
  const today = new Date().toISOString().slice(0, 10)

  const [ticker, setTicker] = useState(prefillTicker ?? '')
  const [direction, setDirection] = useState<'long' | 'short'>(prefillDirection ?? 'long')
  const [priceIn, setPriceIn] = useState(prefillEntryPrice ? String(prefillEntryPrice) : '')
  const [stopLoss, setStopLoss] = useState(prefillStopPrice ? String(prefillStopPrice) : '')
  const [takeProfit, setTakeProfit] = useState('')
  const [positionSize, setPositionSize] = useState('1')
  const [horizon, setHorizon] = useState<'day' | 'swing'>('day')
  const [mood, setMood] = useState('')
  const [comments, setComments] = useState('')
  const [predictionId, setPredictionId] = useState(prefillPredictionId ?? '')
  const [tradeDate, setTradeDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  // Live R:R preview
  const rr = (() => {
    const entry = parseFloat(priceIn)
    const stop = parseFloat(stopLoss)
    const target = parseFloat(takeProfit)
    if (!entry || !stop || !target) return null
    const risk = Math.abs(entry - stop)
    const reward = Math.abs(target - entry)
    if (risk === 0) return null
    return (reward / risk).toFixed(2)
  })()

  // Infer instrument type from ticker
  const instrumentType = (() => {
    const inst = ALL_INSTRUMENTS.find((i) => i.ticker === ticker)
    return inst?.type ?? 'stock'
  })()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ticker || !priceIn || !stopLoss || !takeProfit) {
      setErr('Ticker, entry price, stop, and target are required.')
      return
    }
    setSaving(true)
    setErr('')

    const body: TradeInsert = {
      trade_date: tradeDate,
      mode: 'paper',
      horizon,
      direction,
      ticker,
      instrument_type:
        instrumentType === 'commodity'
          ? 'commodity'
          : instrumentType === 'future'
            ? 'future'
            : 'stock',
      price_in: parseFloat(priceIn),
      stop_loss: parseFloat(stopLoss),
      take_profit: parseFloat(takeProfit),
      position_size: parseFloat(positionSize) || 1,
      mood: mood || undefined,
      comments: comments || undefined,
      prediction_id: predictionId || undefined,
    }

    try {
      const res = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setErr(data.error ?? 'Failed to save trade')
        return
      }
      // Reset form
      setTicker('')
      setPriceIn('')
      setStopLoss('')
      setTakeProfit('')
      setPositionSize('1')
      setMood('')
      setComments('')
      setPredictionId('')
      onSuccess()
    } catch {
      setErr('Network error — could not save trade')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Row 1: Date + Horizon + Mode badge */}
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Date
          </Label>
          <Input
            type="date"
            value={tradeDate}
            onChange={(e) => setTradeDate(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Horizon
          </Label>
          <div className="flex gap-1">
            {(['day', 'swing'] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                  horizon === h
                    ? 'bg-[var(--color-pillar-money)] text-white'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
                }`}
              >
                {h.charAt(0).toUpperCase() + h.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end">
          <span className="rounded border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-disabled)]">
            PAPER MODE
          </span>
        </div>
      </div>

      {/* Row 2: Instrument + Direction */}
      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[180px] flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Instrument
          </Label>
          <Select value={ticker} onValueChange={setTicker}>
            <SelectTrigger>
              <SelectValue placeholder="Select instrument" />
            </SelectTrigger>
            <SelectContent>
              <div className="px-2 py-1 text-[10px] font-semibold tracking-wide text-[var(--color-text-disabled)] uppercase">
                Futures
              </div>
              {INSTRUMENTS.futures.map((i) => (
                <SelectItem key={i.ticker} value={i.ticker}>
                  {i.name}
                </SelectItem>
              ))}
              <div className="mt-1 px-2 py-1 text-[10px] font-semibold tracking-wide text-[var(--color-text-disabled)] uppercase">
                Stocks
              </div>
              {INSTRUMENTS.stocks.map((i) => (
                <SelectItem key={i.ticker} value={i.ticker}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Direction
          </Label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setDirection('long')}
              className={`rounded px-4 py-1.5 text-xs font-semibold transition-colors ${
                direction === 'long'
                  ? 'bg-green-600 text-white'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
              }`}
            >
              LONG
            </button>
            <button
              type="button"
              onClick={() => setDirection('short')}
              className={`rounded px-4 py-1.5 text-xs font-semibold transition-colors ${
                direction === 'short'
                  ? 'bg-red-600 text-white'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
              }`}
            >
              SHORT
            </button>
          </div>
        </div>
      </div>

      {/* Row 3: Price In / Stop Loss / Take Profit + R:R preview */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Entry Price
          </Label>
          <Input
            type="number"
            step="any"
            placeholder="4800.00"
            value={priceIn}
            onChange={(e) => setPriceIn(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Stop Loss
          </Label>
          <Input
            type="number"
            step="any"
            placeholder="4780.00"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Target
          </Label>
          <Input
            type="number"
            step="any"
            placeholder="4860.00"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Size
          </Label>
          <Input
            type="number"
            min="1"
            step="1"
            value={positionSize}
            onChange={(e) => setPositionSize(e.target.value)}
            className="w-20"
          />
        </div>
        {rr && (
          <div className="flex items-center rounded bg-[var(--color-surface-2)] px-3 py-1.5">
            <span className="text-xs text-[var(--color-text-disabled)]">R:R</span>
            <span className="ml-2 text-sm font-semibold text-[var(--color-pillar-money)]">
              1 : {rr}
            </span>
          </div>
        )}
      </div>

      {/* Row 4: Mood picker */}
      <div className="flex flex-col gap-1">
        <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
          Mood
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {MOOD_VALUES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMood(mood === m ? '' : m)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                mood === m
                  ? 'bg-[var(--color-pillar-money)]/20 text-[var(--color-pillar-money)] ring-1 ring-[var(--color-pillar-money)]'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
              }`}
            >
              {MOOD_EMOJIS[m]} {m}
            </button>
          ))}
        </div>
      </div>

      {/* Row 5: Link to AI pick */}
      {todayPredictions.length > 0 && (
        <div className="flex flex-col gap-1">
          <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
            Link to AI Pick (optional)
          </Label>
          <Select value={predictionId} onValueChange={setPredictionId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select an AI pick..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">None</SelectItem>
              {todayPredictions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.ticker} {p.direction?.toUpperCase()} — Grade {p.grade}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Row 6: Comments */}
      <div className="flex flex-col gap-1">
        <Label className="text-[length:var(--text-nano)] text-[var(--color-text-disabled)]">
          Comments (optional)
        </Label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          rows={2}
          placeholder="Setup notes, why you took this trade..."
          className="resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] focus:ring-1 focus:ring-[var(--color-pillar-money)] focus:outline-none"
        />
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      <Button
        type="submit"
        disabled={saving}
        className="w-fit bg-[var(--color-pillar-money)] text-white hover:bg-[var(--color-pillar-money)]/90"
      >
        {saving ? 'Saving...' : 'Log Trade'}
      </Button>
    </form>
  )
}
