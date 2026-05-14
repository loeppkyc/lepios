# GitHub Prior Art — LepiOS Vision Scan

> **Last updated:** 2026-05-14
> **Scope:** Vision-level scan across all four pillars (Money / Health / Growing / Happy) + cross-cutting infrastructure (behavioral ingestion, Digital Twin, cockpit UI).
> **Rule:** Every acceptance doc must reference this file. Before building any new module, check the relevant section here first. Verdict codes: **Wrap** (import as dependency) / **Fork** (take their engine, put our shell on top) / **Reference** (read for patterns, write ours) / **Build-new** (last resort, requires Colin approval).

---

## Cross-Cutting Infrastructure

### Behavioral Ingestion / Knowledge Store

| Repo                    | Stars | What it does                                                                                                                                                      | Verdict       | Notes                                                                                                                                                                              |
| ----------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `benclawbot/open-brain` | ~400  | Python/FastAPI/PostgreSQL+pgvector. Ingests from Telegram, WhatsApp, Claude Code, Gmail. Stores as embeddings. Near-exact match to our behavioral ingestion spec. | **Reference** | Stack mismatch (Python vs TypeScript/Supabase). Our pgvector + `behavioral_events` table does the same job. Read their ingest pipeline for edge-case handling before writing ours. |
| `mem0ai/mem0`           | 25k+  | Persistent memory layer for AI agents. Supports Supabase pgvector.                                                                                                | **Reference** | Too general-purpose; doesn't have the life-event tuple structure we need. Borrow the memory-update / conflict-resolution patterns.                                                 |
| `hwchase17/langchain`   | 90k+  | LLM orchestration. Has document loaders for Telegram, Gmail, etc.                                                                                                 | **Reference** | We don't use LangChain, but their loaders show what fields to capture.                                                                                                             |

### Digital Twin

