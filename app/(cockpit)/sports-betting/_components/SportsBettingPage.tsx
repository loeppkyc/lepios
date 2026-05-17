'use client'

import { useState, useCallback, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Game } from '@/lib/sports/odds'
import { formatAmerican, americanToImpliedProb } from '@/lib/sports/odds'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BetRow {
  id: string
  bet_date: string
  sport: string | null
  league: string | null
  home_team: string | null
  away_team: string | null
  bet_on: string | null
  bet_type: string | null
  odds: number
  implied_prob: number | null
  kelly_pct: number | null
  stake: number | null
  result: string | null
  pnl: number | null
  bankroll_after: number | null
  book: string | null
  created_at: string
}

interface OddsResponse {
  games: Game[]
  total: number
  is_demo: boolean
}

interface SettleForm {
  betId: string
  result: 'win' | 'loss' | 'push'
  pnl: string
  bankroll_after: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resultBadge(result: string | null) {
  if (!result || result === 'pending') {
    return (
      <Badge variant="outline" className="text-xs text-[var(--color-text-disabled)]">
        Pending
      </Badge>
    )
  }
  const map: Record<string, string> = {
    win: 'bg-green-900/50 text-green-300 hover:bg-green-900/60',
    loss: 'bg-red-900/50 text-red-300 hover:bg-red-900/60',
    push: 'bg-yellow-900/50 text-yellow-300 hover:bg-yellow-900/60',
    void: 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]',
  }
  return (
    <Badge className={`text-xs ${map[result] ?? ''}`}>
      {result.charAt(0).toUpperCase() + result.slice(1)}
    </Badge>
  )
}

function fmtPnl(pnl: number | null) {
  if (pnl == null) return '—'
  const sign = pnl >= 0 ? '+' : ''
  return (
    <span className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
      {sign}${pnl.toFixed(2)}
    </span>
  )
}

function computeStats(bets: BetRow[]) {
  const settled = bets.filter((b) => b.result && b.result !== 'pending' && b.result !== 'void')
  const wins = settled.filter((b) => b.result === 'win').length
  const totalPnl = bets.reduce((sum, b) => sum + (b.pnl ?? 0), 0)
  const totalStaked = bets.reduce((sum, b) => sum + (b.stake ?? 0), 0)
  const roi = totalStaked > 0 ? (totalPnl / totalStaked) * 100 : 0
  return {
    total: bets.length,
    settled: settled.length,
    wins,
    winRate: settled.length > 0 ? (wins / settled.length) * 100 : 0,
    totalPnl,
    roi,
  }
}

// ── Log Bet Form ──────────────────────────────────────────────────────────────

interface LogBetFormProps {
  prefill?: Partial<{
    sport: string
    league: string
    home_team: string
    away_team: string
    bet_on: string
    odds: number
  }>
  onLogged: (bet: BetRow) => void
  onCancel: () => void
}

