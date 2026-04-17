# Design Mood & Taste Session — LepiOS Cockpit Aesthetic

**Agent:** E (Design Council Mood Session)
**Date:** 2026-04-17
**Status:** PROPOSED — pending Colin's taste session. No design tokens are locked until §7 is completed.
**Accuracy-zone:** All Streamlit OS observations are grounded (file:line cited). Design proposals are clearly marked PROPOSED.

---

## Grounding: Streamlit OS Current Visual State

Before proposing anything new, this is what exists and can be extended or built on.

**Source:** `streamlit_app/utils/style.py` (full file read, lines 18–508)
**Source:** `streamlit_app/.streamlit/config.toml` (lines 14–19)

### Existing color tokens in the Streamlit OS:

| Token | Value | Used for |
|---|---|---|
| Base background | `#0e0e18` | App container background |
| Sidebar base | `#1c1832` → `#252040` | Sidebar gradient |
| Card background | `#1a1830` → `#14122a` | Metric cards, expanders |
| Primary text | `#e8e6f0` | Body text |
| Secondary text | `#d0cee0` | Labels, paragraphs |
| Muted text | `#8a87a0` | Details, subtitles |
| Gold accent | `#c89b37` | Metric labels, borders, brand |
| Gold bright | `#f0d060` | Large amounts, neon gold |
| Gold dim | `#8a6a10` | Gradient fade |
| Red primary | `#cc1a1a` | Primary buttons, section borders |
| Red bright | `#e82020` | Button hover |
| Cyber cyan | `#00d4ff` | Cyberpunk layer, agent status (opt-in) |
| Cyber green | `#00ff88` | Agent active dot, confidence-high |
| Cyber red | `#ff3366` | Agent error, confidence-low |
| Border subtle | `rgba(200,155,55,0.18–0.25)` | Card borders |
| CRT scanlines | `rgba(0,255,136,0.015)` | Pseudo-element overlay, full-page |
| Streamlit primary | `#00d4ff` | config.toml |
| Streamlit bg | `#0e1117` | config.toml (overridden by style.py) |
| Streamlit secondary bg | `#1a1a2e` | config.toml |
| Streamlit text | `#e8f0ff` | config.toml |

**[grounded — `streamlit_app/utils/style.py:22–53`, `streamlit_app/.streamlit/config.toml:15–19`]**

### What the Streamlit OS theme already does well (reusable in LepiOS):

- Dark base: `#0e0e18` — very close to what LepiOS needs. EXTEND.
- Status pills in 6 colors (green/red/blue/yellow/purple/gray). EXTEND.
- Agent status dots with pulse animation. EXTEND.
- Gold top-rail pinstripe on the app container. EXTEND as cockpit chrome.
- Monospace font already used in `.agent-time`, `.ticker-chip`, `.confidence-score`, `show_load_time()`. EXTEND.
- Feed item cards with left-accent border. EXTEND into `<SituationTicker>` items.
- Data stream animation bar. EXTEND.
- Cyberpunk card layer (opt-in). PARTIAL — more neon/gaming than cockpit. REPLACE the neon aesthetic with instrument-panel references while keeping the dark card shape.
- `border-top: 3px solid [accent]` on metric cards. This is the cockpit chrome pattern — keep and formalize as the pillar-color accent.

**[grounded — `streamlit_app/utils/style.py:260–430`]**

### What needs replacement to achieve the cockpit look:

- The CRT scanline pseudo-element (`::after` full-page) reads as gaming/cyberpunk. REMOVE in LepiOS — cockpit is instrument-panel, not retro CRT.
- Neon colors (`#00ff88`, `#ff3366`, `#00d4ff`) — in the Streamlit OS these are opt-in for Command Centre / Prediction Engine. In LepiOS, replace with instrument-green (`#3ddc84`-ish), instrument-amber (`#f59e0b`), and limit cyan to data/info only. Less neon, more mission control.
- `border-radius: 10–12px` on cards. Cockpit components are tighter — 6–8px max, with 4px for inner elements. Rounded-rectangle not pill for cards.
- Font: Streamlit OS uses `"sans serif"` (system default). LepiOS cockpit needs explicit monospace for numbers and a tighter-tracking sans for labels.
- The gold branding (`#c89b37`) was chosen for the Loeppky Business OS brand. LepiOS is a different product — it may keep gold as a pillar accent (Money) but should not use it as the universal brand chrome.

---

## 1. Mood Board (PROPOSED)

Each reference aesthetic below is assessed for what to steal and what to leave behind for a life OS cockpit.

---

### A — Bloomberg Terminal

**Key visual qualities:**
Uncompromising information density. Every pixel earns its place. Black or very dark gray background. Orange-red primary accent (the Bloomberg orange). Monospace numbers everywhere — column alignment is sacred. Status indicators are color-only (no shape redundancy). No decorative gradients. Data is the decoration.

**Steal:**
- Tight grid — rows of data with minimal row height
- Monospace everywhere numbers appear
- Color-coded status that needs no text label (green = good, red = bad, amber = watch)
- The idea that the most important number is just... big. Not in a card with a shadow. Just big, monospace, on the dark ground.
- Single-pixel dividers between data regions

