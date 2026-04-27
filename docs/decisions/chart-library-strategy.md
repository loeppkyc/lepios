# Decision: Chart Library Strategy

**Date:** 2026-04-27  
**Status:** PENDING COLIN APPROVAL  
**Trigger:** W4 grounding audit found "no charting library" blocks both Keepa Intel (BSR history line chart) and Oura Health (score trends, sleep breakdown). Earlier audited modules will hit the same blocker. Decided once here to avoid per-module re-litigation.

---

## 1. Audit Results

### Zero charting libraries in package.json (grounded)

Searched all keys in `dependencies` + `devDependencies` for: recharts, @tremor, visx, d3, chart.js, victory, nivo, apexcharts. **All returned no matches.** React version: 19.2.4.

### Existing chart code (grounded — all hand-rolled)

| File                                                                   | Implementation                      | Chart types                          | Lines of chart code | Limitation                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------- | ------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `app/(cockpit)/amazon/_components/AmazonDailyChart.tsx`                | Tailwind proportional bars          | Bar (revenue + units, dual-series)   | ~80                 | No Y-axis, no gridlines, no interactive tooltip. TODO comment on line 5 explicitly flags Recharts as the target. |
| `app/(cockpit)/utility/page.tsx` `MiniBarChart`                        | Tailwind proportional bars          | Bar (single series)                  | ~60                 | Same limitations. Inline in page file — no shared component.                                                     |
| `app/(dashboard)/autonomous/_components/QualityTrends.tsx` `Sparkline` | Hand-rolled SVG with pen-lift logic | Sparkline (single series, null gaps) | ~80                 | Works correctly for its purpose. Null-gap logic is non-trivial.                                                  |

### shadcn already installed

`shadcn: ^4.3.0` is in `dependencies`. The `chart` component is NOT yet added (confirmed: `components/ui/chart*` glob returned no matches). Adding it is `npx shadcn@latest add chart` — same flow as adding any other shadcn component.

### Queued modules that need charts

| Module                       | Chart types needed                                                                         | Without a lib                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Keepa Intel                  | BSR history line (time-series), token budget bar                                           | Hand-rolled SVG needed — multi-day time axis is painful without a scale |
| Oura Health                  | Score trends line (3 series), sleep breakdown stacked bar, HRV line, Resting HR line       | 4 separate chart implementations — ~300+ lines of bespoke SVG           |
| Amazon Orders (augmentation) | Already has AmazonDailyChart — but Orders tab will need ComposedChart (bar + line overlay) | Requires another full custom implementation                             |
| Business Review (future)     | Revenue trends, expense breakdown, monthly P&L                                             | Multiple chart types across tabs                                        |

---

## 2. Options Evaluated

### Option A — Stay with Tailwind bars indefinitely

**Pros:** Zero bundle delta, zero new dependency, no migration.  
**Cons:** Fails immediately for Oura score trends (line chart, 3 series) and Keepa BSR history (time-series line with date axis). Every new chart type requires custom SVG math. Not coordinator-friendly — coordinators would need to spec SVG path calculations per chart. QualityTrends sparkline already took ~80 lines for 120×40px of output.

**Verdict: Not viable beyond current modules.** Already failing for queued modules.

---

### Option B — Recharts (raw)

**Bundle:** ~90KB gzipped.  
**Chart types:** LineChart, BarChart, AreaChart, ComposedChart, PieChart, RadarChart, ScatterChart.  
**React 19:** Recharts 2.15.x peer dep is `"react": ">=16"` — confirmed compatible with React 19.  
**Coordinator-friendliness:** Excellent. `<LineChart>`, `<BarChart>`, `<CartesianGrid>`, `<Tooltip>` are standard, well-documented, unambiguous to spec.  
**Design system:** Recharts accepts `stroke`, `fill` as props — can pass LepiOS CSS vars (`var(--color-pillar-money)`) directly. Works but requires manual token threading per chart.

---

### Option C — shadcn/ui Chart component (Recharts + CSS var layer)