function LogBetForm({ prefill, onLogged, onCancel }: LogBetFormProps) {
  const [betDate, setBetDate] = useState(new Date().toISOString().slice(0, 10))
  const [sport, setSport] = useState(prefill?.sport ?? '')
  const [league, setLeague] = useState(prefill?.league ?? '')
  const [homeTeam, setHomeTeam] = useState(prefill?.home_team ?? '')
  const [awayTeam, setAwayTeam] = useState(prefill?.away_team ?? '')
  const [betOn, setBetOn] = useState(prefill?.bet_on ?? '')
  const [betType, setBetType] = useState('moneyline')
  const [odds, setOdds] = useState(prefill?.odds?.toString() ?? '')
  const [stake, setStake] = useState('')
  const [book, setBook] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const impliedProb = odds ? americanToImpliedProb(parseInt(odds, 10)) : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!odds || !stake) {
      setErr('Odds and stake are required')
      return
    }
    setSaving(true)
    setErr('')
    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bet_date: betDate,
          sport: sport || undefined,
          league: league || undefined,
          home_team: homeTeam || undefined,
          away_team: awayTeam || undefined,
          bet_on: betOn || undefined,
          bet_type: betType,
          odds: parseInt(odds, 10),
          stake: parseFloat(stake),
          book: book || undefined,
        }),
      })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        throw new Error(d.error ?? `HTTP ${res.status}`)
      }
      const { bet } = (await res.json()) as { bet: BetRow }
      onLogged(bet)
    } catch (err) {
      setErr(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Log a Bet</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
        >
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={betDate}
              onChange={(e) => setBetDate(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sport</Label>
            <Input
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              placeholder="NHL"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">League</Label>
            <Input
              value={league}
              onChange={(e) => setLeague(e.target.value)}
              placeholder="NHL"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={betType} onValueChange={setBetType}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="moneyline">Moneyline</SelectItem>
                <SelectItem value="spread">Spread</SelectItem>
                <SelectItem value="over_under">Over/Under</SelectItem>
                <SelectItem value="parlay">Parlay</SelectItem>
                <SelectItem value="prop">Prop</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Home Team</Label>
            <Input
              value={homeTeam}
              onChange={(e) => setHomeTeam(e.target.value)}
              placeholder="Oilers"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Away Team</Label>
            <Input
              value={awayTeam}
              onChange={(e) => setAwayTeam(e.target.value)}
              placeholder="Flames"
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Bet On</Label>
            <Input
              value={betOn}
              onChange={(e) => setBetOn(e.target.value)}
              placeholder="Oilers ML"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Odds (American)</Label>
            <Input
              type="number"
              value={odds}
              onChange={(e) => setOdds(e.target.value)}
              placeholder="-150"
              className="h-8 text-xs"
              required
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Stake ($)</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              placeholder="25.00"
              className="h-8 text-xs"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Sportsbook</Label>
            <Input
              value={book}
              onChange={(e) => setBook(e.target.value)}
              placeholder="Bet365"
              className="h-8 text-xs"
            />
          </div>
          {impliedProb != null && (
            <div className="flex items-end pb-1">
              <p className="text-xs text-[var(--color-text-muted)]">
                Implied:{' '}
                <strong className="text-[var(--color-text-primary)]">
                  {impliedProb.toFixed(1)}%
                </strong>
              </p>
            </div>
          )}
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}
        <div className="flex justify-end">
          <Button type="submit" size="sm" className="text-xs" disabled={saving}>
            {saving ? 'Logging…' : 'Log Bet'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ── Settle Form ────────────────────────────────────────────────────────────────

function SettleRow({ bet, onSettled }: { bet: BetRow; onSettled: (updated: BetRow) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<SettleForm>({
    betId: bet.id,
    result: 'win',
    pnl: bet.stake
      ? (bet.stake * (bet.odds > 0 ? bet.odds / 100 : 100 / Math.abs(bet.odds))).toFixed(2)
      : '',
    bankroll_after: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSettle(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      const res = await fetch(`/api/bets/${bet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result: form.result,
          pnl: parseFloat(form.pnl) * (form.result === 'win' ? 1 : form.result === 'loss' ? -1 : 0),
          bankroll_after: form.bankroll_after ? parseFloat(form.bankroll_after) : undefined,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { bet: updated } = (await res.json()) as { bet: BetRow }
      onSettled(updated)
      setOpen(false)
    } catch (err) {
      setErr(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent-gold)]"
      >
        Settle
      </button>
    )
  }

  return (
    <form onSubmit={handleSettle} className="mt-2 flex flex-wrap items-end gap-2">
      <Select
        value={form.result}
        onValueChange={(v) => setForm((f) => ({ ...f, result: v as 'win' | 'loss' | 'push' }))}
      >
        <SelectTrigger className="h-7 w-24 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="win">Win</SelectItem>
          <SelectItem value="loss">Loss</SelectItem>
          <SelectItem value="push">Push</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="number"
        step="0.01"
        value={form.pnl}
        onChange={(e) => setForm((f) => ({ ...f, pnl: e.target.value }))}
        placeholder="Profit $"
        className="h-7 w-24 text-xs"
      />
      <Input
        type="number"
        step="0.01"
        value={form.bankroll_after}
        onChange={(e) => setForm((f) => ({ ...f, bankroll_after: e.target.value }))}
        placeholder="Bank after"
        className="h-7 w-24 text-xs"
      />
      <Button type="submit" size="sm" className="h-7 text-xs" disabled={saving}>
        {saving ? '…' : 'Save'}
      </Button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-[var(--color-text-muted)]"
      >
        ✕
      </button>
      {err && <p className="w-full text-xs text-red-400">{err}</p>}
    </form>
  )
}

// ── Today's Games ─────────────────────────────────────────────────────────────

function TodaysGames({
  onLogFromGame,
}: {
  onLogFromGame: (prefill: LogBetFormProps['prefill']) => void
}) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [isDemo, setIsDemo] = useState(false)
  const [leagueFilter, setLeagueFilter] = useState('all')

  useEffect(() => {
    fetch('/api/sports/odds')
      .then((r) => r.json())
      .then((d: OddsResponse) => {
        setGames(d.games)
        setIsDemo(d.is_demo)
      })
      .finally(() => setLoading(false))
  }, [])

  const leagues = Array.from(new Set(games.map((g) => g.league))).sort()
  const filtered = leagueFilter === 'all' ? games : games.filter((g) => g.league === leagueFilter)

  if (loading) {
    return <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Loading lines…</p>
  }

  return (
    <div className="space-y-3">
      {isDemo && (
        <p className="rounded border border-yellow-800 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-300">
          Demo mode — set ODDS_API_KEY for live lines
        </p>
      )}

      {leagues.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setLeagueFilter('all')}
            className={`rounded px-2 py-0.5 text-xs ${leagueFilter === 'all' ? 'bg-[var(--color-accent-gold)] text-black' : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'}`}
          >
            All ({games.length})
          </button>
          {leagues.map((l) => (
            <button
              key={l}
              onClick={() => setLeagueFilter(l)}
              className={`rounded px-2 py-0.5 text-xs ${leagueFilter === l ? 'bg-[var(--color-accent-gold)] text-black' : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'}`}
            >
              {l} ({games.filter((g) => g.league === l).length})
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">No games today</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)]">
          {filtered.map((game) => (
            <div key={game.game_id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    {game.away} @ {game.home}
                  </span>
                  <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
                    {game.league}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
                  <span>
                    Fav:{' '}
                    <strong className="text-[var(--color-text-primary)]">{game.favorite}</strong>{' '}
                    {formatAmerican(game.fav_odds)}
                  </span>
                  <span>Dog: {formatAmerican(game.dog_odds)}</span>
                  <span>Implied: {(americanToImpliedProb(game.fav_odds) * 100).toFixed(0)}%</span>
                  <span className="text-[var(--color-text-disabled)]">{game.commence_str}</span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 text-xs"
                onClick={() =>
                  onLogFromGame({
                    sport: game.sport_key,
                    league: game.league,
                    home_team: game.home,
                    away_team: game.away,
                    bet_on: game.favorite,
                    odds: game.fav_odds,
                  })
                }
              >
                Log Bet
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SportsBettingPage({ initialBets }: { initialBets: BetRow[] }) {
  const [bets, setBets] = useState<BetRow[]>(initialBets)
  const [showLogForm, setShowLogForm] = useState(false)
  const [logPrefill, setLogPrefill] = useState<LogBetFormProps['prefill']>(undefined)

  const stats = computeStats(bets)

  const handleLogged = useCallback((bet: BetRow) => {
    setBets((prev) => [bet, ...prev])
    setShowLogForm(false)
    setLogPrefill(undefined)
  }, [])

  const handleSettled = useCallback((updated: BetRow) => {
    setBets((prev) => prev.map((b) => (b.id === updated.id ? updated : b)))
  }, [])

  function handleLogFromGame(prefill: LogBetFormProps['prefill']) {
    setLogPrefill(prefill)
    setShowLogForm(true)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">Sports Betting</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Kelly-sized wagers, tracked and graded
          </p>
        </div>
        {!showLogForm && (
          <Button
            size="sm"
            className="text-xs"
            onClick={() => {
              setLogPrefill(undefined)
              setShowLogForm(true)
            }}
          >
            + Log Bet
          </Button>
        )}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-[var(--color-border)] bg-[var(--color-cockpit-surface)]">
          <CardHeader className="pt-3 pb-1">
            <CardTitle className="text-xs text-[var(--color-text-muted)]">Total Bets</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-2xl font-bold text-[var(--color-text-primary)]">{stats.total}</p>
            <p className="text-xs text-[var(--color-text-disabled)]">{stats.settled} settled</p>
          </CardContent>
        </Card>
        <Card className="border-[var(--color-border)] bg-[var(--color-cockpit-surface)]">
          <CardHeader className="pt-3 pb-1">
            <CardTitle className="text-xs text-[var(--color-text-muted)]">Win Rate</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-2xl font-bold text-[var(--color-text-primary)]">
              {stats.settled > 0 ? `${stats.winRate.toFixed(0)}%` : '—'}
            </p>
            <p className="text-xs text-[var(--color-text-disabled)]">
              {stats.wins}W / {stats.settled - stats.wins}L
            </p>
          </CardContent>
        </Card>
        <Card className="border-[var(--color-border)] bg-[var(--color-cockpit-surface)]">
          <CardHeader className="pt-3 pb-1">
            <CardTitle className="text-xs text-[var(--color-text-muted)]">Total P&L</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p
              className={`text-2xl font-bold ${stats.totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {stats.totalPnl >= 0 ? '+' : ''}${stats.totalPnl.toFixed(2)}
            </p>
            <p className="text-xs text-[var(--color-text-disabled)]">all time</p>
          </CardContent>
        </Card>
        <Card className="border-[var(--color-border)] bg-[var(--color-cockpit-surface)]">
          <CardHeader className="pt-3 pb-1">
            <CardTitle className="text-xs text-[var(--color-text-muted)]">ROI</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p
              className={`text-2xl font-bold ${stats.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}
            >
              {stats.roi >= 0 ? '+' : ''}
              {stats.roi.toFixed(1)}%
            </p>
            <p className="text-xs text-[var(--color-text-disabled)]">return on stake</p>
          </CardContent>
        </Card>
      </div>

      {/* Log Bet Form */}
      {showLogForm && (
        <LogBetForm
          prefill={logPrefill}
          onLogged={handleLogged}
          onCancel={() => {
            setShowLogForm(false)
            setLogPrefill(undefined)
          }}
        />
      )}

      {/* Tabs */}
      <Tabs defaultValue="games">
        <TabsList className="mb-4">
          <TabsTrigger value="games" className="text-xs">
            Today&apos;s Lines
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            Bet History ({bets.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="games">
          <TodaysGames onLogFromGame={handleLogFromGame} />
        </TabsContent>

        <TabsContent value="history">
          {bets.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              No bets yet — log your first bet above
            </p>
          ) : (
            <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-cockpit-surface)]">
              {bets.map((bet) => (
                <div key={bet.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">
                          {bet.bet_on ?? '—'}
                        </span>
                        {bet.league && (
                          <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
                            {bet.league}
                          </span>
                        )}
                        {resultBadge(bet.result)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
                        <span>{bet.bet_date}</span>
                        <span>Odds: {formatAmerican(bet.odds)}</span>
                        {bet.stake != null && <span>Stake: ${bet.stake.toFixed(2)}</span>}
                        {bet.kelly_pct != null && <span>Kelly: {bet.kelly_pct.toFixed(1)}%</span>}
                        {bet.book && <span>{bet.book}</span>}
                        {bet.home_team && bet.away_team && (
                          <span className="text-[var(--color-text-disabled)]">
                            {bet.away_team} @ {bet.home_team}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold">{fmtPnl(bet.pnl)}</div>
                      {(!bet.result || bet.result === 'pending') && (
                        <SettleRow bet={bet} onSettled={handleSettled} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
