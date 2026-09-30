# CALDUN — Current State

## What exists

- Vanilla HTML/CSS/JavaScript analyst workspace in `public/`.
- Netlify Function in `netlify/functions/company.mts` for SEC ticker lookup and Company Facts ingestion.
- SEC-derived annual fundamentals, simple forecast assumptions, five-year DCF, WACC/terminal-growth sensitivity, and editable investment memo.
- Deterministic Node tests for the core Phase 0 correctness rules.

## Phase 0 correctness changes

- Annual flow facts are selected by actual start/end period, restricted to roughly 12-month 10-K/10-K/A durations, and deduplicated by period using the latest filed fact.
- Balance-sheet cash/debt are aligned to the latest annual period end instead of independently taking the latest instant fact.
- Missing debt remains missing; the DCF no longer silently assumes zero debt.
- Share counts prefer an aligned total, can aggregate share classes when needed, and expose the share-count date separately when the best available count is from another date.
- DCF math lives in a small DOM-independent module so it can be unit tested.
- WACC <= terminal growth produces a clear validation message instead of leaving stale valuation output.
- Memo edits persist while assumptions are recalculated.
- Assumptions are labeled as historically derived, default, or analyst-entered.
- Per-share valuation is displayed to cents.
- `SEC_USER_AGENT` is required.

## Known limitations

- Fiscal-year labels still use period-end calendar year; a richer fiscal-period model belongs in Phase 1.
- The application has no database, authentication, saved models, or market-data provider.
- SEC retries/backoff, richer provenance, stale-data rules, and point-in-time query controls are still Phase 1 work.
- Comparable companies, scenarios, valuation history, and generated research modules are not yet implemented.
