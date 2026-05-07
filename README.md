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

Multiple Claude Code sessions may run against this repo concurrently. To prevent windows from clobbering each other, every session must read [`.claude/CLAUDE.md`](.claude/CLAUDE.md) on startup and follow the coordination protocol it defines:

- **Scope contract** — each session sticks to the files in its assigned scope; out-of-scope edits go in [`notes/cross-window-suggestions.md`](notes/cross-window-suggestions.md) instead.
- **Active-window registry** — sessions claim a branch by writing to `.claude/active-windows/<branch>.md` and delete the file on clean shutdown.
- **Migration claims** — `.claude/migration-claims.json` is the single source of truth for the next free `supabase/migrations/<NNNN>_*.sql` slot. Reserve before creating; commit the claim alongside the migration.
- **Shared seams** — edits to `package.json`, `middleware.ts`, `app/layout.tsx`, `tsconfig.json`, etc. require `[seam-approved]` in the commit message; enforced by `.husky/commit-msg`.
- **Rebase discipline** — `.husky/pre-commit` aborts any commit when the branch is behind `origin/main`. `git pull --rebase` before committing; if you find yourself rebasing more than three times in a session, stop and tell the user the scope split isn't working.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

Chunk F verify — 2026-04-22T10:38:51Z

## Chunk H promote verify
