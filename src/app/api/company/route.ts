import { NextRequest, NextResponse } from 'next/server';
import {
  getPeriodValue,
  instantForTagsAtDate,
  latestInstantForTags,
  seriesForTags,
  sumNullable,
  sumShareClassesAtDate,
} from '@/lib/sec-data';
import type { CompanyFact, CompanyFactsPayload, SecUnit } from '@/types/finance';

const SEC_WEB_BASE = 'https://www.sec.gov';
const SEC_DATA_BASE = 'https://data.sec.gov';
const SEC_MIN_REQUEST_GAP_MS = 250;
const SEC_RETRY_DELAYS_MS = [750, 1_500, 3_000];
const REQUEST_TIMEOUT_MS = 15_000;

let lastSecRequestAt = 0;

class SecRequestError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'SecRequestError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paceSecRequest() {
  const now = Date.now();
  const waitMs = Math.max(0, SEC_MIN_REQUEST_GAP_MS - (now - lastSecRequestAt));
  if (waitMs > 0) await sleep(waitMs);
  lastSecRequestAt = Date.now();
}

function secHeaders(): HeadersInit {
  const userAgent = process.env.SEC_USER_AGENT?.trim();
  if (!userAgent) {
    throw new Error(
      'SEC_USER_AGENT is required. Set it in your Netlify environment (for example: CALDUN Research your-email@example.com).',
    );
  }

  return {
    'User-Agent': userAgent,
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SecRequestError('SEC request timed out.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDirectJson<T>(url: string, revalidate: number): Promise<T> {
  let lastError: SecRequestError | null = null;

  for (let attempt = 0; attempt <= SEC_RETRY_DELAYS_MS.length; attempt += 1) {
    await paceSecRequest();

    const response = await fetchWithTimeout(url, {
      headers: secHeaders(),
      next: { revalidate },
    } as RequestInit & { next: { revalidate: number } });

    if (response.ok) return response.json() as Promise<T>;

    const body = await response.text().catch(() => '');
    const undeclaredBot = body.includes('Undeclared Automated Tool');
    const rateLimited =
      response.status === 429 || body.includes('Request Rate Threshold Exceeded');
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

    const message = undeclaredBot
      ? 'SEC rejected Caldun as an undeclared automated client.'
      : rateLimited
        ? 'SEC rate-limited Caldun’s request.'
        : `SEC request failed (${response.status}).`;

    lastError = new SecRequestError(message, response.status, retryAfter);

    const retryable = rateLimited || response.status >= 500;
    if (undeclaredBot || response.status === 403 || !retryable || attempt === SEC_RETRY_DELAYS_MS.length) {
      throw lastError;
    }

    const baseDelay = retryAfter ? retryAfter * 1_000 : SEC_RETRY_DELAYS_MS[attempt];
    await sleep(baseDelay + Math.floor(Math.random() * 250));
  }

  throw lastError ?? new SecRequestError('SEC request failed.', 502);
}

function shouldUseSecBridge(request: NextRequest) {
  return request.nextUrl.hostname.toLowerCase().endsWith('.netlify.app');
}

async function fetchBridgeJson<T>(
  request: NextRequest,
  resource: 'tickers' | 'companyfacts',
  cik?: string,
): Promise<T> {
  const url = new URL('/api/sec-bridge', request.nextUrl.origin);
  url.searchParams.set('resource', resource);
  if (cik) url.searchParams.set('cik', cik);

  const response = await fetchWithTimeout(url.toString(), {
    method: 'GET',
    cache: 'no-store',
  });

  if (response.ok) return response.json() as Promise<T>;

  let message = `SEC bridge failed (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // Keep the status-based message when the bridge does not return JSON.
  }

  throw new SecRequestError(
    message,
    response.status,
    parseRetryAfter(response.headers.get('retry-after')),
  );
}

async function fetchSecResource<T>(
  request: NextRequest,
  resource: 'tickers' | 'companyfacts',
  revalidate: number,
  cik?: string,
): Promise<T> {
  if (shouldUseSecBridge(request)) {
    return fetchBridgeJson<T>(request, resource, cik);
  }

  const url = resource === 'tickers'
    ? `${SEC_WEB_BASE}/files/company_tickers.json`
    : `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`;

  return fetchDirectJson<T>(url, revalidate);
}

function firstPeriodItem(endDate: string, ...maps: Array<Map<string, SecUnit>>): SecUnit | null {
  for (const map of maps) {
    const item = map.get(endDate);
    if (item) return item;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const ticker = (request.nextUrl.searchParams.get('ticker') || '').trim().toUpperCase();

    if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
      return NextResponse.json({ error: 'Enter a valid ticker symbol.' }, { status: 400 });
    }

    const tickers = await fetchSecResource<
      Record<string, { cik_str: number; ticker: string; title: string }>
    >(request, 'tickers', 604_800);

    const company = Object.values(tickers).find(
      (item) => item.ticker.toUpperCase() === ticker,
    );

    if (!company) {
      return NextResponse.json({ error: `No SEC company found for ${ticker}.` }, { status: 404 });
    }

    const cik = String(company.cik_str).padStart(10, '0');
    const payload = await fetchSecResource<CompanyFactsPayload>(
      request,
      'companyfacts',
      21_600,
      cik,
    );

    const gaap = (payload.facts?.['us-gaap'] || {}) as Record<string, CompanyFact>;
    const dei = (payload.facts?.dei || {}) as Record<string, CompanyFact>;

    const revenue = seriesForTags(gaap, [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'Revenues',
      'SalesRevenueNet',
      'SalesRevenueGoodsNet',
    ]);
    const operatingIncome = seriesForTags(gaap, ['OperatingIncomeLoss']);
    const netIncome = seriesForTags(gaap, ['NetIncomeLoss', 'ProfitLoss']);
    const operatingCashFlow = seriesForTags(gaap, [
      'NetCashProvidedByUsedInOperatingActivities',
    ]);
    const capex = seriesForTags(gaap, ['PaymentsToAcquirePropertyPlantAndEquipment']);
    const da = seriesForTags(gaap, [
      'DepreciationDepletionAndAmortization',
      'DepreciationDepletionAndAmortizationPropertyPlantAndEquipment',
      'Depreciation',
    ]);

    const revenuePeriodEnds = [...revenue.keys()]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const fallbackPeriodEnds = [
      ...new Set([
        ...operatingIncome.keys(),
        ...netIncome.keys(),
        ...operatingCashFlow.keys(),
      ]),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const periodEnds = (revenuePeriodEnds.length ? revenuePeriodEnds : fallbackPeriodEnds).slice(-5);

    const financials = periodEnds.map((periodEnd) => {
      const rev = getPeriodValue(revenue, periodEnd);
      const op = getPeriodValue(operatingIncome, periodEnd);
      const ni = getPeriodValue(netIncome, periodEnd);
      const ocf = getPeriodValue(operatingCashFlow, periodEnd);
      const cx = getPeriodValue(capex, periodEnd);
      const depreciation = getPeriodValue(da, periodEnd);
      const period = firstPeriodItem(
        periodEnd,
        revenue,
        operatingIncome,
        netIncome,
        operatingCashFlow,
      );

      return {
        year: Number(periodEnd.slice(0, 4)),
        periodStart: period?.start || null,
        periodEnd,
        revenue: rev,
        operatingIncome: op,
        netIncome: ni,
        operatingCashFlow: ocf,
        capex: cx,
        depreciationAndAmortization: depreciation,
        freeCashFlow: ocf !== null && cx !== null ? ocf - cx : null,
        operatingMargin: rev && op !== null ? op / rev : null,
      };
    });

    const asOf = periodEnds.at(-1) || null;

    const cashItem = asOf
      ? instantForTagsAtDate(
          gaap,
          [
            'CashAndCashEquivalentsAtCarryingValue',
            'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
          ],
          asOf,
        )
      : null;

    const totalLongDebtItem = asOf
      ? instantForTagsAtDate(
          gaap,
          ['LongTermDebtAndFinanceLeaseObligations', 'LongTermDebt'],
          asOf,
        )
      : null;

    const debtCurrentItem = asOf
      ? instantForTagsAtDate(
          gaap,
          [
            'LongTermDebtAndFinanceLeaseObligationsCurrent',
            'LongTermDebtCurrent',
          ],
          asOf,
        )
      : null;

    const debtLongItem = asOf
      ? instantForTagsAtDate(
          gaap,
          ['LongTermDebtAndFinanceLeaseObligationsNoncurrent', 'LongTermDebtNoncurrent'],
          asOf,
        )
      : null;

    const shortTermBorrowingsItem = asOf
      ? instantForTagsAtDate(
          gaap,
          ['ShortTermBorrowings', 'CommercialPaper'],
          asOf,
        )
      : null;

    const longDebt = totalLongDebtItem?.val ??
      sumNullable(debtCurrentItem?.val ?? null, debtLongItem?.val ?? null);
    const debt = sumNullable(longDebt, shortTermBorrowingsItem?.val ?? null);

    let shares: number | null = null;
    let sharesAsOf: string | null = null;

    if (asOf) {
      const deiShares = instantForTagsAtDate(
        dei,
        ['EntityCommonStockSharesOutstanding'],
        asOf,
        ['shares'],
      );
      if (deiShares) {
        shares = deiShares.val;
        sharesAsOf = deiShares.end || asOf;
      } else {
        const classTotal = sumShareClassesAtDate(gaap.CommonStockSharesOutstanding, asOf);
        if (classTotal !== null) {
          shares = classTotal;
          sharesAsOf = asOf;
        }
      }
    }

    if (shares === null) {
      const latestDeiShares = latestInstantForTags(
        dei,
        ['EntityCommonStockSharesOutstanding'],
        ['shares'],
      );
      if (latestDeiShares) {
        shares = latestDeiShares.val;
        sharesAsOf = latestDeiShares.end || null;
      } else {
        const latestGaapShares = latestInstantForTags(
          gaap,
          ['CommonStockSharesOutstanding'],
          ['shares'],
        );
        if (latestGaapShares?.end) {
          shares =
            sumShareClassesAtDate(gaap.CommonStockSharesOutstanding, latestGaapShares.end) ??
            latestGaapShares.val;
          sharesAsOf = latestGaapShares.end;
        }
      }
    }

    return NextResponse.json(
      {
        ticker,
        cik,
        name: payload.entityName || company.title,
        financials,
        balanceSheet: {
          asOf,
          cash: cashItem?.val ?? null,
          debt,
          sharesOutstanding: shares,
          sharesAsOf,
        },
        source: 'SEC Company Facts',
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400',
          'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=21600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    if (error instanceof SecRequestError && (error.status === 429 || error.status === 503)) {
      const retryAfter = error.retryAfterSeconds ?? 60;
      return NextResponse.json(
        { error: error.message },
        {
          status: 503,
          headers: { 'Retry-After': String(retryAfter) },
        },
      );
    }

    if (error instanceof SecRequestError && error.status === 504) {
      return NextResponse.json(
        { error: 'SEC did not respond before Caldun’s timeout. Please retry this ticker.' },
        { status: 504 },
      );
    }

    if (error instanceof SecRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status >= 400 ? error.status : 502 });
    }

    const message = error instanceof Error ? error.message : 'Unable to load company data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
