# LepiOS Behavioral Ingestion Spec

**Purpose:** Define what LepiOS captures continuously so the Twin corpus writes itself. Twin learns Colin-under-conditions, not just stated-Colin. Actions + state + context over time = model.

**Core principle:** Every captured event is a tuple of `(what_happened, when, where_state_was, what_context, what_followed)`. Stated values weight less than observed behavior. Context modulates weight. Outcomes validate or invalidate prior predictions.

---

## 1. STATE VARIABLES (the conditions Colin operates under)

Captured passively where possible. Manual where not.

### Physical
- **Sleep** — duration, quality, wake time. Source: Oura API (planned). Frequency: nightly.
- **HRV / resting HR / body temp** — Oura. Nightly + continuous.
- **Weight** — manual log. Target weekly, accept sporadic.
- **Food intake** — grocery photos → nutrition lookup (existing health-OS module). Per meal or per shop.
- **Hydration** — manual, optional.
- **Seborrheic dermatitis flare state** — manual flag 0–3 severity. Daily prompt or on-demand.
- **Medications / supplements** — manual log.
- **Exercise / movement** — Oura or manual.

### Environmental
- **Weather (Edmonton)** — auto-fetch. Affects mood, sinus, flare.
- **Light hours** — auto-derived. Edmonton winter = real signal.
- **Travel / driving hours** — MileIQ CSV ingestion (planned). Daily.

### Financial
- **Amazon revenue** — SP-API. Refresh 10-min cadence (post-429 fix).
- **Amazon payouts & reserves** — SP-API.
- **COGS** — manual entry page (backlog).
- **Bills due in next 14 days** — bank/email scanner (Gmail scanner dependency).
- **Cash on hand** — bank API or manual weekly.
- **Trading / Polymarket P&L** — API pull if exposed, else manual.
- **Sports betting P&L** — manual log.
- **GST owed running total** — derived from SP-API + manual non-Amazon sales.

### Social / Relational
- **Megan status** — manual flag (good / stressed / sick / conflict). Daily prompt.
- **Daughter status** — manual flag. Daily prompt.
- **Mom (Saskatchewan) contact frequency** — Gmail / call log. Weekly rollup.
- **Family friction events** — manual ping. "Argument with X at Y." Timestamped.
- **Family wins** — same format. Balance the signal.

### Cognitive / Emotional
- **Self-reported mood** — 1–10 morning bar (ported from Streamlit).
- **Self-reported energy** — same.
- **Self-reported focus** — same.
- **Frustration markers** — inferred from text tone (sparse words, "whatever," "doesn't matter," "just do it"). Weight heavier when Colin repeats the same correction.
- **Tired markers** — timestamp of message + message brevity + typo density. Inferred.
- **Calibration rule** — Twin adjusts its own verbosity and probing from Colin's communication pressure signals. Repeating a correction = Twin failure, weight heavily.

---

## 2. UTTERANCES (what Colin says, to whom, how)

Every utterance gets captured with full context.

### Sources
- **Telegram → LepiOS bot** — inbound text, voice notes (transcribed), photos.
- **Claude Code sessions** — pastes and chats (already in corpus).
- **Claude.ai chats** — exported via conversation history (already in corpus).
- **Ollama local chats** — logged (existing).
- **Gmail sent folder** — outbound emails Colin writes (Gmail scanner).
- **Voice memos** — phone → transcribe → ingest (future).

### Metadata per utterance
- Timestamp (MT + UTC)
- Channel
- Recipient (self, Claude, Megan, customer, supplier, etc.)
- Length (word count)
- Sentiment (inferred)
- Topic tags (inferred)
- State snapshot at time of utterance (pull from §1)

### Why the state snapshot matters
"Colin said 'ship it, I don't care' at 21:47 MT after 5h sleep, 3 unread urgent emails, Megan stressed flag, and $180 day revenue" ≠ "Colin said 'ship it, I don't care' at 10:14 MT after 8h sleep, clear inbox, good family flag, and $800 day revenue." Same words. Different meaning. Twin learns to weight.