**Leave behind:**
- The pure terminal aesthetic (no icons, no hierarchy — LepiOS needs glanceability and visual hierarchy because Colin is not a Bloomberg operator, he's the operator of his own life)
- The orange-red primary — evokes Bloomberg's brand, not LepiOS's

---

### B — Apollo Mission Control (1969–1972)

**Key visual qualities:**
Banks of glowing gauges. Each operator owns one domain. Status lights in rows. The room is organized so the Flight Director can scan left-to-right and understand the state of the entire mission. Green is nominal. Every amber light is a decision. Every red light is a crisis. No unnecessary decoration — form follows instrument.

**Steal:**
- The pillar structure — each row is a domain, scanned left-to-right, state visible at a glance
- Status lights as primary communication channel
- The concept of a master status (Flight Director's overview = QoL Index)
- Gauge-per-metric design — not a table, not a chart, a gauge you read in 0.2 seconds
- Warm amber on dark — the authentic instrument color

**Leave behind:**
- The purely functional brutalism — LepiOS can be beautiful
- Physical knob/button metaphors (skeuomorphism) — keep it flat-ish with glow

---

### C — High-end Trading Platforms (IBKR Pro, TradingView, ThinkOrSwim)

**Key visual qualities:**
Dark base, tight density, explicit P&L coloring (green positive, red negative — no ambiguity). Time-series charts built into the workflow. Numeric readout of position at all times. The interface assumes you already know what everything means — no tooltips on the main view.

**Steal:**
- Explicit P&L: green numbers for positive, red for negative, no neutral gray — decisions demand color
- The "always-on readout" pattern — key numbers never leave the screen
- Compact tab/tile navigation — not a sidebar of 85 items
- Column alignment of numbers using monospace so +$1,234 and -$234 line up vertically

**Leave behind:**
- Full chart-on-every-panel density (too much for a life OS home screen)
- The "workspace" mental model — Colin needs a home screen, not a trading workspace

---

### D — Sci-fi HUD (Mass Effect, Elite Dangerous, Alien Isolation)

**Key visual qualities:**
The HUD is ambient — it's always there, but it recedes when you're not looking at it. Data glows softly. Radial/arc gauges. Color used with extreme discipline — only what matters right now is bright. The rest is dim.

**Steal:**
- Arc gauges (not bars) for single-metric readouts — more expressive, glanceable
- The ambient lighting model — dim base, bright when needed
- Subtle glow on status lights (not harsh neon — soft glow at low opacity)
- The idea that inactive pillars are visually present but not competing

**Leave behind:**
- Sci-fi chrome and hexagonal clip-paths — too decorative
- Particle effects, lens flares, animated backgrounds — distracting
- Anything that makes this feel like a game UI rather than a real instrument panel

---

### E — Teenage Engineering (OP-1, OP-Z, Pocket Operators)

**Key visual qualities:**
Every element is exactly as complex as it needs to be and no more. The UI vocabulary is minimal — a few colors, simple shapes, heavy use of white space despite being dense. Typography is functional and bold. Physical product feel without skeuomorphism. The orange brand is unmistakable.

**Steal:**
- Extreme intentionality — every element must justify its presence
- The idea that less can be more expressive (large, confident type over small labeled fields)
- Bold, geometric typography for key metrics
- The constraint that color = meaning, not decoration

**Leave behind:**
- The playful/toy aesthetic — LepiOS is a serious life instrument
- Pastel/orange brand palette — doesn't match the dark cockpit base

---

### F — Linear (app)

**Key visual qualities:**
The modern dark-mode baseline that proves dark doesn't have to be heavy. Purple-tinted dark (#16131e range), very subtle border colors, no harsh contrast. Typography is clean, tight, geometric. States change through subtle opacity and color shifts — not dramatic animations. Status indicators are badges, not loud.

**Steal:**
- The purple-tinted dark — richer than pure black, less harsh than pure navy
- Subtle border approach (1px, ~15-25% opacity on a light color)
- Typography scale — tight-spaced headings, comfortable body
- The restraint: most things are dim, key things are bright

**Leave behind:**
- The SaaS product page feel — large cards with lots of padding, soft shadows
- The pastel badge colors
- The implied multi-user, project-management context

---

### G — Arc Browser

**Key visual qualities:**
Spaces and boosts — visual hierarchy through tinted backgrounds and contained sub-sections. Soft gradients on surfaces. The sidebar has life — it's not just a list. Color used per-space/context to build context memory.

**Steal:**
- The per-pillar tinted background concept — each pillar row has a faint tint of its pillar color
- The idea of "spaces" as visual context — Money feels different from Health
- Sidebar with personality and color without being garish

**Leave behind:**
- The friendly/casual consumer feel
- Rounded pill shapes for everything
- High-saturation color splashes

---

### H — Tesla UI

**Key visual qualities:**
Maximum information in minimum space. The 15-inch landscape screen is a command surface. Minimalist controls — no chrome, no borders, just fields. Typography is large and confident. Status communicated through color states. Night mode is pure black with white text.

**Steal:**
- Confidence of large, clean typography — don't shy away from big numbers
- The "instrument cluster" strip concept — a horizontal row of key metrics above the main content
- Night mode purity — no extra decoration, let the data be the UI
- Touch-target discipline — interactive elements are large and obvious

**Leave behind:**
- The pure black (#000000) background — `#0e0e18` with a warm tint reads as more intentional
- Minimal typography only — LepiOS needs hierarchy cues at a glance

---

## 2. Typography Stack (PROPOSED)

### Recommended fonts

| Role | Font | Why |
|---|---|---|
| Display (pillar labels, master metric number, gauge value) | **DM Mono** or **JetBrains Mono** | Monospace, strong verticals, high legibility for large numbers |
| Body/UI (labels, descriptions, section titles) | **Inter** | The standard bearer for tight, functional UI text. Already in shadcn default — keep it. |
| Accent/label (small uppercase tick labels, status text) | **Inter** with `letter-spacing: 0.08–0.12em` + `text-transform: uppercase` | No separate font needed — Inter in caps reads well |

**Primary recommendation: JetBrains Mono for all numbers and key values.** It has tabular figures by default, excellent ligature handling for `->` and `>=` patterns, and reads as instrument panel rather than code editor. DM Mono is the lighter-weight alternative if JetBrains reads too heavy.

Both are available as Google Fonts. Load via:
```
fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap
```

### Type scale (PROPOSED)

| Level | Size | Weight | Font | Tracking | Example use |
|---|---|---|---|---|---|
| `--text-master` | 3.5rem | 700 | JetBrains Mono | 0 | QoL Index score (the big number) |
| `--text-pillar-value` | 2rem | 700 | JetBrains Mono | 0 | Pillar gauge value (P&L today) |
| `--text-heading` | 1.1rem | 600 | Inter | 0 | Section header |
| `--text-label` | 0.75rem | 600 | Inter | 0.08em | Metric label (uppercase) |
| `--text-body` | 0.875rem | 400 | Inter | 0 | Descriptions, feed text |
| `--text-small` | 0.72rem | 400 | Inter | 0.04em | Status text, timestamps |
| `--text-ticker` | 0.75rem | 500 | JetBrains Mono | 0 | Situation Room ticker |
| `--text-nano` | 0.65rem | 400 | Inter | 0.1em | Gauge min/max labels |

**Key rule:** All numeric values — P&L, percentages, scores, prices — use JetBrains Mono. All non-numeric labels use Inter. The contrast in texture instantly communicates "this is a number, that is a label."

---

## 3. Color Token Proposal (PROPOSED)

Full CSS custom properties set. These are starting values — locked after the taste session in §7.

```css
:root {
  /* ── Background hierarchy ── */
  --color-base:         #0b0c14;   /* deepest background — app container */
  --color-surface:      #12131f;   /* card backgrounds, pillar rows */
  --color-surface-2:    #1a1b2e;   /* nested surfaces, input backgrounds */
  --color-overlay:      #22243a;   /* modals, tooltips, hover states */

  /* ── Brand / primary accent ── */
  /* NOTE: LepiOS brand color is pending taste session. Two candidates: */
  --color-accent:       #4f7aff;   /* Option A: electric blue — instrument, mission control */
  /* --color-accent:    #7c5cfc;   Option B: violet — matches the purple tint of the dark base */
  --color-accent-dim:   rgba(79, 122, 255, 0.15);

  /* ── Status semantics (non-negotiable — these are instrument colors) ── */
  --color-positive:     #3ddc84;   /* green — healthy, profit, good trend */
  --color-positive-dim: rgba(61, 220, 132, 0.12);
  --color-warning:      #f59e0b;   /* amber — caution, watch, off-target */
  --color-warning-dim:  rgba(245, 158, 11, 0.12);
  --color-critical:     #ef4444;   /* red — loss, alert, broken */
  --color-critical-dim: rgba(239, 68, 68, 0.12);
  --color-info:         #60a5fa;   /* blue — neutral data, system status */
  --color-info-dim:     rgba(96, 165, 250, 0.12);

  /* ── Pillar colors (each pillar has a distinct hue) ── */
  /* These tint the pillar row background and the pillar gauge accent */
  --color-pillar-money:   #f59e0b;   /* amber/gold — wealth, money, trade */
  --color-pillar-health:  #3ddc84;   /* green — vitality, wellness */
  --color-pillar-growing: #60a5fa;   /* blue — learning, advancement */
  --color-pillar-happy:   #a78bfa;   /* violet — emotional, personal */

  /* Dim tints for pillar row backgrounds */
  --color-pillar-money-tint:   rgba(245, 158, 11, 0.04);
  --color-pillar-health-tint:  rgba(61, 220, 132, 0.04);
  --color-pillar-growing-tint: rgba(96, 165, 250, 0.04);
  --color-pillar-happy-tint:   rgba(167, 139, 250, 0.04);

  /* ── Text hierarchy ── */
  --color-text-primary:   #f0eef8;   /* headings, key numbers */
  --color-text-secondary: #c4c0d8;   /* body text, labels */
  --color-text-muted:     #7a7890;   /* subtitles, secondary info */
  --color-text-disabled:  #3e3c50;   /* inactive, placeholder */

  /* ── Borders / separators ── */
  --color-border:         rgba(255, 255, 255, 0.07);  /* default card border */
  --color-border-accent:  rgba(255, 255, 255, 0.12);  /* hover/focus border */
  --color-border-pillar:  rgba(255, 255, 255, 0.05);  /* pillar row dividers */
  --color-chrome:         rgba(255, 255, 255, 0.06);  /* cockpit chrome lines */

  /* ── Instrument chrome (the top rail and structural lines) ── */
  --color-rail:           #c89b37;    /* retained from Streamlit OS — gold top rail */
  --color-rail-glow:      rgba(200, 155, 55, 0.35);

  /* ── Typography tokens ── */
  --font-mono:  'JetBrains Mono', 'Courier New', monospace;
  --font-ui:    'Inter', system-ui, -apple-system, sans-serif;

  /* ── Spacing rhythm (cockpit = tight) ── */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  24px;
  --space-6:  32px;

  /* ── Border radius ── */
  --radius-sm:  4px;    /* inner elements — status lights, badges */
  --radius-md:  6px;    /* cards, rows */
  --radius-lg:  10px;   /* large containers, master gauge panel */
  --radius-pill: 999px; /* PillBar specifically */

  /* ── Transitions ── */
  --transition-snap:   80ms ease;    /* status light changes */
  --transition-fast:   150ms ease;   /* gauge value changes */
  --transition-normal: 250ms ease;   /* row hover, expand */
}
```

### Rationale notes

**Why retain `--color-rail: #c89b37`?** The gold top pinstripe in the Streamlit OS (`streamlit_app/utils/style.py:36`) is a strong brand signal that connects the two products. Retaining it as structural chrome (not as the universal accent) preserves continuity without making LepiOS look like a re-skin.

**Why amber for Money pillar?** Money and amber are semantically linked in instrument panels — think fuel gauge, trading P&L color conventions, gold as wealth symbol. It's also the color that earns immediate attention. Using it for Money (the v1 priority pillar) is correct.

**Why violet for Happy pillar?** Violet is warm-cool, slightly mysterious, associated with wellbeing and introspection. It differentiates from the functional greens and blues while not reading as an error state.

**Color earns its brightness** (per ARCHITECTURE.md §4): base palette is deliberately low-saturation. The status colors and pillar accents only appear at full brightness when a gauge or status light needs attention. Background tints of pillar colors are at 4% opacity — barely visible when all is nominal.

---

## 4. Motion Principles (PROPOSED)

### What should animate vs. what should be static

| Element | Animate? | Why |
|---|---|---|
| Gauge value change | Yes — value morphs, fill sweeps | Core feedback loop — Colin needs to see that the number updated |
| Status light on/off transition | Yes — fade + brief glow pulse on change | Alert signal; should not be invisible |
| Status light steady state | Static (no loop) | Looping pulse = anxiety. Reserve pulse for actual alerts only |
| PillBar fill level change | Yes — width transitions on data refresh | Communicates magnitude change |
| Master gauge value | Yes — count-up on page load | Sets the tone; confirms freshness |
| Pillar row hover | Yes — subtle lift (translateY -1px + border brightens) | Affordance cue |
| Situation Room ticker | Scroll if >1 item, static if 1 | More than 1 active headline = visible scroll; single headline = static |
| Page transitions | Minimal — fade only | Not a consumer app; transitions should not delay reading data |
| Background / decorative elements | Static | No animated backgrounds — they compete with the data |

### Animation timing guidelines (PROPOSED)

**Snap (80ms):** Status light state changes. Acknowledge-and-done. If the safety agent goes red, Colin notices immediately.

**Fast (150ms):** Gauge value update, PillBar fill change, button active state. Responsive to data refresh. Feels like instrument needle settling.

**Normal (250ms):** Row hover, card expand, modal open/close. Standard interaction feedback.

**Slow (400ms, use sparingly):** Master QoL gauge count-up on initial page load only. Cinematic entrance once per session to communicate this is a command center, not a form. Not on every refresh.

**Never:** Looping decorative animations on elements Colin looks at all day. The Streamlit OS has a looping `.data-stream` animation bar — that pattern is valid for a loading indicator but should not be ambient decoration in LepiOS.

### Specific micro-interactions (PROPOSED)

**Gauge value change:**
When the gauge value refreshes, the fill arc/bar transitions from old to new value over 150ms with an ease-out curve. The numeric readout counts up or down over 200ms. This confirms data freshness without being distracting.

**Status light change (green → amber):**
The light fades from green to amber over 80ms, then pulses once (80ms brighter → 80ms settle). One pulse only. No loop. The pulse is the alert; the steady amber is the sustained state.

**Pillar row hover:**
Background tint shifts from pillar-tint at 4% opacity to 7% opacity. Border goes from `--color-border` to `--color-border-accent`. Row lifts 1px. Transition: 150ms ease. No shadow — cockpit rows don't float.

**Next Move button:**
On hover: subtle glow in the master accent color spreads out from the button perimeter. On click: 80ms press (scale 0.97), then spring back. This is the most important button on the screen — it should feel like pressing something real.

---

## 5. Primitive Design Specs (PROPOSED)

All dimensions assume a 1440px wide display (Colin's primary). Responsive scaling follows.

---

### `<Gauge>`

**Style recommendation:** Arc gauge (speedometer-style), reading 0–100% clockwise from ~7 o'clock to ~5 o'clock (200° sweep).

**Why arc over bar?** A bar gauge reads as a progress bar — completion of a task. An arc gauge reads as an instrument — state of a system. For "how healthy is my Money pillar right now?" the arc is the right metaphor. This is the taste session question.

**Visual spec:**
- Background arc: `--color-surface-2`, 4px stroke weight, full 200° sweep
- Fill arc: pillar color at full brightness, 4px stroke weight, animates fill percentage
- Center: large monospace number (JetBrains Mono, `--text-pillar-value`), pillar color
- Label: small uppercase label below center (`--text-label`, `--color-text-muted`)
- Outer ring: `--color-chrome` at 1px, subtle border-only ring around the gauge face
- Delta: small `+$X` / `-$X` in `--color-text-muted` below the main number, colored by positive/negative
- Diameter: 120px for pillar gauges, 180px for master gauge
- Does NOT have decorative tick marks or bezels — clean instrument face only

**0–100% behavior:**
- 0–30%: fill arc in `--color-critical`
- 30–70%: fill arc in `--color-warning`
- 70–100%: fill arc in `--color-positive`
- Exact thresholds: configurable per pillar — Money may have different "healthy" threshold than Happy

---

### `<PillBar>`

**Style:** Horizontal pill-shaped power bar. Full width of its container minus padding.

**Visual spec:**
- Container: `--color-surface-2`, `--radius-pill`, height: 10px
- Fill: pillar color (or status color if threshold-triggered), `--radius-pill`, animated width
- Label: left of bar, `--text-small`, `--color-text-muted`
- Value: right of bar, `--text-small`, JetBrains Mono, `--color-text-secondary`
- Percentage text: inside fill area if >20% wide, else right of fill, `--text-nano`, pillar color
- Sub-pillars (e.g., Amazon P&L, Sports Betting P&L, Trading P&L as sub-bars under Money) use the same primitive at 6px height

**The Loeppky OS already has `.confidence-meter` with a large number display — this should NOT be reused as a PillBar. Build new.** [grounded — `streamlit_app/utils/style.py:402–422`]

---

### `<StatusLight>`

**Style:** Small circle, 10px diameter. Two states: nominal and alert.

**Visual spec:**
- Shape: circle, `border-radius: 50%`
- Nominal: solid fill at 60% opacity, no shadow, no animation
- Alert: solid fill at 100% opacity, one pulse (soft glow shadow, 1 cycle only), then steady
- Colors map to status semantics: green/amber/red/blue (info)
- Pairs with a label to its right: `--text-small`, uppercase, `--color-text-muted`
- Row: `<StatusLight>` chips displayed horizontally in the status bar with `8px` gap
- The `.agent-dot` pattern from the Streamlit OS is the right shape — keep size, remove looping animation for steady state [grounded — `streamlit_app/utils/style.py:347–375`]

---

### `<CockpitRow>`

**Style:** Full-width horizontal strip. Each of the 4 pillars gets one row.

**Visual spec:**
- Background: `--color-surface` with the pillar's `--color-pillar-X-tint` overlay
- Left edge: 3px solid vertical bar in the pillar color (the "left accent rail" pattern from Streamlit OS — `style.py:183–185` — formalized here)
- Height: auto (expands to content), minimum 80px
- Contents left-to-right:
  1. Pillar label (Inter, `--text-label`, pillar color) — 80px reserved width
  2. Gauge strip: 3–5 `<PillBar>` components or 1 `<Gauge>` depending on data type
  3. Summary number: JetBrains Mono, `--text-pillar-value`, status-colored
  4. Delta: small +/- from previous day/week
- Separation between rows: 1px `--color-border-pillar`
- On hover: background tint shifts as described in §4

**Inactive pillars (Health, Growing, Happy in v1):** Row renders at 40% opacity. Label reads "Coming in v2." No gauge data shown. The row is present and sized correctly — the future pillars are visible but clearly offline.

---

### `<NextMoveButton>`

**Style:** Prominent but not aggressive. This is the single most important interactive element.

**Visual spec:**
- Size: min-width 200px, height 48px
- Typography: Inter, 14px, weight 600, `--color-text-primary`
- Background: `--color-surface-2` (not the accent color — the button earns its prominence through placement and label, not color aggression)
- Left accent border: 3px solid `--color-accent`
- Right side: small arrow icon or `→` in `--color-accent`
- Text label: dynamic — "Next Move: [agent recommendation short label]" — 2-line max
- Placement: adjacent to master gauge, in the top band
- On hover: accent color bleeds in as a 20% background tint, glow spreads, label brightens

**Why not a filled button in the accent color?** The cockpit aesthetic teaches restraint. A filled electric-blue button would dominate the screen and compete with status colors. The bordered-with-accent approach says "this is important" without shouting. The taste session question §7/Q7 will confirm this.

---

### `<SituationTicker>`

**Style:** Slim horizontal strip at the bottom of the home screen. Latest council deliberation.

**Visual spec:**
- Height: 32px
- Background: `--color-surface` with a subtle top border in `--color-chrome`
- Typography: JetBrains Mono, `--text-ticker`, `--color-text-secondary`
- Prefix label: "SITUATION —" in `--color-accent`, uppercase, small, 8px right margin
- Content: scrolls horizontally if text overflows container, loops every 8s (only when text is longer than container width); static if short enough
- At left: timestamp in `--color-text-disabled` (shows data freshness)
- At right: a single small status chip showing how many active council items exist

**The Streamlit OS `.ticker-row` / `.ticker-chip` pattern is close in shape but uses font-family monospace implicitly.** For LepiOS, the ticker chip is formalized as `<SituationTicker>` and uses explicit JetBrains Mono. [grounded — `streamlit_app/utils/style.py:447–468`]

---

## 6. Anti-Pattern List (PROPOSED)

Specific defaults to override in shadcn/Tailwind before writing any cockpit component.

### Rounded corners that feel too soft

| Default | Override | Why |
|---|---|---|
| `rounded-lg` = 8px (Tailwind) / `border-radius: 0.5rem` (shadcn) | Cards: `--radius-md` (6px). Inputs: 4px. | 8px reads as SaaS. 6px reads as instrument panel. The difference is subtle but real. |
| shadcn `<Card>` default: large padding + `rounded-xl` | Tighten to `--radius-md`, reduce padding by ~30% | Cockpit components are dense |
| shadcn `<Badge>`: `rounded-full` | Keep `rounded-full` for status pills and `<StatusLight>`. Change to `rounded` for data badges. | Pills = semantic status. Rectangular badges = data label. |

### Default color palette elements to replace

| shadcn/Tailwind default | LepiOS replacement | Reason |
|---|---|---|
| `background: hsl(var(--background))` (typically near-white or very light) | `--color-base: #0b0c14` | Cockpit is dark |
| `text-foreground` (black or near-black) | `--color-text-primary: #f0eef8` | Inverse |
| `text-muted-foreground` (gray-500 range) | `--color-text-muted: #7a7890` | Stays gray but with a violet undertone |
| shadcn primary color (often a saturated blue or default) | `--color-accent` (pending taste session) | Brand is LepiOS, not shadcn |
| Default green (Tailwind `green-500` / `#22c55e`) for positive states | `--color-positive: #3ddc84` | The Android-green is too familiar. #3ddc84 reads more as instrument green |
| shadcn `<Progress>` (default blue fill, flat) | Full rebuild as `<PillBar>` | Progress bar ≠ PillBar |

### Default typography choices to replace

| Default | Override | Reason |
|---|---|---|
| shadcn system-ui default fonts | Load Inter + JetBrains Mono explicitly | System-ui varies by OS — consistency required |
| Numbers in body font (Inter / system-ui) | All numeric values in JetBrains Mono via `font-variant-numeric: tabular-nums` or explicit font-family swap | Monospace numbers are non-negotiable for a financial cockpit |
| Default `text-sm` (14px) for metric values | `--text-pillar-value` (2rem) for pillar readouts | Metrics must be readable at a glance |
| Default heading tracking (0 letter-spacing) | `--text-label`: `letter-spacing: 0.08em` for uppercase labels | Uppercase labels need tracking to avoid cramping |

### Spacing/density defaults to override

| Default | Override | Reason |
|---|---|---|
| shadcn `<Card>` padding: `p-6` (24px) | Pillar rows: `px-4 py-3` (16px/12px). Inner elements: `p-3`. | Cockpit density — more data per vertical pixel |
| shadcn `<Table>` row height: comfortable (~40px) | Status bar row: 32px. Pillar rows: 80px min but auto. | Two distinct densities: status strip (dense) vs pillar row (readable) |
| Tailwind gap defaults (`gap-4` = 16px between columns) | `gap-3` (12px) within a pillar row. `gap-2` (8px) between PillBars. | Tighter gives cockpit feel |
| `p-4` default on panels | Top band (master gauge): `px-6 py-4`. Pillar rows: `px-4 py-3`. | Consistent rhythm without wasted space |

---

## 7. Taste Session Script (PROPOSED)

**Format:** Colin answers each question, selecting A, B, or C (or combining if noted). Answers become locked design tokens before any cockpit code is written.

**Duration:** ~10 minutes.
**Deliverable:** After answering all 10 questions, a developer can write the full CSS token file without asking a single follow-up question.

---

### Pre-session context (read aloud or silently before answering)

You're designing the home screen of your life command center. It's the first thing you see every morning. It needs to tell you the state of your money, health, growth, and happiness in under 3 seconds. Every design decision should serve that goal.

---

**Q1 — Color temperature (the feel of the dark)**

The base dark background has two main directions:

> A) **Cool-dark** (`#0b0c14` — very dark near-black with a hint of blue-indigo). Feels like mission control, deep space, professional instrument panel. References: Linear app, Arc browser, Tesla night mode.
>
> B) **Warm-dark** (`#0e0e18` with a slight warm tint). Feels more like trading floor at night, Bloomberg dark. The current Streamlit OS uses this. Slightly more familiar.
>
> C) **Neutral-dark** (`#0d0d0d` — pure dark gray, almost true black). Maximum contrast, most "developer tool" feel. Less atmosphere, more brutalist.

*This sets the tone for everything else. Which feels right for a life command center you open every morning?*

---

**Q2 — Primary accent / brand color**

The one color that says "this is LepiOS." Used on the Next Move button border, active tab indicators, and the master QoL gauge arc.

> A) **Electric blue** (`#4f7aff`). Instrument, mission control, data-forward. Reminiscent of high-end trading platforms and aerospace HUDs.
>
> B) **Violet/indigo** (`#7c5cfc`). Richer, more personal. Matches the blue-tinted dark base. Arc browser energy.
>
> C) **Keep the gold** (`#c89b37`). Continue the Streamlit OS brand language. Familiar, yours, warm.

