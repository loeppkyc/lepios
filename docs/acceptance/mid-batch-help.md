# Help Centre — Searchable FAQ

**Status:** approved
**Owner branch:** `feat/mid-batch-family`
**Migration slot:** none

---

## 1 — Why this exists

Navigation completeness. Users who don't know a route name need a place to find it. Current
Streamlit version has 188 lines of static FAQ — trivial to port, and the LepiOS version is
strictly better because it can link directly to live routes.

---

## 2 — Scope

### 2.1 Route

`/help` — single static page, no DB, no API calls.

### 2.2 FAQ data

Preserve all 7 categories and Q&A pairs from Streamlit verbatim:
- Getting Started
- Accounting & Expenses
- Amazon & Inventory
- Deals & Savings
- Trading & Betting
- Personal Finance
- Account & Security

### 2.3 Search

Client-side text filter on question + answer body. Filters as the user types.
No results message when query returns empty.

### 2.4 20% improvement over Streamlit

Replace every "Go to **X page**" text reference with a clickable `<Link>` to the actual
LepiOS route where the route exists. Map:

| Streamlit reference | LepiOS route |
|---------------------|-------------|
| Bookkeeping Hub | `/bookkeeping-hub` |
| Receipts | `/receipts` |
| Monthly Close | `/monthly-close` |
| Tax Return | `/tax-centre` |
| Amazon Orders | `/amazon` |
| Net Worth | `/net-worth` |
| Debt Payoff | `/debt-payoff` |
| Profile | `/profile` (skip if not built) |

Any reference without a mapped route stays as plain text.

### 2.5 Design

- Use Design Council primitives: `PageHeader`, shadcn `Input` for search
- FAQ items rendered as shadcn `Accordion` (one per category, collapsed by default)
- No `style={}` inline attributes

---

## 3 — Acceptance criteria

- [ ] `/help` returns 200
- [ ] All 7 FAQ categories render
- [ ] Typing in search box filters Q&A in real time
- [ ] Empty-state message when no results
- [ ] At least 5 route links resolve to live LepiOS pages (spot-check)
- [ ] No `style=` in new TSX files
- [ ] TypeScript: `tsc --noEmit` clean

---

## 4 — Out of scope

- Server-side search
- "Contact Colin" card (Streamlit has it; skip in LepiOS — not needed)
- Any auth requirement (page is accessible without login)