**Bundle:** ~90KB gzipped (identical to raw Recharts — shadcn chart IS Recharts, with a thin CSS var wrapper).  
**Chart types:** Same as Recharts — full set.  
**React 19:** Same as Recharts (compatible).  
**Coordinator-friendliness:** Better than raw Recharts. shadcn chart exposes `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend` — standardized API same as other shadcn components already in LepiOS. Coordinator specs it exactly like speccing a Button or Card.  
**Design system:** This is the key advantage. shadcn chart uses `--chart-1` through `--chart-5` CSS variables that map to the existing Design Council token system. Colors flow through automatically without manual prop threading. The `chart.tsx` component integrates natively with `globals.css`.  
**Install:** `npx shadcn@latest add chart` → scaffolds `components/ui/chart.tsx` and adds `recharts` to `package.json`.

---

### Option D — Tremor

**Bundle:** ~180KB gzipped (Recharts + Radix UI + Tremor UI layer).  
**Coordinator-friendliness:** Highest (very opinionated, simple props).  
**Design system:** Bad fit. Tremor has its own design system that will conflict with LepiOS's Design Council (custom CSS vars, color tokens, typography). Any Tremor component would need its theme overridden to match — defeating the purpose.  
**Verdict: Rejected.** Double the bundle size of Recharts with worse design system integration.

---

### Option E — visx (low-level)

**Bundle:** Modular (~30-60KB for a typical subset).  
**Coordinator-friendliness:** Poor. visx requires explicit scale setup (`scaleTime`, `scaleLinear`), axis rendering, and SVG layout math per chart. Coordinators would need to spec D3-level detail.  
**Verdict: Rejected.** Maximum-flexibility tooling is not the right fit for coordinator-driven module builds.

---

## 3. Decision: shadcn/ui Chart (Option C)

**Recommendation: Add the shadcn chart component.** This is not a new dependency decision — it is adding one more shadcn component to a project that already uses shadcn. The bundle cost is Recharts (~90KB gzipped), which is route-split by Next.js 16: only pages that import chart components pay it. Pages without charts are unaffected.

### Why not raw Recharts (Option B)?

The shadcn chart component is a thin CSS-var wrapper over Recharts. It adds zero overhead. The upside is non-trivial: `--chart-1` through `--chart-5` variables wire directly into `globals.css`, coordinators use a standardized component API instead of raw Recharts props, and the tooltip/legend components match the LepiOS Design Council style out of the box. Raw Recharts would require manual `stroke="var(--color-pillar-money)"` threading in every chart component spec — coordinators would get it wrong half the time.

### F19 justification

Current Tailwind bar charts have no Y-axis labels, no gridlines, no interactive tooltips, and no support for multi-series line charts. shadcn/Recharts delivers all four at no coordinator overhead cost. Every new chart module becomes a ~30-line spec instead of a ~100-line SVG implementation. The 20% improvement is structural, not incremental.

---

## 4. What to Migrate vs. Defer

| File                            | Action                | Rationale                                                                                                                                                                                                                           |
| ------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AmazonDailyChart.tsx`          | **MIGRATE in PoC**    | Already has TODO comment pointing to Recharts. Most visible chart in production. Validates CSS var token flow.                                                                                                                      |
| `utility/page.tsx` MiniBarChart | **MIGRATE alongside** | Inline in page — extracting to use shadcn BarChart is a simplification. Only 2 instances.                                                                                                                                           |
| `QualityTrends.tsx` Sparkline   | **DEFER**             | Hand-rolled SVG sparkline works correctly. Null-gap pen-lift logic is non-trivial to replicate. Recharts has no first-class sparkline; shadcn chart doesn't expose one. Migrate only if QualityTrends needs additional chart types. |

**Migration count: 2 files confirmed, 1 deferred.**

---

## 5. Bundle Size Delta

| Scenario                                         | Gzipped JS delta | Notes                                            |
| ------------------------------------------------ | ---------------- | ------------------------------------------------ |
| Pages without charts                             | +0 KB            | Next.js 16 route-splits — chart chunk not loaded |
| Pages with charts (amazon, utility, keepa, oura) | +~90 KB          | Recharts shared chunk, loaded once, cached       |
| Tremor (rejected)                                | +~180 KB         | For comparison                                   |

90KB shared across all chart pages is the correct framing. It is not 90KB per page — it's one chunk loaded once by the browser and reused.

---

## 6. Proof-of-Concept Migration Plan

**Target:** `AmazonDailyChart.tsx` → shadcn `BarChart` with `ComposedChart` pattern.

**Install step (if approved):**

```bash
npx shadcn@latest add chart
# Scaffolds: components/ui/chart.tsx
# Adds to package.json: recharts ^2.x
```

**Migration spec for `AmazonDailyChart.tsx`:**

Current: Tailwind proportional bars, dual-series (revenue + units), no Y-axis, no tooltip beyond `title` attr, ~193 lines.

After migration (~80 lines):

```tsx
'use client'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { DailyChartPoint } from '@/lib/amazon/reports'

