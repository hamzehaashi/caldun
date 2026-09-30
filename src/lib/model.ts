import type {
  Assumptions,
  BalanceSheet,
  DcfResult,
  FinancialRow,
  ForecastRow,
} from '@/types/finance';

export const DEFAULT_ASSUMPTIONS: Assumptions = Object.freeze({
  growth: 6,
  margin: 20,
  tax: 21,
  da: 5,
  capex: 3,
  nwc: 1,
  wacc: 9,
  terminal: 2.5,
});

export function buildForecast(
  financials: Partial<FinancialRow>[],
  assumptions: Partial<Assumptions>,
  overrides: Partial<Assumptions> = {},
): ForecastRow[] {
  const a = { ...DEFAULT_ASSUMPTIONS, ...assumptions, ...overrides };
  const history = (financials || []).filter((row) => Number.isFinite(row?.revenue));
  const latest = history.at(-1);
  if (!latest || !Number.isFinite(latest.revenue)) return [];

  let revenue = latest.revenue as number;
  const startYear = Number.isFinite(latest.year)
    ? (latest.year as number)
    : Number(String(latest.periodEnd || '').slice(0, 4));
  const forecast: ForecastRow[] = [];

  for (let i = 1; i <= 5; i += 1) {
    revenue *= 1 + a.growth / 100;
    const ebit = revenue * a.margin / 100;
    const nopat = ebit * (1 - a.tax / 100);
    const da = revenue * a.da / 100;
    const capex = revenue * a.capex / 100;
    const nwc = revenue * a.nwc / 100;
    const ufcf = nopat + da - capex - nwc;
    forecast.push({ year: startYear + i, revenue, ebit, nopat, da, capex, nwc, ufcf });
  }

  return forecast;
}

export function dcf(
  input: {
    financials: Partial<FinancialRow>[];
    balanceSheet?: Partial<BalanceSheet> | null;
    assumptions: Partial<Assumptions>;
  },
  overrides: Partial<Assumptions> = {},
): DcfResult {
  const a = { ...DEFAULT_ASSUMPTIONS, ...input.assumptions, ...overrides };
  const fc = buildForecast(input.financials, a);

  if (!fc.length) {
    return {
      fc,
      error: {
        code: 'NO_HISTORY',
        message: 'A DCF cannot be built because usable historical revenue is missing.',
      },
    };
  }

  const wacc = a.wacc / 100;
  const terminalGrowth = a.terminal / 100;
  if (wacc <= terminalGrowth) {
    return {
      fc,
      error: {
        code: 'WACC_NOT_ABOVE_G',
        message: 'WACC must be greater than terminal growth for a Gordon Growth terminal value.',
      },
    };
  }

  let pv = 0;
  fc.forEach((row, index) => {
    pv += row.ufcf / Math.pow(1 + wacc, index + 1);
  });

  const terminalValue = (fc.at(-1)!.ufcf * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  const pvTv = terminalValue / Math.pow(1 + wacc, fc.length);
  const ev = pv + pvTv;

  const bs = input.balanceSheet || {};
  const missingEquityBridge: string[] = [];
  if (!Number.isFinite(bs.cash)) missingEquityBridge.push('cash');
  if (!Number.isFinite(bs.debt)) missingEquityBridge.push('debt');

  const equity = missingEquityBridge.length
    ? null
    : ev - (bs.debt as number) + (bs.cash as number);
  const shares = Number.isFinite(bs.sharesOutstanding) && (bs.sharesOutstanding as number) > 0
    ? (bs.sharesOutstanding as number)
    : null;
  const perShare = equity !== null && shares ? equity / shares : null;

  return {
    fc,
    pv,
    terminalValue,
    pvTv,
    ev,
    equity,
    shares,
    perShare,
    missingEquityBridge,
  };
}
