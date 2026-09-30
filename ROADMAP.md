# Caldun — Roadmap

Correctness comes first, then structure, then new modules. Each phase keeps the app runnable and deployable.

## Phase 0: Make the numbers right

Status: implementation prepared on `phase-0-correctness`.

- Fix annual SEC period selection using period start/end and roughly 12-month durations.
- Prefer the latest filing for a repeated period so amendments/restatements win.
- Align balance-sheet data to the latest annual period end and expose dates.
- Preserve missing debt as missing and avoid a false zero-debt equity bridge.
- Add deterministic tests for SEC mapping and DCF math.
- Preserve analyst memo edits during recalculation.
- Validate WACC > terminal growth.
- Show per-share value to cents and label assumption provenance.
- Require `SEC_USER_AGENT`.

## Phase 1: Financial data layer

- Add per-value provenance: XBRL tag, form, accession, filed date, period start/end, and reported/calculated/missing state.
- Introduce an explicit fiscal-period model.
- Add data-quality validation, stale-data flags, retries/backoff, rate-limit handling, and ticker caching.
- Add point-in-time queries using filing dates to prevent look-ahead bias.

## Phase 2: Valuation engine

- Continue extracting valuation logic into standalone testable modules.
- Expand the equity bridge, support mid-year discounting, and add exit-multiple terminal value.
- Add a transparent WACC build-up after a market-data provider is selected.

## Phase 3: Analyst UX

- Dense sortable tables, keyboard navigation, richer statement views, quarterly data, and CSV/Excel/PDF export.

## Phase 4: Research modules

Scenarios → arbitrary two-input sensitivity → comparable companies → valuation history → thesis/risks → memo generation.

## Phase 5: Persistence and accounts

Saved models, versioning, and authentication only after the core research workflow is worth persisting.
