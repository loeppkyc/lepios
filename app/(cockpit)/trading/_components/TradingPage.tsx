'use client'

import { useEffect, useState, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { TradeRow, PredictionRow } from '@/lib/trading/types'
import { TradeForm } from './TradeForm'
import { AIEngineTab } from './AIEngineTab'
import { StatsTab } from './StatsTab'

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

// Settle form inline component
function SettleInline({
  trade,
  onSettle,
  onCancel,
}: {
  trade: TradeRow
  onSettle: () => void
  onCancel: () => void
}) {
  const [dateOut, setDateOut] = useState(new Date().toISOString().slice(0, 10))
  const [priceOut, setPriceOut] = useState('')
  const [stoppedOut, setStoppedOut] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!priceOut) {
      setErr('Exit price required')
      return
    }
    setSaving(true)
    setErr('')
    try {
      const res = await fetch(`/api/trades/${trade.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date_out: dateOut,
          price_out: parseFloat(priceOut),
          stopped_out: stoppedOut,
        }),
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        setErr(d.error ?? 'Failed to settle')
        return
      }
      onSettle()
    } catch {
      setErr('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-2 flex flex-wrap items-end gap-2 rounded bg-[var(--color-surface-2)] px-3 py-2"
    >
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-[var(--color-text-disabled)]">Exit Date</label>
        <input
          type="date"
          value={dateOut}
          onChange={(e) => setDateOut(e.target.value)}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="text-[10px] text-[var(--color-text-disabled)]">Exit Price</label>
        <input
          type="number"
          step="any"
          placeholder="4820.00"
          value={priceOut}
          onChange={(e) => setPriceOut(e.target.value)}
          className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
        />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
        <input
          type="checkbox"
          checked={stoppedOut}
          onChange={(e) => setStoppedOut(e.target.checked)}
        />
        Stopped out
      </label>
      {err && <span className="text-[10px] text-red-400">{err}</span>}
      <button
        type="submit"
        disabled={saving}
        className="rounded bg-[var(--color-pillar-money)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {saving ? 'Settling...' : 'Settle'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[10px] text-[var(--color-text-disabled)] hover:text-[var(--color-text-secondary)]"
      >
        cancel
      </button>
    </form>
  )
}

export function TradingPage() {
  const [trades, setTrades] = useState<TradeRow[]>([])
  const [todayPredictions, setTodayPredictions] = useState<PredictionRow[]>([])
  const [pendingPredictions, setPendingPredictions] = useState<PredictionRow[]>([])
  const [tradesLoading, setTradesLoading] = useState(true)
  const [predsLoading, setPredsLoading] = useState(true)
  const [settlingId, setSettlingId] = useState<string | null>(null)

  // Pre-fill state for "Use This Pick"
  const [prefill, setPrefill] = useState<{
    ticker?: string
    direction?: 'long' | 'short'
    entryPrice?: number
    stopPrice?: number
    predictionId?: string
  }>({})
  const [activeTab, setActiveTab] = useState('journal')
  const [prefillKey, setPrefillKey] = useState(0)
  // Bump to trigger re-fetch without useEffect setState-in-effect rule
  const [tradesTick, setTradesTick] = useState(0)
  const [predsTick, setPredsTick] = useState(0)

  const today = new Date().toISOString().slice(0, 10)

  const loadTrades = useCallback(() => setTradesTick((n) => n + 1), [])
  const loadPredictions = useCallback(() => setPredsTick((n) => n + 1), [])

  // Fetch trades when tick changes (initial mount = tick 0)
  useEffect(() => {
    let cancelled = false
    setTradesLoading(true) // eslint-disable-line react-hooks/set-state-in-effect -- loading flag before async fetch
    fetch('/api/trades?limit=50')
      .then((res) => (res.ok ? (res.json() as Promise<{ trades: TradeRow[] }>) : null))
      .then((data) => {
        if (!cancelled && data) setTrades(data.trades ?? [])
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => {
        if (!cancelled) setTradesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tradesTick])

  // Fetch predictions when tick changes (initial mount = tick 0)
  useEffect(() => {
    let cancelled = false
    setPredsLoading(true) // eslint-disable-line react-hooks/set-state-in-effect -- loading flag before async fetch
    fetch('/api/predictions?domain=trading&resolved=false&limit=50')
      .then((res) => (res.ok ? (res.json() as Promise<{ predictions: PredictionRow[] }>) : null))
      .then((data) => {
        if (!cancelled && data) {
          const all = data.predictions ?? []
          setTodayPredictions(all.filter((p) => p.pick_date === today))
          setPendingPredictions(all.filter((p) => p.pick_date < today))
        }
      })
      .catch(() => {
        /* silent */
      })
      .finally(() => {
        if (!cancelled) setPredsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [predsTick, today])

  function handleUsePick(p: PredictionRow) {
    setPrefill({
      ticker: p.ticker ?? undefined,
      direction: p.direction ?? undefined,
      entryPrice: p.entry_price ?? undefined,
      stopPrice: p.stop_price ?? undefined,
      predictionId: p.id,
    })
    setPrefillKey((k) => k + 1)
    setActiveTab('journal')
  }

  async function handleSettlePrediction(id: string, won: boolean, pnl?: number) {
    try {
      await fetch(`/api/predictions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ won, actual_pnl: pnl }),
      })
      await loadPredictions()
    } catch {
      // silent
    }
  }

  const recentTrades = trades.slice(0, 30)
  const todayTrades = trades.filter((t) => t.trade_date === today)

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">Trading Journal</h1>
        <p className="mt-0.5 text-[length:var(--text-small)] text-[var(--color-text-disabled)]">
          Paper mode — log trades, view AI picks, track performance
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="ai-engine">AI Engine</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="backtest">Backtest</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Journal ──────────────────────────────────────────────── */}
        <TabsContent value="journal">
          <div className="flex flex-col gap-6">
            {/* Log Trade form */}
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
              <h3 className="label-caps mb-4 text-[var(--color-pillar-money)]">Log Trade</h3>
              <TradeForm
                key={prefillKey}
                todayPredictions={todayPredictions}
                prefillTicker={prefill.ticker}
                prefillDirection={prefill.direction}
                prefillEntryPrice={prefill.entryPrice}
                prefillStopPrice={prefill.stopPrice}
                prefillPredictionId={prefill.predictionId}
                onSuccess={() => {
                  setPrefill({})
                  loadTrades()
                }}
              />
            </div>

            {/* Trade list */}
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="label-caps text-[var(--color-text-secondary)]">Recent Trades</h3>
                {todayTrades.length > 0 && (
                  <span className="text-xs text-[var(--color-text-disabled)]">
                    {todayTrades.length} today
                  </span>
                )}
              </div>

              {tradesLoading ? (
                <p className="text-xs text-[var(--color-text-disabled)]">Loading...</p>
              ) : recentTrades.length === 0 ? (
                <p className="text-xs text-[var(--color-text-disabled)]">
                  No trades yet. Log one above.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {recentTrades.map((t) => (
                    <TradeRow
                      key={t.id}
                      trade={t}
                      isSettling={settlingId === t.id}
                      onSettleClick={() => setSettlingId((cur) => (cur === t.id ? null : t.id))}
                      onSettled={() => {
                        setSettlingId(null)
                        void loadTrades()
                      }}
                      onCancelSettle={() => setSettlingId(null)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab 2: AI Engine ────────────────────────────────────────────── */}
        <TabsContent value="ai-engine">
          <AIEngineTab
            todayPredictions={todayPredictions}
            loading={predsLoading}
            onUsePick={handleUsePick}
            onSettle={handleSettlePrediction}
            pendingPredictions={pendingPredictions}
          />
        </TabsContent>

        {/* ── Tab 3: Stats ────────────────────────────────────────────────── */}
        <TabsContent value="stats">
          {tradesLoading ? (
            <p className="text-xs text-[var(--color-text-disabled)]">Loading...</p>
          ) : (
            <StatsTab trades={trades} />
          )}
        </TabsContent>

        {/* ── Tab 4: Backtest (v1 stub) ───────────────────────────────────── */}
        <TabsContent value="backtest">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8 text-center">
            <p className="text-[length:var(--text-small)] font-medium text-[var(--color-text-secondary)]">
              Backtest coming in Sprint 8
            </p>
            <p className="mt-2 text-xs text-[var(--color-text-disabled)]">
              Will replay 40 days of historical data against the AI Pick scoring algorithm — no
              future peeking, strict chronological order.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Trade row component ───────────────────────────────────────────────────────

function TradeRow({
  trade: t,
  isSettling,
  onSettleClick,
  onSettled,
  onCancelSettle,
}: {
  trade: TradeRow
  isSettling: boolean
  onSettleClick: () => void
  onSettled: () => void
  onCancelSettle: () => void
}) {
  const settled = t.dollar_pnl != null
  const won = (t.dollar_pnl ?? 0) > 0
  const lost = settled && !won

  const rowBg = settled
    ? won
      ? 'border-green-900/40 bg-green-900/10'
      : lost
        ? 'border-red-900/40 bg-red-900/10'
        : 'border-gray-700/50 bg-[var(--color-surface)]'
    : 'border-[var(--color-border)] bg-[var(--color-surface)]'

  return (
    <div className={`rounded border px-3 py-2 ${rowBg}`}>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-[var(--color-text-disabled)]">{t.trade_date}</span>
        <span className="font-semibold text-[var(--color-text-primary)]">{t.ticker}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
            t.direction === 'long' ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {t.direction.toUpperCase()}
        </span>
        {t.mood && (
          <span title={t.mood} className="text-base leading-none">
            {MOOD_EMOJIS[t.mood] ?? t.mood}
          </span>
        )}

        {/* Entry → Stop → Target */}
        <span className="text-[var(--color-text-disabled)]">
          {t.price_in.toFixed(2)}
          <span className="mx-0.5 text-[var(--color-border)]">→</span>
          <span className="text-red-400">{t.stop_loss.toFixed(2)}</span>
          <span className="mx-0.5 text-[var(--color-border)]">→</span>
          <span className="text-green-400">{t.take_profit.toFixed(2)}</span>
        </span>

        {/* Exit price */}
        {t.price_out != null && (
          <span className="text-[var(--color-text-primary)]">
            Exit: {t.price_out.toFixed(2)}
            {t.stopped_out && (
              <span className="ml-1 text-yellow-500" title="Stopped out">
                ⚠
              </span>
            )}
          </span>
        )}

        {/* P&L + R */}
        {settled && (
          <>
            <span className={`font-medium ${won ? 'text-green-400' : 'text-red-400'}`}>
              {(t.dollar_pnl ?? 0) >= 0 ? '+' : ''}${t.dollar_pnl?.toFixed(2)}
            </span>
            {t.r_multiple != null && (
              <span className="text-[var(--color-text-disabled)]">
                {t.r_multiple >= 0 ? '+' : ''}
                {t.r_multiple.toFixed(2)}R
              </span>
            )}
          </>
        )}

        {/* Settle button */}
        {!settled && (
          <button
            type="button"
            onClick={onSettleClick}
            className="ml-auto rounded bg-[var(--color-surface-2)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            {isSettling ? 'Cancel' : 'Settle'}
          </button>
        )}
      </div>

      {isSettling && <SettleInline trade={t} onSettle={onSettled} onCancel={onCancelSettle} />}
    </div>
  )
}
