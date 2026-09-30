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

async function fetchJson<T>(url: string, revalidate: number): Promise<T> {
  const response = await fetch(url, {
    headers: secHeaders(),
    next: { revalidate },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const suffix = body.includes('Request Rate Threshold Exceeded')
      ? ' — SEC rate limit reached; try again shortly.'
      : response.status === 403
        ? ' — SEC blocked the automated request.'
        : '';

    throw new Error(`SEC request failed (${response.status})${suffix}`);
  }

  return response.json() as Promise<T>;
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
    >(`${SEC_WEB_BASE}/files/company_tickers.json`, 86_400);

    const company = Object.values(tickers).find(
      (item) => item.ticker.toUpperCase() === ticker,
    );

    if (!company) {
      return NextResponse.json({ error: `No SEC company found for ${ticker}.` }, { status: 404 });
    }

    const cik = String(company.cik_str).padStart(10, '0');
    const payload = await fetchJson<CompanyFactsPayload>(
      `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`,
      3_600,
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
          'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load company data.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