*The accent appears sparingly — borders, key highlights, and the Next Move button. Which feels like Colin's command center, not someone else's product?*

---

**Q3 — Gauge style (for the Money pillar P&L)**

> A) **Arc gauge** (like a speedometer — 200° sweep, number in the center). Analog, physical, instrument-panel. Reads glanceable state at 0.2 seconds. Strongest for single-pillar health score.
>
> B) **Horizontal PillBar** (full-width filled bar — target/actual). Clean, Bloomberg-style, more data-dense. Works well when showing multiple sub-metrics in one row.
>
> C) **Large number with delta arrow** (minimal — just "$1,234 ▲ +$80 today"). Trading platform P&L style. Maximum density, minimum decoration. No gauge shape at all.

*Note: A and B are not mutually exclusive — Q4 will ask whether sub-pillar metrics use PillBars. This question is specifically about the primary pillar summary visual.*

---

**Q4 — Sub-pillar density**

Within the Money pillar row, there are sub-metrics: Amazon P&L, Trading P&L, Sports Betting P&L, Expenses. How dense should this sub-data be on the home screen?

> A) **Show all sub-metrics** as PillBars within the pillar row (4 bars, each labeled). Dense but complete — you see everything without clicking.
>
> B) **Show summary only** on the home screen (one number per pillar). Click/expand to see sub-metrics. Cleaner home screen, one more tap to see details.
>
> C) **Show top 2 sub-metrics only** (the two most critical) inline, rest on expand. Balance of density and cleanliness.

