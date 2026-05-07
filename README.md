This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Multi-window development

Multiple Claude Code sessions may run against this repo concurrently. Every session reads [`.claude/CLAUDE.md`](.claude/CLAUDE.md) on startup and claims a scope; the pre-commit hook then enforces that scope on every commit.

```bash
# 1. See what's already claimed (and prune anything stale)
node scripts/window-status.mjs --prune

# 2. Claim a scope on the current branch (refuses if scope overlaps a live window)
node scripts/window-start.mjs --scope "lib/auth/**" --scope "tests/auth/**"

# 3. Work — commits outside the scope are rejected by the pre-commit hook

# 4. On clean shutdown
node scripts/window-end.mjs
```

**Enforced** (hooks abort the commit):

- **Scope contract** — `.husky/pre-commit` runs `scripts/window-scope-check.mjs` against staged files. Out-of-scope files block the commit. Bypass once with `WINDOW_SCOPE_BYPASS=1 git commit ...`.
- **Active claim required** — committing without first running `window-start.mjs` is blocked.
- **Migration claims** — `.claude/migration-claims.json` is the next-free `supabase/migrations/<NNNN>_*.sql` slot. Pre-commit blocks unclaimed migration numbers.
- **Shared seams** — edits to `package.json`, `middleware.ts`, `app/layout.tsx`, `tsconfig.json`, etc. require `[seam-approved]` in the commit message; enforced by `.husky/commit-msg`.
- **Rebase discipline** — `.husky/pre-commit` aborts any commit when the branch is behind `origin/main`.

**Convention** (relies on Claude reading the protocol doc):

- Out-of-scope ideas go in [`notes/cross-window-suggestions.md`](notes/cross-window-suggestions.md) instead of being acted on.
- 3-strike loop guard: if a session rebases/conflict-resolves more than three times, stop and tell the user the scope split isn't working.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

Chunk F verify — 2026-04-22T10:38:51Z

## Chunk H promote verify
