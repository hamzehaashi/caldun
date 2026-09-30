# CALDUN — Current State

## Current architecture

CALDUN is now being migrated from a vanilla HTML/JavaScript MVP to a Next.js App Router application using React and TypeScript.

### Implemented

- Next.js App Router application shell.
- React client workspace for ticker search, overview, historical financials, forecast assumptions, DCF valuation, sensitivity analysis, and editable memo sections.
- Typed domain models for company financials, SEC facts, assumptions, forecasts, and DCF outputs.
- Server-side `/api/company` route handler for SEC requests; `SEC_USER_AGENT` is never exposed to the browser.
- Phase 0 SEC period-selection logic preserved in `src/lib/sec-data.ts`.
- DOM-independent DCF engine preserved in `src/lib/model.ts`.
- Strict TypeScript configuration.
- Deterministic tests covering SEC annual-period selection, amendments/restatements, balance-sheet date anchoring, share classes, DCF math, WACC/g validation, and missing debt.
- Netlify configuration updated for native modern Next.js support.

### Still intentionally deferred

- Market-data provider and market prices.
- WACC build-up using live market inputs.
- Comparable companies.
- Persistence/authentication.
- Database infrastructure.
- Quarterly statement normalization.

## Migration status

The Next.js migration is staged on its own branch and should be deploy-previewed and tested against several real issuers before replacing the current production branch.