---

**Q5 — Motion level**

> A) **Snappy and responsive** — gauges update with fast transitions (150ms), status lights snap between states, page loads feel instant. No cinematic sequences. Every animation is functional, not decorative.
>
> B) **One cinematic moment** — on initial page load, the master QoL gauge counts up from 0 (400ms). Everything else is snappy. One moment of "this is the command center" then back to pure function.
>
> C) **Minimal motion** — data updates are immediate, no transitions. The only animation is the status light pulse on alert. Everything else is instant. For when you want maximum focus and no distraction.

---

**Q6 — Pillar color assignments**

Proposed in §3: Money=amber, Health=green, Growing=blue, Happy=violet. Alternative assignments:

> A) **Keep proposed** (Money=amber/gold, Health=green, Growing=blue, Happy=violet). Semantically obvious — gold for money, green for health, blue for growth/learning, violet for emotional wellbeing.
>
> B) **Monochromatic** — all pillars use the same primary accent color at different brightness levels. Cleaner, more unified, less visually busy. Differentiation comes from position and label only.
>
> C) **Alternative mapping** — specify your own. (e.g., if red feels right for Money because it's about P&L and trading, or if you want green to mean money, not health.)

---

**Q7 — Next Move button prominence**

> A) **Understated** — bordered rectangle with accent color, same visual weight as other UI elements. "It's there if you want it, not demanding attention." The data speaks first.
>
> B) **Moderately prominent** — slightly elevated with a soft glow on the accent color, clearly the primary action but not visually dominant over the data.
>
> C) **Dominant** — high-contrast filled button, always-visible, possible pulsing glow. "This is what I do next — it's the reason I opened the app." Commands immediate attention.

