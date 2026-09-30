export type AssumptionKey =
  | 'growth'
  | 'margin'
  | 'tax'
  | 'da'
  | 'capex'
  | 'nwc'
  | 'wacc'
  | 'terminal';

export type Assumptions = Record<AssumptionKey, number>;
export type AssumptionSource = 'derived' | 'derived-adjusted' | 'default' | 'analyst';
export type AssumptionSources = Record<AssumptionKey, AssumptionSource>;

export type SecUnit = {
  start?: string;
  end?: string;
  val: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
  tag?: string;
};

export type CompanyFact = {
  label?: string;
  description?: string;
  units?: Record<string, SecUnit[]>;
};

export type CompanyFactsPayload = {
  cik: number;
  entityName: string;
  facts?: Record<string, Record<string, CompanyFact>>;
};

export type FinancialRow = {
  year: number;
  periodStart: string | null;
  periodEnd: string;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  depreciationAndAmortization: number | null;
  freeCashFlow: number | null;
  operatingMargin: number | null;
};

export type BalanceSheet = {
  asOf: string | null;
  cash: number | null;
  debt: number | null;
  sharesOutstanding: number | null;
  sharesAsOf: string | null;
};

export type CompanyData = {
  ticker: string;
  cik: string;
  name: string;
  financials: FinancialRow[];
  balanceSheet: BalanceSheet;
  source: string;
};

export type ForecastRow = {
  year: number;
  revenue: number;
  ebit: number;
  nopat: number;
  da: number;
  capex: number;
  nwc: number;
  ufcf: number;
};

export type DcfError = {
  code: 'NO_HISTORY' | 'WACC_NOT_ABOVE_G';
  message: string;
};

export type DcfResult = {
  fc: ForecastRow[];
  error?: DcfError;
  pv?: number;
  terminalValue?: number;
  pvTv?: number;
  ev?: number;
  equity?: number | null;
  shares?: number | null;
  perShare?: number | null;
  missingEquityBridge?: string[];
};
