# Claude Code Token-Savings Frameworks — Investigation 2026-04-28

## TL;DR

Three of the four repos in the screenshot are LOCAL-MACHINE proxies (claude-code-router, rtk) or curated lists (awesome-claude-code). Anthropic Routines run on Anthropic infrastructure — there is no local seam to inject a proxy. Token savings claims from CCR and RTK do NOT apply to autonomous harness runs (coordinator, builder, deploy gate). They may help Colin's interactive Claude Code sessions outside the harness.

Only caveman is harness-compatible — it's a CLAUDE.md style directive that runs at any tier. Worth piloting on a single coordinator chunk with F19 measurement discipline.

Stacked-percentage claims (85-92%) are workload-shaped, not multiplicative. Real savings cluster around 30-40% on file-edit-heavy workloads, 85-92% on shell-heavy.

---

## Source

- **Article:** Pasquale Pillitteri, "Claude Code Token: 10 GitHub Repos That Cut Up to 90%", published 2026-04-21 ([pasqualepillitteri.it](https://pasqualepillitteri.it/en/news/1181/claude-code-token-10-github-repos-savings)).
- **Trigger:** screenshot received from Colin 2026-04-28 listing top-4 repos with savings claims.
- **Handle correction:** screenshot showed "pasqualefulvolietzd@github" — no such GitHub user exists. Author is Pasquale Pillitteri, personal blog, not a GitHub account.

## Repo name disambiguation

| Screenshot label         | Actual repo                                                                             | Confidence | Notes                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------- |
| CAVERNUS (OUTPUT -65%)   | [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman)                       | High       | Exact 65% claim match in repo README                                                      |
| AWESOME-CC               | [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | Medium     | Multiple "awesome-claude-code" lists exist; this is the one the article cites             |
| CC-ROUTER (ROUTING -70%) | [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router)       | High       | "70-80% drops in Anthropic spend" matches repo claim                                      |
| NTH-AI (CLI FILTER -98%) | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) (Rust Token Killer)                         | High       | 98% on `cargo test` is verbatim from rtk README; "RTK" → "NTH-AI" is a likely OCR misread |

---

## Repo summaries

### 1. caveman (juliusbrussee/caveman)

**Mechanically:** Claude Code skill (CLAUDE.md-injected style directive) that forces the model to produce terse, caveman-style output: no pleasantries, no filler, primitive sentence structure. Auto-reverts to normal English for destructive-operation warnings. Ships Lite/Full/Ultra/Wenayan modes plus a `caveman-compress` tool for shrinking CLAUDE.md files.

**Token-savings approach:** Output-side compression only. Affects what the model emits, not what it ingests. No filtering, no routing, no caching.

**Maintenance status:** ~41,288 stars per Pasquale's article (2026-04-21). Actively shipped through 2026 Q1.

**Workload-specificity:** Workload-agnostic in mechanism, but value depends on baseline output verbosity. Reported numbers: 22%–87% range, ~65% average, 73% on a sample debug prompt. Heavy benefit on code-explanation/walkthrough workloads; minimal on pure-code-emission workloads.

**Routines API compatibility:** Compatible. CLAUDE.md style directive — runs at any tier. No process or proxy footprint.

### 2. awesome-claude-code (hesreallyhim/awesome-claude-code)

**Mechanically:** Curated GitHub list. Not a tool. ~40,000 stars per article.

**Token-savings approach:** N/A. Directory of skills/hooks/slash-commands/orchestrators/plugins from other authors. Pasquale's own entry for this repo says "Indirect (curated list); no direct token reduction metric provided."

**Maintenance status:** Actively curated.

**Workload-specificity:** N/A.

**Routines API compatibility:** N/A — it's a list, not a tool.

### 3. claude-code-router (musistudio/claude-code-router)

**Mechanically:** A proxy that intercepts Claude Code's API requests and routes them to alternative model providers (OpenRouter, DeepSeek, Ollama, Gemini, Volcengine, SiliconFlow). Configurable per-scenario routing: short-context → cheap model, long-context (>60k tokens default) → high-capacity model, "thinking" → reasoning-tuned model, "background" → cheapest. Runs as a local-machine proxy.

**Token-savings approach:** Provider arbitrage and model substitution. Not actually a token reduction — a _spend_ reduction by sending tokens to cheaper providers. The "70%" headline is dollar savings, not token savings.

**Maintenance status:** ~32,644 stars per article. Active.

**Workload-specificity:** Big savings on workloads where most queries are short-context grunt work that a $0.20/Mtok model can handle. Backfires on workloads needing Anthropic-specific tool-use behavior — Claude's tool format, exact context window handling, and prompt-caching mechanics differ across providers.

**Routines API compatibility:** Incompatible with the harness model. Routines run on Anthropic infrastructure with the Anthropic-managed Claude models. There is no proxy seam in cloud Routine executions. CCR helps for interactive Claude Code sessions on Colin's machine, not for autonomous coordinator/builder runs that go through the harness.

### 4. rtk (rtk-ai/rtk, "Rust Token Killer")

**Mechanically:** A CLI output proxy. Single Rust binary. `rtk init` rewrites Claude Code's Bash hook so commands like `git status` become `rtk git status` transparently. RTK compresses the command output (filter, group, truncate, dedupe) _before_ it reaches the model context. Model never sees the rewrite.

**Token-savings approach:** Input-side compression on the CLI-output channel only. Doesn't touch model output, doesn't route, doesn't cache.

**Maintenance status:** ~31,234 stars per article. MIT license. Actively shipped through 2026 Q1.

**Workload-specificity:** Heavy savings on commands with verbose output (`cargo test`: 98%; `git status` on a dirty repo: 76%; npm/pnpm install logs: similar). Minimal/zero benefit on workloads dominated by file reads or short shell calls. Reported real-world: ~89% reduction over 2 weeks for a shell-heavy Claude Code workflow (Kilo-Org thread).

**Routines API compatibility:** Same problem as CCR. RTK is a local Bash hook on the user's machine. Routines run remotely; no local hook seam. For autonomous harness runs, RTK provides zero benefit. For Colin's interactive sessions, it can help.

---

## Compounding-percentage fallacy

The article and many follow-ons advertise a "stack" claim of 85-92%. Naive multiplicative math (-65% × -70% × -98%) yields -99.4%, but:

- **Caveman** only compresses **output** tokens.
- **CCR** doesn't reduce tokens at all — it routes them to cheaper providers (a $$ play, not a token play).
- **RTK** only compresses one slice of **input** (CLI command output, not file reads, not user prompts).

The savings overlap (caveman + CCR are orthogonal — output vs. provider) and don't overlap (CCR + RTK are independent — provider vs. one input channel). Real-world stack reports cluster around 85-92% on shell-heavy workloads, dropping to 30-40% on file-edit-heavy workloads where RTK has no surface to compress. The claims are workload-shaped, not multiplicative.

---

## Honest assessment for the LepiOS harness

| Tool                | Interactive Claude Code          | Autonomous harness (coordinator/builder)                        | Worth integrating?                                                                                                                                                                                                         |
| ------------------- | -------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| caveman             | Helpful, 50-70% output reduction | Helpful — CLAUDE.md style directive runs anywhere               | **Worth a try.** Lowest integration cost (CLAUDE.md edit). Verify it doesn't double-strip information needed from coordinator audit reports — caveman's terseness may fight `terse responses` already in global CLAUDE.md. |
| awesome-claude-code | N/A (it's a list)                | N/A                                                             | **No.** Discovery surface, not a tool.                                                                                                                                                                                     |
| claude-code-router  | For interactive runs, $$ savings | **Incompatible** with Anthropic Routines (no proxy seam)        | **No.** Plus: routing coordinator/builder to a non-Claude model would invalidate every CLAUDE.md guarantee that depends on Claude-specific behavior.                                                                       |
| rtk                 | For shell-heavy interactive work | **Incompatible** with Anthropic Routines (local Bash hook only) | **No, for harness use.** Possibly worth it for Colin's own Claude Code work outside the harness.                                                                                                                           |

**Top candidate: caveman.** Single CLAUDE.md change, no infrastructure, runs in any execution mode. Test on a single coordinator chunk before rolling out — F19 measurement discipline.

---

## Branch-model impact (commit 5695edb)

**None of the four touch git branching.** The branch contract `harness/task-{task_id}` enforced by `.claude/agents/coordinator.md` and `lib/harness/branch-guard.ts` is unaffected by:

- caveman (output style only — branch ops still happen normally)
- claude-code-router (model substitution — git ops unchanged)
- rtk (compresses `git status` output — does not change which branch is committed to)

### Branch-guard CLI-output question — resolved

**Verified 2026-04-28: branch-guard reads via child_process execSync, no Claude-observation seam.** [lib/harness/branch-guard.ts:9](../../lib/harness/branch-guard.ts#L9):

```ts
return execSync('git branch --show-current', { encoding: 'utf8' }).trim()
```

The branch name flows `git → execSync stdout buffer → JS string → comparison`. RTK operates on the model's view of shell output via the Bash tool hook; Node's `child_process` stdout buffer is a different layer entirely. RTK has no seam here. Branch guard is safe regardless of any RTK deployment.

### Identity risk (CCR-specific)

CCR's bigger risk is identity, not branch model: if a coordinator session is silently routed to DeepSeek, the entire `claude-opus-4-7` assumption in the agent specs is invalidated. CCR would need a hard "Anthropic-only" enforce flag — not documented in its config as of this review. Recommended posture: do not deploy CCR in any path that touches autonomous harness runs.

---

## Sources

- [Pasquale Pillitteri — Claude Code Token: 10 GitHub Repos That Cut Up to 90%](https://pasqualepillitteri.it/en/news/1181/claude-code-token-10-github-repos-savings)
- [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman)
- [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code)
- [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router)
- [rtk-ai/rtk](https://github.com/rtk-ai/rtk)
- [Caveman tutorial — Marketing Agent Blog](https://marketingagent.blog/2026/03/31/tutorial-caveman-skill-for-claude-code-token-savings/)
- [Claude Code Router guide — TokenMix Blog](https://tokenmix.ai/blog/claude-code-router-guide-2026)
- [RTK CLI proxy review — daily.dev](https://app.daily.dev/posts/cli-proxy-that-reduces-llm-token-consumption-by-60-90-on-common-dev-commands-rqzedtufl)