---

**Q8 — Typography size (is bigger better?)**

> A) **Large and confident** — QoL Index shows at 3.5rem, pillar values at 2rem. Numbers you can read from across a room. Bloomberg large-number energy.
>
> B) **Balanced** — QoL Index at 2.5rem, pillar values at 1.5rem. More compact, fits more information at native density without scrolling.
>
> C) **Dense** — QoL Index at 1.8rem, pillar values at 1.2rem. Maximum information per screen. Everything fits in one scroll viewport. More trading terminal than spacecraft.

---

**Q9 — Status bar position**

The system status lights (Oura synced / Amazon feed live / Supabase healthy / Safety agent / Token budget / Context budget) need a home.

> A) **Top strip** — thin horizontal bar above the pillar rows, always visible. You see system health before you see life health.
>
> B) **Bottom strip** — slim bar at the very bottom of the screen, below the Situation Ticker. Ambient presence, doesn't compete with data.
>
> C) **Collapsed by default** — a single "system green" or "system amber" indicator in the corner; expand to see individual lights. Cleaner home screen, one click to diagnose.

---

**Q10 — Situation Room Ticker behavior**

> A) **Auto-scrolling marquee** — continuously scrolls latest deliberation output, left to right, always moving. Mimics a real news ticker. You notice new information without actively checking.
>
> B) **Static with timestamp** — latest headline shown statically, timestamp at left. Click to open full Situation Room. Clean, non-distracting.
>
> C) **Fading rotation** — one headline at a time, fades out every 8 seconds and the next fades in. Cinematic, less mechanical than marquee, still ambient.

