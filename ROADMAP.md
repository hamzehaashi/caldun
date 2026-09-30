# CALDUN — Roadmap

Correctness first, then typed architecture, then analyst modules.

## Phase 0 — Financial correctness

Completed on the parent Phase 0 branch and preserved in the Next.js migration:

- annual SEC period selection by actual dates and duration
- latest amendment/restatement preference
- annual balance-sheet date alignment
- missing debt preservation
- share-class handling
- DCF validation
- memo preservation
- deterministic tests

## Phase 1A — Next.js + TypeScript migration (in progress)

- [x] Next.js App Router scaffold
- [x] React workspace migration
- [x] strict TypeScript domain model
- [x] SEC endpoint moved to a Next.js route handler
- [x] DCF and SEC normalization moved to typed library modules
- [x] Netlify config migrated to native Next.js build
- [x] tests ported to TypeScript
- [ ] generate and commit a dependency lockfile during install/build
- [ ] deploy-preview validation
- [ ] real-company regression pass (calendar and non-calendar fiscal years)

## Phase 1B — Financial data layer

- provenance per value: tag, form, accession, filed date, period, status
- explicit fiscal-period model
- validation flags and stale-data indicators
- retry/backoff and request timeout strategy
- point-in-time queries using filed dates

## Phase 2 — Valuation engine

- WACC build-up once a market-data provider is selected
- expanded enterprise-to-equity bridge
- mid-year convention
- exit-multiple terminal value

## Phase 3 — Analyst UX

- reusable high-density statement tables
- sorting/filtering
- keyboard shortcuts
- CSV/Excel export
- PDF memo export
- customizable workspace views

## Phase 4 — Research modules

Scenarios → sensitivity on arbitrary inputs → comps → valuation history → thesis/risk workflow → memo generation.

## Phase 5 — Persistence and accounts

Saved models, versioning, authentication, and persistence only after the analyst workflow warrants them.
