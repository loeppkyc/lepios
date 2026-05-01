# Worktree Discipline — Parallel Windows Must Use Isolated Checkouts

**Created:** 2026-05-01
**Status:** OPEN — rule proposed, not yet encoded in session-start checklist
**Incident:** 4 file collisions during 2026-05-01 multi-window session
**Related:** `~/.claude/CLAUDE.md §4 F-L6`, `CLAUDE.md §9 S-L6` (parallel windows pattern)

---

## Problem

The 2026-05-01 session ran 4 parallel Claude Code windows against a single shared working
tree (`lepios/`). Four collisions occurred:

1. `str_replace` failed — a target string had already been modified by a sibling window
2. Committed a stale read — one window read a file, another committed a change to it, first
   window wrote its edit on top, stomping the second window's work
3. Two windows attempted to edit the same migration file simultaneously; one landed, one errored
4. A `git status` check in W3 showed W1's unstaged changes mixed in, causing W3 to include
   unrelated hunks in its commit

No data was lost (all recoverable from git history), but each collision required manual
diagnosis and re-work — roughly 20–30 min of overhead across the session.

---

## Root Cause

All 4 windows shared one filesystem checkout. When multiple agents read → think → write
against the same files concurrently:

- **Read-modify-write races**: Window A reads file at T0, Window B writes at T1, Window A
  writes its (now-stale) version at T2 — B's change is silently overwritten
- **Dirty working tree bleed**: unstaged changes from one window appear in another window's
  `git status` and `git diff`, causing unintended staging
- **`str_replace` sensitivity**: the Edit tool matches exact strings; a prior write from a
  sibling window invalidates the match target, throwing an error that looks like a tool bug
  rather than a collision

The root cause is architectural: parallel agents are assumed to have independent state, but a
shared working tree violates that assumption.

---

## Fix — Worktree-Per-Window Pattern

Each parallel Claude Code window gets its own `git worktree` on its own branch. The worktrees
are fully independent filesystem paths; file writes in one path have zero effect on any other.

Commands used at the start of the 2026-05-01 session (after the fix):

```bash
# from lepios repo root
git fetch origin
git worktree add ../lepios-w1 -b worktree-discipline-doc origin/main
git worktree add ../lepios-w2 -b rollup-b4-update origin/main
git worktree add ../lepios-w3 -b cf-access-fix origin/main
git worktree add ../lepios-w4 -b recon-audit origin/main
```

Each window then operates in `../lepios-wN/` — reads, edits, commits, and pushes independently.
PRs merge back to `main` through the normal CI gate.

Cleanup after all PRs merge:

```bash
git worktree remove ../lepios-w1
git worktree remove ../lepios-w2
git worktree remove ../lepios-w3
git worktree remove ../lepios-w4
```

---

## Standing Rule Proposal

**Every session that opens 2 or more parallel Claude Code windows MUST start with worktree
setup before any window begins work.**

Encoding target: add to the `/startup` skill output as a pre-flight check item:

> "Parallel windows requested — run worktree setup before assigning tasks. Each window gets
> `../lepios-wN` on its own branch. Skip only if all windows are strictly read-only."

The read-only exception is real: audit/research windows that never write files can safely
share the main checkout. Any window that writes (edits, commits, migrations) needs isolation.

---

## Detection — How to Notice Shared-Tree Mode Before Damage

Signs you're in shared-tree mode mid-session:

| Signal | What it means |
|---|---|
| `str_replace` throws "string not found" on a string you just read | Another window already edited that block |
| `git status` shows files you didn't touch | Unstaged changes from a sibling window |
| `git diff` contains hunks from unrelated tasks | You're about to commit someone else's work |
| Two windows try to write to the same migration file | Race condition — one will land, one will stomp |

Pre-flight check (run in each window before first edit):

```bash
git worktree list
```

If all windows show the same `worktree  …  [branch]` line, you're sharing a tree — stop
and set up isolation before proceeding.

---

## Acceptance Criteria

Rule is encoded when:

1. `/startup` skill output includes worktree pre-flight as a named step
2. Session-start CLAUDE.md checklist (or session-start memory) references this doc
3. Zero shared-tree collisions in the next 3 multi-window sessions