const chartConfig = {
  revenue: { label: 'Revenue (CAD)', color: 'var(--color-pillar-money)' },
  units: { label: 'Units', color: 'var(--color-text-disabled)' },
}

export function AmazonDailyChart({ data }: { data: DailyChartPoint[] }) {
  const hasData = data.some((d) => d.revenue > 0 || d.units > 0)
  if (!hasData) return <EmptyState />

  return (
    <ChartContainer config={chartConfig} className="h-[160px] w-full">
      <BarChart data={data} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--color-border)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: 'var(--color-text-disabled)' }}
          interval={4}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: 'var(--color-text-disabled)' }}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="revenue"
          fill="var(--color-pillar-money)"
          radius={[2, 2, 0, 0]}
          opacity={0.85}
        />
        <Bar
          dataKey="units"
          fill="var(--color-text-disabled)"
          radius={[2, 2, 0, 0]}
          opacity={0.6}
        />
      </BarChart>
    </ChartContainer>
  )
}
```

**Validation test:** Build must pass, `/cockpit/amazon` must render the chart with Y-axis, gridlines, and hover tooltip.

---

## 7. Pattern Reference for Future Modules

Once installed, coordinators spec charts using these patterns:

| Chart type       | Module                               | Pattern                                                           |
| ---------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Time-series line | Keepa BSR history, Oura score trends | `<LineChart>` + `<Line>` per series                               |
| Stacked bar      | Oura sleep breakdown                 | `<BarChart>` + `<Bar stackId="a">` per stage                      |
| Dual bar         | Amazon Orders                        | `<BarChart>` + 2 `<Bar>` (already proven in AmazonDailyChart PoC) |
| Combo bar+line   | Future business review               | `<ComposedChart>` + `<Bar>` + `<Line>`                            |

All use `<ChartContainer config={...}>` as the wrapper. All inherit Design Council colors via `chartConfig`.

---

## 8. Rejected Approach: Per-Module Ad-Hoc

The alternative — decide per module whether to hand-roll or use a lib — was explicitly rejected. Two modules in the first grounding batch already need it. Deciding per module adds coordinator overhead (re-litigating this same question) and produces inconsistent chart styling across pages. One decision now = consistent charts forever.

---

## Awaiting Colin's Approval

**What changes if approved:**

1. `npx shadcn@latest add chart` — adds `recharts` to `package.json`, scaffolds `components/ui/chart.tsx`
2. Migrate `AmazonDailyChart.tsx` and `MiniBarChart` in `utility/page.tsx` to shadcn chart
3. Update grounding docs for Keepa and Oura to reference `components/ui/chart.tsx` pattern
4. Note in coordinator.md: "chart components use shadcn chart — `<ChartContainer>` + Recharts primitives"

**What does NOT change:**

- `QualityTrends.tsx` Sparkline — deferred, stays as SVG
- No new design system decisions — colors are already defined as CSS vars
- No architecture changes — charts are always `'use client'` components
