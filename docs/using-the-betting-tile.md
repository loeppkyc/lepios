# Betting Tile — Usage Guide

**URL:** lepios-one.vercel.app/money

---

## Logging a bet

1. Click **Log Bet** (top-right of the tile)
2. Fill in the required fields:
   - **Bet date** — date of the bet (required)
   - **Odds** — American format, e.g. `-150` or `+220` (required)
3. Optional but useful:
   - **Sport / League / Home / Away / Bet on** — for filtering and display
   - **Stake** — dollar amount risked
   - **Bankroll before** — your balance going in
   - **Your win prob (%)** — your estimated probability of winning (stored for calibration tracking; see Kelly rec below)
   - **Reasoning / AI notes** — why you made the bet, any edge notes
4. Hit **Log Bet**. The bet appears in the pending list immediately.

> The **Book** field accepts any sportsbook name (e.g. "Play Alberta", "BetMGM").

---

## Kelly recommendation

The Kelly % appears in green below the odds/win-prob fields as you type.

| What you entered | What it uses |
|---|---|
| Odds only | Implied probability from the odds (break-even baseline) |
| Odds + your win prob | Your estimated edge over implied prob |

**How to read it:**
- `Kelly: 4.2%` → risk 4.2% of your bankroll on this bet
- `Kelly: 0.0% (no edge at implied prob)` → the odds don't give you an edge at break-even; enter your win prob to see if you have an edge
- Negative → the math says don't bet this

> This is decision support, not instruction. Full Kelly is aggressive — many bettors use half-Kelly in practice.

---

## Settling a bet (Supabase workaround)

Auth is not live yet. When you click **Settle** on a pending bet, you'll see an instructional modal with a pre-filled SQL snippet. Use it directly in the Supabase dashboard.

**Steps:**
1. Click **Settle** on the bet
2. Copy the SQL from the modal (or use the copy button)
3. Click **Open SQL Editor ↗** — goes straight to the Supabase SQL editor
4. Paste and run the query
5. Refresh the page — the bet moves from pending to settled

**SQL template** (pre-filled in the modal with your actual bet ID):
```sql
UPDATE bets
SET
  result  = 'win',   -- or 'loss' or 'push'
  pnl     = 18.50,   -- profit/loss in dollars (negative for loss)
  bankroll_after = 518.50,
  updated_at = now()
WHERE id = '<your-bet-id>';
```

**P&L conventions:**
- Win: positive number (your profit, not including stake)
- Loss: negative number (e.g. `-25.00`)
- Push: `0`

---

## "Collecting data" counter

The **Edge Signal** bar (bottom of the tile) requires 30 settled bets to calculate a rolling ROI signal.

Until then you'll see: `Collecting data (X/30)`

Once you hit 30:
- **PROFITABLE** → rolling ROI > 3% over last 30 bets
- **BREAK-EVEN** → ROI between -3% and +3%
- **LOSING** → ROI below -3%

This resets as older bets fall outside the 30-bet window — it's a trailing signal, not a lifetime stat.

---

## Notes

- All bets logged here start fresh. Historical Streamlit bets are excluded pending a data audit (BACKLOG-1).
- `win_prob_pct` is stored in the DB — it will power calibration charts in a future sprint.
- The settle flow will be in-app once auth ships (Sprint 5).
