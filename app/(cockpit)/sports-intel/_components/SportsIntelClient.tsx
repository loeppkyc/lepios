'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { formatAmerican } from '@/lib/sports/odds'
import type { Game } from '@/lib/sports/odds'
import type { SportsPick } from '@/lib/sports/picks'
import type { DebriefResult } from '@/lib/sports/coach'

// ── Types ─────────────────────────────────────────────────────────────────────

interface OddsResponse {
  games: Game[]
  total: number
  favorites: number
  is_demo: boolean
}

interface ApiStatus {
  status: string
  message: string
  remaining?: string
}

// ── Today's Lines tab ─────────────────────────────────────────────────────────

function TodaysLinesTab() {
  const [data, setData] = useState<OddsResponse | null>(null)
  const [status, setStatus] = useState<ApiStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterMode, setFilterMode] = useState<'all' | 'favorites'>('all')
  const [logging, setLogging] = useState(false)
  const [logMsg, setLogMsg] = useState('')
  const [analysis, setAnalysis] = useState('')
  const [analysisLoading, setAnalysisLoading] = useState(false)

  useEffect(() => {
    fetch('/api/sports/odds?action=status')
      .then((r) => r.json())
      .then((s: ApiStatus) => setStatus(s))
      .catch(() => null)

    fetch('/api/sports/odds')
      .then((r) => r.json())
      .then((d: OddsResponse) => setData(d))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  const displayed =
    filterMode === 'favorites'
      ? (data?.games ?? []).filter((g) => g.fav_odds <= -150)
      : (data?.games ?? [])

  const byLeague: Record<string, Game[]> = {}
  for (const g of displayed) {
    byLeague[g.league] = [...(byLeague[g.league] ?? []), g]
  }

  function handleLogPicks() {
    if (!data?.games.length) return
    setLogging(true)
    fetch('/api/sports/picks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ games: data.games }),
    })
      .then((r) => r.json())
      .then((res: { logged: number }) => setLogMsg(`Logged ${res.logged} games to tracker`))
      .catch(() => setLogMsg('Log failed'))
      .finally(() => setLogging(false))
  }

  function handleAnalysis() {
    const favorites = (data?.games ?? []).filter((g) => g.fav_odds <= -150)
    if (!favorites.length) return
    setAnalysisLoading(true)
    setAnalysis('')
    fetch('/api/sports/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'analysis', picks: favorites }),
    })
      .then((r) => r.json())
      .then((res: { text: string }) => setAnalysis(res.text))
      .catch(() => setAnalysis('Analysis unavailable'))
      .finally(() => setAnalysisLoading(false))
  }

  if (loading) return <p className="text-muted-foreground p-4 text-sm">Loading odds...</p>

  return (
    <div className="space-y-4">
      {status && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Badge variant={status.status === 'ok' ? 'default' : 'destructive'}>
                {status.status === 'ok' ? 'API Live' : status.status}
              </Badge>
              <span className="text-muted-foreground text-xs">{status.message}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {data?.is_demo && (
        <div className="rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
          Demo data — add ODDS_API_KEY to see live lines
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{data?.total ?? 0} games</Badge>
          <Badge className="bg-green-600 text-white">{data?.favorites ?? 0} green picks</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterMode} onValueChange={(v) => setFilterMode(v as 'all' | 'favorites')}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All games</SelectItem>
              <SelectItem value="favorites">-150 picks only</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogPicks}
            disabled={logging || !data?.games.length}
          >
            {logging ? 'Logging...' : 'Log to DB'}
          </Button>
          <Button variant="outline" size="sm" onClick={handleAnalysis} disabled={analysisLoading}>
            {analysisLoading ? 'Analyzing...' : 'AI Analysis'}
          </Button>
        </div>
      </div>

      {logMsg && <p className="text-xs text-green-400">{logMsg}</p>}

      {analysis && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="prose prose-invert prose-sm max-w-none text-xs whitespace-pre-wrap">
              {analysis}
            </div>
          </CardContent>
        </Card>
      )}

      {Object.entries(byLeague).map(([league, games]) => (
        <Card key={league}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              {league}
              <Badge variant="outline" className="text-xs">
                {games.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {games.map((g) => (
              <div
                key={g.game_id}
                className="bg-card/50 flex items-center justify-between rounded px-3 py-2 text-xs"
              >
                <div className="space-y-0.5">
                  <div className="font-medium">
                    {g.home} vs {g.away}
                  </div>
                  <div className="text-muted-foreground">
                    <span className={g.fav_odds <= -150 ? 'font-medium text-green-400' : ''}>
                      {g.favorite} {formatAmerican(g.fav_odds)}
                    </span>{' '}
                    ({g.implied_prob}%) · {g.commence_str}
                  </div>
                </div>
                <div className="text-right">
                  {g.fav_odds <= -150 ? (
                    <Badge className="bg-green-600 text-[10px] text-white">green</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      red
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {!displayed.length && (
        <p className="text-muted-foreground py-8 text-center text-sm">No games found for today.</p>
      )}
    </div>
  )
}

// ── AI Coach tab ──────────────────────────────────────────────────────────────

function AiCoachTab() {
  const [debriefBet, setDebriefBet] = useState({
    home: '',
    away: '',
    league: '',
    fav_odds: '',
    implied_prob: '',
    stake: '',
    pnl: '',
    bet_on: '',
  })
  const [debriefResult, setDebriefResult] = useState<'Win' | 'Loss' | 'Push'>('Win')
  const [debrief, setDebrief] = useState<DebriefResult | null>(null)
  const [debriefLoading, setDebriefLoading] = useState(false)

  const [stratStats, setStratStats] = useState({
    total_bets: '',
    wins: '',
    losses: '',
    pushes: '',
    roi_pct: '',
    win_rate_pct: '',
    best_league: '',
    worst_league: '',
    bankroll_start: '',
    bankroll_current: '',
  })
  const [stratReview, setStratReview] = useState('')
  const [stratLoading, setStratLoading] = useState(false)

  function handleDebrief() {
    setDebriefLoading(true)
    setDebrief(null)
    fetch('/api/sports/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'debrief',
        result: debriefResult,
        bet: {
          ...debriefBet,
          fav_odds: Number(debriefBet.fav_odds),
          implied_prob: Number(debriefBet.implied_prob),
          stake: Number(debriefBet.stake),
          pnl: Number(debriefBet.pnl),
        },
      }),
    })
      .then((r) => r.json())
      .then((d: DebriefResult) => setDebrief(d))
      .catch(() => null)
      .finally(() => setDebriefLoading(false))
  }

  function handleStrategyReview() {
    setStratLoading(true)
    setStratReview('')
    fetch('/api/sports/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'strategy',
        stats: {
          total_bets: Number(stratStats.total_bets),
          wins: Number(stratStats.wins),
          losses: Number(stratStats.losses),
          pushes: Number(stratStats.pushes),
          roi_pct: Number(stratStats.roi_pct),
          win_rate_pct: Number(stratStats.win_rate_pct),
          best_league: stratStats.best_league,
          worst_league: stratStats.worst_league,
          bankroll_start: Number(stratStats.bankroll_start),
          bankroll_current: Number(stratStats.bankroll_current),
        },
      }),
    })
      .then((r) => r.json())
      .then((res: { text: string }) => setStratReview(res.text))
      .catch(() => setStratReview('Review unavailable'))
      .finally(() => setStratLoading(false))
  }

  return (
    <div className="space-y-6">
      {/* Post-game debrief */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Post-Game Debrief</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Home Team</Label>
              <Input
                className="h-8 text-xs"
                value={debriefBet.home}
                onChange={(e) => setDebriefBet((p) => ({ ...p, home: e.target.value }))}
                placeholder="Edmonton Oilers"
              />
            </div>
            <div>
              <Label className="text-xs">Away Team</Label>
              <Input
                className="h-8 text-xs"
                value={debriefBet.away}
                onChange={(e) => setDebriefBet((p) => ({ ...p, away: e.target.value }))}
                placeholder="Calgary Flames"
              />
            </div>
            <div>
              <Label className="text-xs">League</Label>
              <Input
                className="h-8 text-xs"
                value={debriefBet.league}
                onChange={(e) => setDebriefBet((p) => ({ ...p, league: e.target.value }))}
                placeholder="NHL"
              />
            </div>
            <div>
              <Label className="text-xs">Bet On</Label>
              <Input
                className="h-8 text-xs"
                value={debriefBet.bet_on}
                onChange={(e) => setDebriefBet((p) => ({ ...p, bet_on: e.target.value }))}
                placeholder="Edmonton Oilers"
              />
            </div>
            <div>
              <Label className="text-xs">Odds (e.g. -165)</Label>
              <Input
                className="h-8 text-xs"
                value={debriefBet.fav_odds}
                onChange={(e) => setDebriefBet((p) => ({ ...p, fav_odds: e.target.value }))}
                placeholder="-165"
              />
            </div>
            <div>
              <Label className="text-xs">Implied Prob %</Label>
              <Input
                className="h-8 text-xs"
                value={debriefBet.implied_prob}
                onChange={(e) => setDebriefBet((p) => ({ ...p, implied_prob: e.target.value }))}
                placeholder="62.3"
              />
            </div>
            <div>
              <Label className="text-xs">Stake ($)</Label>
              <Input
                className="h-8 text-xs"
                value={debriefBet.stake}
                onChange={(e) => setDebriefBet((p) => ({ ...p, stake: e.target.value }))}
                placeholder="25"
              />
            </div>
            <div>
              <Label className="text-xs">P&amp;L ($)</Label>
              <Input
                className="h-8 text-xs"
                value={debriefBet.pnl}
                onChange={(e) => setDebriefBet((p) => ({ ...p, pnl: e.target.value }))}
                placeholder="-25"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs">Result:</Label>
            {(['Win', 'Loss', 'Push'] as const).map((r) => (
              <Button
                key={r}
                size="sm"
                variant={debriefResult === r ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => setDebriefResult(r)}
              >
                {r}
              </Button>
            ))}
            <Button
              size="sm"
              onClick={handleDebrief}
              disabled={debriefLoading || !debriefBet.home}
              className="ml-auto h-7 text-xs"
            >
              {debriefLoading ? 'Analyzing...' : 'Run Debrief'}
            </Button>
          </div>

          {debrief && (
            <div className="border-border/50 bg-card/50 mt-2 space-y-2 rounded border p-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium">Pick Quality</span>
                <Badge variant="outline">{debrief.rating}/10</Badge>
              </div>
              <p>{debrief.summary}</p>
              {debrief.key_factors.length > 0 && (
                <ul className="text-muted-foreground space-y-0.5">
                  {debrief.key_factors.map((f, i) => (
                    <li key={i}>• {f}</li>
                  ))}
                </ul>
              )}
              {debrief.lesson && (
                <p className="text-yellow-300">
                  <span className="font-medium">Lesson:</span> {debrief.lesson}
                </p>
              )}
              {debrief.confidence_review && (
                <p className="text-muted-foreground">{debrief.confidence_review}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Strategy review */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Strategy Review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['total_bets', 'Total Bets', '50'],
              ['wins', 'Wins', '31'],
              ['losses', 'Losses', '19'],
              ['pushes', 'Pushes', '0'],
              ['win_rate_pct', 'Win Rate %', '62.0'],
              ['roi_pct', 'ROI %', '4.5'],
              ['bankroll_start', 'Bankroll Start ($)', '500'],
              ['bankroll_current', 'Bankroll Current ($)', '522'],
            ].map(([key, label, placeholder]) => (
              <div key={key}>
                <Label className="text-xs">{label}</Label>
                <Input
                  className="h-8 text-xs"
                  value={stratStats[key as keyof typeof stratStats]}
                  onChange={(e) => setStratStats((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={placeholder}
                />
              </div>
            ))}
            <div>
              <Label className="text-xs">Best League</Label>
              <Input
                className="h-8 text-xs"
                value={stratStats.best_league}
                onChange={(e) => setStratStats((p) => ({ ...p, best_league: e.target.value }))}
                placeholder="NHL"
              />
            </div>
            <div>
              <Label className="text-xs">Worst League</Label>
              <Input
                className="h-8 text-xs"
                value={stratStats.worst_league}
                onChange={(e) => setStratStats((p) => ({ ...p, worst_league: e.target.value }))}
                placeholder="NBA"
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleStrategyReview}
            disabled={stratLoading || !stratStats.total_bets}
            className="h-7 text-xs"
          >
            {stratLoading ? 'Reviewing...' : 'Generate Review'}
          </Button>
          {stratReview && (
            <div className="border-border/50 bg-card/50 rounded border p-3 text-xs whitespace-pre-wrap">
              {stratReview}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Picks Log tab ─────────────────────────────────────────────────────────────

function PicksLogTab() {
  const [picks, setPicks] = useState<SportsPick[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return d.toLocaleDateString('en-CA')
  })
  const [to, setTo] = useState(() => new Date().toLocaleDateString('en-CA'))

  function loadPicks() {
    setLoading(true)
    fetch(`/api/sports/picks?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d: { picks: SportsPick[] }) => setPicks(d.picks))
      .catch(() => null)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetch(`/api/sports/picks?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d: { picks: SportsPick[] }) => setPicks(d.picks))
      .catch(() => null)
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const settled = picks.filter((p) => p.fav_won !== null)
  const wins = settled.filter((p) => p.fav_won).length
  const pnl = settled.reduce((acc, p) => acc + (p.pnl ?? 0), 0)
  const winRate = settled.length ? ((wins / settled.length) * 100).toFixed(1) : '--'
  const greenPicks = settled.filter((p) => p.tier === 'green')
  const greenWins = greenPicks.filter((p) => p.fav_won).length
  const greenPnl = greenPicks.reduce((acc, p) => acc + (p.pnl ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-2">
        <div>
          <Label className="text-xs">From</Label>
          <Input
            className="h-8 w-36 text-xs"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input
            className="h-8 w-36 text-xs"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={loadPicks}
          disabled={loading}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </Button>
      </div>

      {settled.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardHeader className="pt-3 pb-1">
              <CardTitle className="text-muted-foreground text-xs">All Picks</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="text-lg font-bold">
                {wins}-{settled.length - wins} ({winRate}%)
              </div>
              <div className={`text-xs ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                P&amp;L: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ($100 flat)
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pt-3 pb-1">
              <CardTitle className="text-muted-foreground text-xs">Green Picks (-150+)</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="text-lg font-bold">
                {greenWins}-{greenPicks.length - greenWins} (
                {greenPicks.length ? ((greenWins / greenPicks.length) * 100).toFixed(1) : '--'}%)
              </div>
              <div className={`text-xs ${greenPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                P&amp;L: {greenPnl >= 0 ? '+' : ''}${greenPnl.toFixed(2)} ($100 flat)
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-1.5">
        {picks.map((p) => (
          <div
            key={p.id}
            className="bg-card/50 flex items-center justify-between rounded px-3 py-2 text-xs"
          >
            <div className="space-y-0.5">
              <div className="font-medium">
                {p.fav_won === true ? '✅' : p.fav_won === false ? '❌' : '⏳'} {p.favorite}{' '}
                {formatAmerican(p.fav_odds)} — {p.home} vs {p.away}
              </div>
              <div className="text-muted-foreground">
                {p.league} · {p.picked_on}
              </div>
            </div>
            <div className="space-y-0.5 text-right">
              <Badge
                variant={p.tier === 'green' ? 'default' : 'outline'}
                className={`text-[10px] ${p.tier === 'green' ? 'bg-green-600 text-white' : ''}`}
              >
                {p.tier}
              </Badge>
              {p.pnl !== null && (
                <div
                  className={`text-xs font-medium ${p.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)}
                </div>
              )}
            </div>
          </div>
        ))}
        {!picks.length && !loading && (
          <p className="text-muted-foreground py-6 text-center text-xs">
            No picks logged for this range.
          </p>
        )}
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function SportsIntelClient() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-bold">Sports Intel</h1>
        <p className="text-muted-foreground text-xs">Odds · AI Coach · Picks Log</p>
      </div>

      <Tabs defaultValue="lines">
        <TabsList className="w-full">
          <TabsTrigger value="lines" className="flex-1 text-xs">
            Today&apos;s Lines
          </TabsTrigger>
          <TabsTrigger value="coach" className="flex-1 text-xs">
            AI Coach
          </TabsTrigger>
          <TabsTrigger value="picks" className="flex-1 text-xs">
            Picks Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="mt-4">
          <TodaysLinesTab />
        </TabsContent>
        <TabsContent value="coach" className="mt-4">
          <AiCoachTab />
        </TabsContent>
        <TabsContent value="picks" className="mt-4">
          <PicksLogTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
