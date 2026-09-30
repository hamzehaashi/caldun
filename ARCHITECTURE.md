# CALDUN — Architecture

## Request path

Browser / React workspace
→ Next.js route handler (`src/app/api/company/route.ts`)
→ SEC ticker directory + Company Facts
→ typed normalization helpers (`src/lib/sec-data.ts`)
→ normalized `CompanyData`
→ React analyst workspace
→ pure valuation engine (`src/lib/model.ts`)

## Boundaries

### UI
`src/components/caldun-workspace.tsx`

Owns user interaction, analyst assumptions, memo state, formatting, navigation, and presentation. It does not parse SEC payloads.

### Financial calculations
`src/lib/model.ts`

Pure functions. No DOM, React state, network requests, or global mutable state.

### SEC normalization
`src/lib/sec-data.ts`

Selects annual duration facts by actual period dates, resolves amendments/restatements, anchors instant facts to explicit dates, and preserves missing values.

### API boundary
`src/app/api/company/route.ts`

Keeps SEC request identity server-side, fetches raw SEC data, maps tags into normalized company financials, and returns a stable API shape to the client.

### Domain types
`src/types/finance.ts`

Shared types for the financial data contract and valuation engine.

## Deployment

Netlify builds the Next.js application with `next build` and uses its maintained OpenNext adapter automatically. No pinned legacy Next.js Netlify plugin is required.