| Repo                                          | Stars | What it does                                                      | Verdict       | Notes                                                                                                                                                |
| --------------------------------------------- | ----- | ----------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BerriAI/litellm`                             | 14k+  | LLM proxy + routing. Not a twin.                                  | **Skip**      | Not relevant.                                                                                                                                        |
| `openai/openai-assistants-api`                | —     | Persistent assistant threads with file search + function calling. | **Reference** | Assistant thread = simplified Digital Twin. We're building something deeper (path probability engine), but their retrieval patterns are instructive. |
| No open-source path-probability engine found. | —     | —                                                                 | **Build-new** | The path probability engine (outcome distribution for decisions) is novel. No open-source equivalent found. Colin-approved to build new.             |

### MCP Servers (health data, integrations)

| Repo                                            | Stars | What it does                                                                                                              | Verdict       | Notes                                                                                                                                                                                             |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rajvirtual/oura-mcp-server`                    | ~50   | Node.js/TypeScript MCP server for Oura Ring. Exposes sleep, HRV, readiness, activity, stress, workout. Uses `OURA_TOKEN`. | **Wrap**      | **ALREADY CLONED AND BUILT** at `C:\Users\Colin\.claude\mcp-servers\oura-mcp-server\`. Wired into `~/.claude/.mcp.json`. Colin needs `OURA_TOKEN` from cloud.ouraring.com/personal-access-tokens. |
| `modelcontextprotocol/servers` (reference impl) | 12k+  | Official MCP server examples (filesystem, memory, fetch, etc.)                                                            | **Reference** | Read before writing any new MCP integration.                                                                                                                                                      |

---

## Health Pillar

### Oura Ring

See oura-mcp-server above — **already handled with Wrap**.

LepiOS `OURA_ACCESS_TOKEN` env var (used in `/api/health/oura` routes) is **different** from the MCP server's `OURA_TOKEN`. Both need to be set with the same token value.

### General Health Dashboards

| Repo                              | Stars | What it does                             | Verdict  | Notes                                                 |
| --------------------------------- | ----- | ---------------------------------------- | -------- | ----------------------------------------------------- |
| `nicholaswagner/health-dashboard` | ~200  | React health metrics dashboard. Generic. | **Skip** | Generic SaaS look. Our Design Council overrides this. |
| `AnyFetch/health`                 | —     | Health check endpoint aggregator.        | **Skip** | Not a health metrics UI.                              |

---

## Money Pillar

### Amazon / FBA

| Repo                                | Stars | What it does                                | Verdict       | Notes                                                                                                 |
| ----------------------------------- | ----- | ------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `amzn/selling-partner-api-models`   | 2k+   | Official SP-API OpenAPI specs.              | **Reference** | Already using SP-API directly. Read specs when a new endpoint is needed.                              |
| `jmakov/amazon-mws`                 | ~500  | Old MWS SDK (deprecated).                   | **Skip**      | MWS shut down. SP-API only.                                                                           |
| `ScaleLeap/selling-partner-api-sdk` | ~400  | TypeScript SP-API client with full codegen. | **Reference** | We have our own `lib/amazon/` wrappers. Read if we need a new SP-API endpoint before rolling our own. |

### Betting / Kelly Criterion

| Repo                    | Stars | What it does                         | Verdict       | Notes                                                                                                       |
| ----------------------- | ----- | ------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `kellysizer` (various)  | low   | Basic Kelly formula implementations. | **Skip**      | We already have the Kelly Sizer tile shipped. More sophisticated than any open-source implementation found. |
| `sports-reference` APIs | —     | Sports stats databases.              | **Reference** | Useful data source for AI Sports picks calibration.                                                         |

### Bookkeeping / QBO

| Repo                              | Stars | What it does              | Verdict  | Notes                                                                                                                        |
| --------------------------------- | ----- | ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `intuit/QuickBooks-V3-NodeJS-SDK` | ~800  | Official QBO Node.js SDK. | **Wrap** | We're already using QBO OAuth. Check this before writing any new QBO API calls — it handles token refresh and rate limiting. |
| `node-quickbooks`                 | ~700  | Alternative QBO client.   | **Skip** | Intuit's official SDK is preferred.                                                                                          |

---

## Growing Pillar

### Trading / Signals

| Repo                               | Stars | What it does                                                                     | Verdict       | Notes                                                                                                                                                                                                     |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `freqtrade/freqtrade`              | 28k+  | Python algo trading framework. Backtesting, live trading, strategy optimization. | **Reference** | We're building the signal engine (5-factor scoring) in TypeScript. Read freqtrade's backtesting harness before writing ours — especially how they handle paper→live promotion via calibration thresholds. |
| `jesse-ai/jesse`                   | 5k+   | Python trading framework with ML support.                                        | **Reference** | Similar to freqtrade. Their signal normalization approach (0–1 scoring per indicator) matches our 5-factor plan.                                                                                          |
| `ta-lib/ta-lib`                    | 9k+   | C library for technical analysis indicators (RSI, MACD, Bollinger, etc.).        | **Wrap**      | Use `talib` npm package or `technicalindicators` (pure TS, no native bindings) for indicator math. Don't re-implement RSI/MACD.                                                                           |
| `anandanand84/technicalindicators` | 3k+   | Pure TypeScript TA indicators. No native deps.                                   | **Wrap**      | **PREFERRED** over ta-lib for LepiOS. TypeScript, no native bindings, runs on Vercel Edge. Import before writing any indicator math.                                                                      |

---

## Cockpit UI / Design

| Repo                                                            | Stars | What it does                     | Verdict           | Notes                                                                                          |
| --------------------------------------------------------------- | ----- | -------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------- |
| `shadcn/ui`                                                     | 75k+  | Unstyled, composable components. | **Already using** | Foundation. Heavily customized per Design Council.                                             |
| `recharts/recharts`                                             | 23k+  | React charting.                  | **Already using** | Wrapped in `ChartContainer`. See `components/ui/chart.tsx`.                                    |
| `antonreshetov/vue-instrument-cluster`                          | ~200  | Vue gauge components.            | **Reference**     | Read for gauge animation patterns. We implement in React/SVG.                                  |
| `recogizer-group/react-gauge-component`                         | ~800  | React gauge chart.               | **Reference**     | Our `<Gauge>` primitive is custom SVG. Read their arc-math if we need circular gauge variants. |
| No open-source "cockpit OS" with agent deliberation feed found. | —     | —                                | **Build-new**     | The Situation Room ticker + multi-agent deliberation surface is novel. Build new.              |

---

## Harness / Autonomous Agents

| Repo                     | Stars | What it does                              | Verdict       | Notes                                                                                                                  |
| ------------------------ | ----- | ----------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `microsoft/autogen`      | 35k+  | Multi-agent conversation framework.       | **Reference** | We have our own coordinator/builder pattern. Read AutoGen's handoff + grounding patterns before extending the harness. |
| `langchain-ai/langgraph` | 8k+   | Stateful multi-agent orchestration graph. | **Reference** | Their `StateGraph` concept maps to our task_queue state machine. Read before redesigning task states.                  |
| `crewai-inc/crewai`      | 20k+  | Role-based multi-agent crews.             | **Skip**      | Python-only. Not compatible with our TypeScript harness.                                                               |

---

## How to Use This Doc

**For coordinators writing acceptance docs:**

1. Find the relevant section for the module being built.
2. If verdict is **Wrap** or **Fork** — the library/package must be in `package.json` before any acceptance doc is approved.
3. If verdict is **Reference** — coordinator must read the linked repo before writing specs and note "Read: [repo]" in the acceptance doc's Prior Art section.
4. If verdict is **Build-new** — acceptance doc must state the reason no open-source equivalent was found (1 sentence).
5. If a module's category isn't listed here — update this file before proceeding.

**Adding new entries:** follow the table format. Required fields: repo slug, approximate star count, what it does in one sentence, verdict, notes explaining the verdict.