---

### Post-session token resolution

After answering all 10 questions, map answers to token overrides:

| Answer | Token override |
|---|---|
| Q1-A | `--color-base: #0b0c14` |
| Q1-B | `--color-base: #0e0e18` |
| Q1-C | `--color-base: #0d0d0d` |
| Q2-A | `--color-accent: #4f7aff` |
| Q2-B | `--color-accent: #7c5cfc` |
| Q2-C | `--color-accent: #c89b37` |
| Q3-A | `<Gauge>` = arc style |
| Q3-B | `<Gauge>` = PillBar style |
| Q3-C | `<Gauge>` = number+delta style |
| Q4-A | `--cockpit-sub-density: full` |
| Q4-B | `--cockpit-sub-density: summary-only` |
| Q4-C | `--cockpit-sub-density: top-2` |
| Q5-A | All transitions at fast tier (150ms) only |
| Q5-B | Master gauge count-up at 400ms, rest at 150ms |
| Q5-C | `--transition-fast: 0ms` (instant); pulse only |
| Q6-A | Pillar tokens as proposed in §3 |
| Q6-B | All pillars use `--color-accent` |
| Q6-C | Colin specifies — document new mapping |
| Q7-A | `<NextMoveButton>` = border variant |
| Q7-B | `<NextMoveButton>` = glow variant |
| Q7-C | `<NextMoveButton>` = filled dominant variant |
| Q8-A | `--text-master: 3.5rem`, `--text-pillar-value: 2rem` |
| Q8-B | `--text-master: 2.5rem`, `--text-pillar-value: 1.5rem` |
| Q8-C | `--text-master: 1.8rem`, `--text-pillar-value: 1.2rem` |
| Q9-A | Status bar = `position: top` |
| Q9-B | Status bar = `position: bottom` |
| Q9-C | Status bar = `collapsed` (single indicator) |
| Q10-A | `<SituationTicker>` = marquee scroll |
| Q10-B | `<SituationTicker>` = static |
| Q10-C | `<SituationTicker>` = fade-rotate |

