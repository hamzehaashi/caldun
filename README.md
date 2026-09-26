# CALDUN

CALDUN is an investment research workspace that turns a user-selected public-company ticker into a structured research workflow.

## MVP workflow

Ticker search → Historical financials → Forecast assumptions → DCF valuation → Sensitivity → Draft memo

The MVP uses SEC Company Facts for filing-derived fundamentals. It intentionally does not hard-code a reference company.

## Local development

```bash
npm install
npm run dev
```

## Netlify

The app is configured for Netlify with `public/` as the publish directory and `netlify/functions/` for serverless functions.

Optional environment variable:

- `SEC_USER_AGENT` — descriptive user agent for SEC requests, e.g. `CALDUN Research your-email@example.com`
