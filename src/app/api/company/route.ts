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
    Referer: 'https://caldun.netlify.app/',
  };
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  return null;
}

async function fetchJson<T>(url: string, revalidate: number): Promise<T> {
  let lastError: SecRequestError | null = null;

  for (let attempt = 0; attempt <= SEC_RETRY_DELAYS_MS.length; attempt += 1) {
    await paceSecRequest();

    const response = await fetch(url, {
      headers: secHeaders(),
      next: { revalidate },
    });

    if (response.ok) {
      return response.json() as Promise<T>;
    }

    const body = await response.text().catch(() => '');
    const rateLimited =
      response.status === 429 ||
      response.status === 403 ||
      body.includes('Request Rate Threshold Exceeded') ||
      body.includes('Undeclared Automated Tool');
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

    const suffix = rateLimited
      ? ' — SEC temporarily limited this server request.'
      : '';

    lastError = new SecRequestError(
      `SEC request failed (${response.status})${suffix}`,
      response.status,
      retryAfter,
    );

    const retryable = rateLimited || response.status >= 500;
    if (!retryable || attempt === SEC_RETRY_DELAYS_MS.length) {
      throw lastError;
    }

    const baseDelay = retryAfter ? retryAfter * 1_000 : SEC_RETRY_DELAYS_MS[attempt];
    const jitter = Math.floor(Math.random() * 250);
    await sleep(baseDelay + jitter);
  }

  throw lastError ?? new SecRequestError('SEC request failed.', 502);
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

    const tickers = await fetchJson<
      Record<string, { cik_str: number; ticker: string; title: string }>
    >(`${SEC_WEB_BASE}/files/company_tickers.json`, 604_800);

    const company = Object.values(tickers).find(
      (item) => item.ticker.toUpperCase() === ticker,
    );

    if (!company) {
      return NextResponse.json({ error: `No SEC company found for ${ticker}.` }, { status: 404 });
    }

    const cik = String(company.cik_str).padStart(10, '0');
    const payload = await fetchJson<CompanyFactsPayload>(
      `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`,
      21_600,
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

    const periodEnds = [
      ...new Set([
        ...revenue.keys(),
        ...operatingIncome.keys(),
        ...netIncome.keys(),
        ...operatingCashFlow.keys(),
      ]),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .slice(-5);

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

    const debtCurrentItem = asOf
      ? instantForTagsAtDate(
          gaap,
          [
            'LongTermDebtCurrent',
            'LongTermDebtAndFinanceLeaseObligationsCurrent',
            'ShortTermBorrowings',
          ],
          asOf,
        )
      : null;

    const debtLongItem = asOf
      ? instantForTagsAtDate(
          gaap,
          ['LongTermDebtNoncurrent', 'LongTermDebtAndFinanceLeaseObligationsNoncurrent'],
          asOf,
        )
      : null;

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
          debt: sumNullable(debtCurrentItem?.val ?? null, debtLongItem?.val ?? null),
          sharesOutstanding: shares,
          sharesAsOf,
        },
        source: 'SEC Company Facts',
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=21600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    if (error instanceof SecRequestError && (error.status === 403 || error.status === 429)) {
      const retryAfter = error.retryAfterSeconds ?? 60;
      return NextResponse.json(
        {
          error:
            'SEC is temporarily limiting requests from Caldun’s hosting network. Caldun will retry automatically; please try this ticker again shortly.',
        },
        {
          status: 503,
          headers: { 'Retry-After': String(retryAfter) },
        },
      );
    }

    const message = error instanceof Error ? error.message : 'Unable to load company data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