---

## 3. ACTIONS (what Colin did, not what he said he'd do)

Observed behavior is ground truth.

### Sources
- **Git commits** — what actually shipped, when, how often.
- **Task_queue state changes** — what got picked up, completed, abandoned, deferred.
- **Amazon listings created** — sourcing actions.
- **Trades placed** — Polymarket / betting logs.
- **Calendar events attended** — Google Calendar.
- **Messages sent** — count per recipient per day.
- **App opens** — if LepiOS tracks its own frontend analytics.
- **Purchases made** — credit card / bank scanner via Gmail.

### Key derived metrics
- **Follow-through ratio** — of things Colin said he'd do, what % got done within stated timeframe?
- **Abandonment pattern** — which kinds of tasks get dropped? At what state?
- **Deflection pattern** — when Colin says "do whatever," what does he actually want 80% of the time? Twin learns from subsequent corrections.

---

## 4. OUTCOMES (did it work)

Every prediction, decision, and action gets an outcome tag eventually. Inferred passively where possible — no nightly forms.

- **Trades** — did it hit?
- **Sourcing decisions** — did the book sell? How long did it sit?
- **Health experiments** — did the dermatitis clear? Did energy improve?
- **Schedule changes** — did Colin get more done? Feel better?
- **Family decisions** — did Megan feel heard? Did the weekend land?
- **LepiOS features shipped** — actually used? Abandoned? Iterated?

### Feedback mechanism
- Passive: Twin watches commits, task state changes, follow-up behavior, repeated topics, purchase patterns.
- Active only when stakes justify: Twin asks for explicit outcome tag when passive inference is ambiguous and the decision was high-signal.
- No scheduled nightly rollup form.

---

## 5. CAPTURE FREQUENCY + SOURCE MATRIX

| Data | Source | Frequency | Manual/Auto |
|---|---|---|---|
| Sleep | Oura | Nightly | Auto |
| HRV | Oura | Continuous | Auto |
| Weight | Scale / manual | Weekly target | Manual |
| Food | Grocery photo + meals | Per shop / meal | Mixed |
| Derm flare | Prompt | Daily | Manual |
| Weather | API | Hourly | Auto |
| Driving | MileIQ | Daily | Auto (CSV) |
| Amazon revenue | SP-API | 10-min | Auto |
| Bills due | Gmail scanner | Daily | Auto |
| Bank balance | Plaid / manual | Weekly | Mixed |
| Trading P&L | API or manual | Per trade | Mixed |
| Mood/energy/focus | Morning bar (Streamlit-ported) + inferred | Daily anchor + continuous | Mixed |
| Megan/daughter status | Prompt | Daily | Manual |
| Family events | Free-form ping | Ad-hoc | Manual |
| Utterances | Channel hooks | Continuous | Auto |
| Commits | Git | Per commit | Auto |
| Task state | task_queue | Per change | Auto |
| Trades placed | Logs | Per trade | Auto/manual |
| Outcomes | Passive inference + rare explicit | Continuous | Mostly auto |

---

## 6. HOW TWIN USES IT

### Retrieval
- Queries return not just relevant text but relevant text **filtered by similar state**. "What did Colin decide about X when state was similar to now?"

### Weighting
- Utterances made under low-sleep / high-stress / end-of-day weighted lower for "stated preferences" queries.
- Utterances made under good-state weighted higher.
- Actions always outweigh utterances. What Colin did > what Colin said.

### Confidence decay
- Older data decays. 2024 preferences less relevant than 2026 preferences unless reinforced.
- Decayed confidence triggers Twin to ask Colin to re-confirm — but only when stakes justify, not on a schedule.

### Correlation mining
- Twin surfaces patterns: "Colin's derm flares cluster with weeks over 55 hours of work + <6h sleep avg." Not proven causation, but signal worth showing.
- "Trading losses cluster with nights Megan stressed flag + <$200 Amazon day." Behavioral pattern.

