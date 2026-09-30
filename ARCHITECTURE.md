# CALDUN — Architecture

## Runtime

- Static frontend: `public/index.html`, `public/styles.css`, `public/phase0.css`, `public/app.js`.
- Pure valuation helpers: `public/model.js`.
- Serverless backend: Netlify Function `netlify/functions/company.mts`.
- SEC normalization helpers: `netlify/functions/sec-data.mjs`.

## Data flow

Ticker → SEC ticker map → SEC Company Facts → annual-duration/period selection → normalized historical rows + aligned balance-sheet snapshot → browser forecast assumptions → DCF → sensitivity/memo.

## Correctness boundaries

- SEC selection and normalization logic is isolated from the HTTP handler enough to be fixture-tested.
- DCF math is isolated from the DOM and takes explicit financials, balance-sheet values, assumptions, and overrides.
- Missing SEC values remain `null`; they are not converted to zero for valuation convenience.

## Deferred architecture

A component framework, database, authentication, caching infrastructure, and market-data provider are intentionally deferred until the data layer and valuation engine justify them.
