# CALDUN

CALDUN is an investment research workspace that turns a public-company ticker into a structured path from SEC filing data to forecast, DCF valuation, sensitivity analysis, and an analyst memo.

## Production

- https://caldun.netlify.app
- Production deploys are validated with live ticker smoke tests before being treated as healthy.
- A deployment is not considered healthy while its real-ticker smoke tests are failing.
- Analyst-model correctness changes must pass typecheck, regression tests, and a production build before commit.

## Stack

- Next.js 16 App Router
- React
- TypeScript (strict mode)
- SEC Company Facts API
- Netlify / OpenNext deployment

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open `http://localhost:3000`.

## Required environment variable

`SEC_USER_AGENT` is required for SEC requests. Use a descriptive application name and a monitored contact email.

```bash
SEC_USER_AGENT="CALDUN Research your-email@example.com"
```

## Quality checks

```bash
npm run typecheck
npm test
npm run build
```

The financial-data selection and DCF engine are kept outside React so they can be tested independently from the interface.