### Nudges
- Twin can proactively surface: "You've said 'I don't care' twice today. Last 3 times that pattern hit, you regretted decisions made in the next 2 hours. Consider pausing."
- Not nagging. Pattern mirrors.
- Adaptive frequency — if Colin pushes back, cadence drops. Silence is data.

---

## 7. INGESTION BACKLOG (what needs building)

In rough priority order:

1. **Telegram bot inbound** — already works outbound (nightly reports). Need inbound capture → Supabase.
2. **Morning mood/energy/focus bar** — port from Streamlit. 1–10 slider, daily anchor.
3. **Daily state prompt** — derm flare, Megan status, daughter status, one-line "what happened today."
4. **Gmail scanner** — bills, receipts, statement arrivals, family emails. Chunk D v2 dependency.
5. **Oura integration** — sleep, HRV, readiness. API exists.
6. **MileIQ CSV ingestion** — backlog.
7. **Git commit stream → Twin corpus** — passive.
8. **Utterance channel hooks** — Telegram + Claude chats → corpus with state snapshot.
9. **Outcome inference module** — passive behavior tracking.
10. **Plaid / bank API** — cash, bills, transactions.
11. **Trading / betting log ingestion** — Polymarket API if available.
12. **Correlation surfacing module** — Twin's pattern-mining output surfaced in LepiOS dashboard.

---

## 8. PRIVACY + GUARDRAILS

- All data stays in Colin's Supabase. Ollama processes locally where possible.
- Trust is earned over time, not declared upfront. Start with what's already shared. Expand scope only after months/years of clean operation.
- Megan / daughter state flags are Colin's subjective observations, not their data. Megan's visibility into the site is the consent mechanism.
- Mom, friends, customers: metadata only (frequency, sentiment trend) unless Colin explicitly logs specifics.
- Twin never proactively shares state data with third parties.
- Family-friction logs flagged sensitive, redacted from any exported corpus.
- No highly sensitive data captured until LepiOS has demonstrated clean operation for months/years.

---

## 9. OPEN QUESTIONS — RESOLVED

1. **Mood cadence:** 1–10 morning bar (Streamlit port) as anchor; rest inferred from text tone and behavior. No fixed ping schedule.
2. **Proactive vs reactive:** Twin learns from Colin's pushback. No declared cadence. Silence and frustration both weight heavily.
3. **Megan consent:** Handled by Colin directly. Her visibility into the site is the mechanism.
4. **Outcome tagging:** Passive inference default. Explicit tagging only when passive signal is ambiguous and stakes are high.
5. **Frustration calibration:** Twin adjusts verbosity and behavior from Colin's communication pressure signals. Repeating a correction = Twin failure, weight heavily.
6. **Privacy:** Earned over time. Start conservative, expand scope after sustained clean operation.

---

## 10. PATH PROBABILITY ENGINE (long-arc feature, builds continuously)

**Principle:** Every module in LepiOS is feeding a future engine that predicts path outcomes for any decision Colin is considering. Grocery logs, mood pings, state snapshots, outcomes — all of it is training data for this. Build-while-running. The engine gets more accurate as the corpus grows.

### Prior art
- **Life insurance actuarial modeling** — 30 questions → accurate mortality distribution. Proof the general technique works.
- **Streamlit predecessor** — Colin brain-dumped a version of this. Port the conceptual spec into LepiOS.
- **"Build your own adventure" framing** — decision trees with probabilistic branches, not single answers.

### Inputs
- Full Colin corpus (utterances, decisions, outcomes, state history)
- Colin's fine-tuned embeddings + eventual fine-tuned LLM
- Behavioral predictor model (from §6)
- **External reference cohorts** — scraped/licensed population data matching Colin's or relevant comparison profiles:
  - 40-year-old male entrepreneurs (Colin cohort, baseline comparison)
  - 34-year-old mothers, one child, not working, 8h sleep (Megan cohort, for family-decision modeling)
  - Off-grid attempters in similar climates (for off-grid scenario)
  - Career-changers from self-employment to employment (for career-flip scenarios)
  - Immigration cohorts (US move scenario — Jay Treaty research)
  - Any other cohort Colin needs to model a specific decision against
