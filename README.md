# CALDUN

CALDUN is an investment research workspace that turns a user-selected public-company ticker into a structured research workflow.

## MVP workflow

Ticker search → Historical financials → Forecast assumptions → DCF valuation → Sensitivity → Draft memo

The MVP uses SEC Company Facts for filing-derived fundamentals. It intentionally does not hard-code a reference company.

## Local development

```bash
cp .env.example .env
# Edit SEC_USER_AGENT in .env with a descriptive app/contact identity.
npm install
npm run dev
```

`SEC_USER_AGENT` is required. CALDUN fails clearly when it is absent rather than sending anonymous/default SEC requests.

## Tests

```bash
npm test
npm run check
```

The deterministic test suite covers annual SEC period selection, restatement preference, aligned balance-sheet snapshots, share-class aggregation, DCF math, invalid WACC/terminal-growth combinations, and missing equity-bridge data.

## Netlify

The app is configured for Netlify with `public/` as the publish directory and `netlify/functions/` for serverless functions. Set `SEC_USER_AGENT` in the Netlify environment before deploying.