---

## Grounding Manifest

| Claim | Source | Type |
|---|---|---|
| Streamlit OS color tokens (gold, red, cyan, base bg) | `streamlit_app/utils/style.py:22–53` | grounded |
| CRT scanline pseudo-element | `streamlit_app/utils/style.py:263–278` | grounded |
| Agent dot pulse animation | `streamlit_app/utils/style.py:347–375` | grounded |
| Cyberpunk card layer is opt-in | `streamlit_app/utils/style.py:259–261` | grounded |
| Border-top: 3px gold on metric cards | `streamlit_app/utils/style.py:66–72` | grounded |
| `.confidence-score` uses `font-family: monospace` | `streamlit_app/utils/style.py:409` | grounded |
| `.ticker-chip` uses `font-family: monospace` | `streamlit_app/utils/style.py:460` | grounded |
| `.agent-time` uses `font-family: monospace` | `streamlit_app/utils/style.py:386` | grounded |
| Section label left border: 3px `#cc1a1a` | `streamlit_app/utils/style.py:183–185` | grounded |
| Streamlit config.toml theme values | `streamlit_app/.streamlit/config.toml:14–19` | grounded |
| Font = "sans serif" (system default) in Streamlit OS | `streamlit_app/.streamlit/config.toml:19` | grounded |
| Gold pinstripe top rail | `streamlit_app/utils/style.py:31–40` | grounded |
| Status pills: green/red/blue/yellow/purple/gray | `streamlit_app/utils/style.py:244–250` | grounded |
| `.data-stream` looping animation | `streamlit_app/utils/style.py:388–401` | grounded |
| ARCHITECTURE.md §4 cockpit aesthetic | `lepios/ARCHITECTURE.md:89–104` | grounded |
| ARCHITECTURE.md §4.3 Design Council deliverable | `lepios/ARCHITECTURE.md:103–104` | grounded |
| Design reference list | `lepios/ARCHITECTURE.md:63–68` | grounded |
| All design proposals (§1–§6) | This document | PROPOSED — not locked |
| All taste session answer→token mappings | This document | PROPOSED — locked after §7 answers |