- Actuarial / statistical reference tables where they exist (income, health, longevity, business survival)
- Time horizon of the question (decision impact measured over months, years, decades)

### Outputs
Not a single probability. A distribution with multiple numbers:

- **Base rate** — how often does this kind of path work out for people like Colin? (external cohort data)
- **Colin-specific consistency** — how does this align with Colin's demonstrated patterns? (internal corpus)
- **Constraint match** — does Colin's demonstrated state / preferences / behavior actually support this path, or does it require traits Colin doesn't show?
- **Branch points** — where in the path do decisions re-open? What state is likely at each branch?
- **Abandonment risk curve** — probability Colin bails by month 3, 6, 12, 24.
- **Satisfaction forecast** — distribution of likely satisfaction outcomes, weighted by similar past decisions.
- **Confidence band** — how much data supports this prediction. Low data = wide error bars = say so.

### Scenarios to eventually model
- Career pivots (quit Amazon, take a job, start new business)
- Geographic moves (USA move, off-grid, rural, urban)
- Family decisions (second child, schooling choices, eldercare for mom)
- Financial decisions (large purchases, investment shifts, debt)
- Health experiments (dietary changes, fitness protocols, treatments)
- Relationship / social (friendships, family conflict, community involvement)
- Daily micro-decisions (should I trade today, should I call Megan's sister back, should I push one more hour)

### Accuracy progression
- **Year 1** (now–2027): low confidence, wide bands, useful for structure and constraint surfacing. Tell Colin what to consider, not what will happen.
- **Year 2–3**: medium confidence on decision types Colin has repeated; still wide bands on novel paths.
- **Year 5+**: high confidence on daily/monthly patterns; medium on large life pivots; acknowledges forever the inherent unpredictability of black-swan events.
- **With GPU + fine-tuning**: custom Colin-embeddings + Colin-LLM sharpen retrieval and generation; external cohort scraping adds base-rate ground truth.

### GPU / compute path for cohort enrichment
When GPU comes online (3060 trade, cloud rental, eventual 3090/4090):
- Scrape / license public cohort data (census, Stats Canada, BLS, health surveys, business survival rates)
- Fine-tune embeddings on Colin + cohort pairs
- Fine-tune a small LLM on Colin corpus + cohort summaries
- Result: queries like "what happens if I [decision]" return Colin-tuned + cohort-grounded distributions, not generic LLM hand-waves

### Build-while-running principle
- Every module added to LepiOS between now and engine-launch is **already feeding it**.
- Grocery logs → dietary-change scenario training data.
- Task_queue abandonment patterns → follow-through prior for any new commitment.
- Trading P&L + mood correlation → risk-tolerance-under-stress model.
- Family friction logs → relationship-decision base rates.
- Business Review numbers → income-volatility model.
- Every utterance with state snapshot → a datapoint for "Colin under conditions X does Y."

### When the engine ships (v1)
- Twin endpoint stable + behavioral predictor functioning + ~6–12 months of continuous state capture
- Interface: Colin asks "what's the probability of path X" in natural language
- Returns: structured output (the distribution bullets above) + narrative summary
- Every query result is itself logged as a prediction; outcomes tag back to refine the engine over time (engine predicts its own accuracy)

### What this unlocks downstream
- Proactive mode: Twin surfaces "you're approaching a branch point you've mishandled before" without being asked.
- Decision journaling: every real decision Colin makes gets a "prior probability distribution at time of decision" stamp, so post-hoc learning is measurable.
- Digital continuation: the behavioral model + path engine together are the functional core of a Colin-proxy that could operate in Colin's absence with high fidelity on decision patterns.

---

**Standing rule for every future module:** Before building, ask "what does this feed the path engine?" If the answer is nothing, it's probably not worth building. If the answer is clear, the module spec should include explicit fields for how its data becomes engine training signal.
