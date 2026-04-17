# Agent Rules — LepiOS

## Before Writing Any Code

MANDATORY: Before editing or creating any file, you MUST first read:
- The file you are about to edit (use the Read tool)
- Any file you reference by name (function, import, path)

If you cite a function name, file path, or API — verify it exists with Grep or Read before including it in your response. Do not rely on memory for exact names.

## This is NOT the Next.js you know

<!-- BEGIN:nextjs-agent-rules -->
This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Phase 2 Rules (active until Phase 3 begins)

- No code changes. Research and inventory only.
- Every claim in every report is tagged **grounded** (evidence-backed, with file path / table name / line number) or **generated** (prose).
- Generated claims are not promoted to conclusions without Colin's approval.
- Every report ends with a **grounding manifest** listing evidence sources.

## ARCHITECTURE.md is the north star

If anything in this codebase contradicts ARCHITECTURE.md, flag it — do not silently fix it.
