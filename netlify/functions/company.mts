import type { Config, Context } from "@netlify/functions";

type SecUnit = {
  start?: string;
  end?: string;
  val: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
};

type CompanyFact = {
  label?: string;
  description?: string;
  units?: Record<string, SecUnit[]>;
};

type CompanyFactsPayload = {
  cik: number;
  entityName: string;
  facts?: Record<string, Record<string, CompanyFact>>;
};

const SEC_WEB_BASE = "https://www.sec.gov";
const SEC_DATA_BASE = "https://data.sec.gov";

function headers() {
  return {
    "User-Agent":
      Netlify.env.get("SEC_USER_AGENT") ||
      "CALDUN/0.1 investment-research-workspace https://caldun.netlify.app",
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: headers() });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const suffix = body.includes("Request Rate Threshold Exceeded")
      ? " — SEC rate limit reached; try again shortly."
      : response.status === 403
        ? " — SEC blocked the automated request."
        : "";

    throw new Error(`SEC request failed (${response.status})${suffix}`);
  }

  return response.json() as Promise<T>;
}

function annualSeries(
  fact: CompanyFact | undefined,
  unitPreference: string[] = ["USD"],
): SecUnit[] {
  if (!fact?.units) return [];

  const units = unitPreference.flatMap((unit) => fact.units?.[unit] || []);
  const source = units.length ? units : Object.values(fact.units).flat();

  const annual = source.filter(
    (x) =>
      (x.form === "10-K" || x.form === "10-K/A") &&
      x.fp === "FY" &&
      x.fy &&
      Number.isFinite(x.val),
  );

  const byYear = new Map<number, SecUnit>();

  for (const item of annual) {
    const year = item.fy!;
    const existing = byYear.get(year);

    if (!existing || (item.filed || "") > (existing.filed || "")) {
      byYear.set(year, item);
    }
  }

  return [...byYear.values()]
    .sort((a, b) => (a.fy || 0) - (b.fy || 0))
    .slice(-6);
}

function instantLatest(
  fact: CompanyFact | undefined,
  preferredUnits: string[] = ["USD"],
): number | null {
  if (!fact?.units) return null;

  const candidates = preferredUnits.flatMap(
    (unit) => fact.units?.[unit] || [],
  );

  const source = candidates.length
    ? candidates
    : Object.values(fact.units).flat();

  const filtered = source.filter((x) => Number.isFinite(x.val));

  filtered.sort((a, b) =>
    (b.filed || b.end || "").localeCompare(a.filed || a.end || ""),
  );

  return filtered[0]?.val ?? null;
}

function pickFact(usGaap: Record<string, CompanyFact>, tags: string[]) {
  for (const tag of tags) {
    if (usGaap[tag]) return usGaap[tag];
  }

  return undefined;
}

function seriesByYear(
  usGaap: Record<string, CompanyFact>,
  tags: string[],
  units = ["USD"],
) {
  const series = annualSeries(pickFact(usGaap, tags), units);
  return new Map(series.map((x) => [x.fy!, x.val]));
}

function getValue(map: Map<number, number>, year: number) {
  const value = map.get(year);
  return value === undefined ? null : value;
}

function sumNullable(...values: Array<number | null>) {
  const present = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );

  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

export default async (req: Request, _context: Context) => {
  try {
    const url = new URL(req.url);
    const ticker = (url.searchParams.get("ticker") || "")
      .trim()
      .toUpperCase();

    if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
      return Response.json(
        { error: "Enter a valid ticker symbol." },
        { status: 400 },
      );
    }

    const tickers = await fetchJson<
      Record<
        string,
        { cik_str: number; ticker: string; title: string }
      >
    >(`${SEC_WEB_BASE}/files/company_tickers.json`);

    const company = Object.values(tickers).find(
      (x) => x.ticker.toUpperCase() === ticker,
    );

    if (!company) {
      return Response.json(
        { error: `No SEC company found for ${ticker}.` },
        { status: 404 },
      );
    }

    const cik = String(company.cik_str).padStart(10, "0");

    const payload = await fetchJson<CompanyFactsPayload>(
      `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`,
    );

    const gaap = payload.facts?.["us-gaap"] || {};
    const dei = payload.facts?.dei || {};

    const revenue = seriesByYear(gaap, [
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
      "SalesRevenueGoodsNet",
    ]);

    const operatingIncome = seriesByYear(gaap, ["OperatingIncomeLoss"]);

    const netIncome = seriesByYear(gaap, [
      "NetIncomeLoss",
      "ProfitLoss",
    ]);

    const operatingCashFlow = seriesByYear(gaap, [
      "NetCashProvidedByUsedInOperatingActivities",
    ]);

    const capex = seriesByYear(gaap, [
      "PaymentsToAcquirePropertyPlantAndEquipment",
    ]);

    const da = seriesByYear(gaap, [
      "DepreciationDepletionAndAmortization",
      "DepreciationDepletionAndAmortizationPropertyPlantAndEquipment",
      "Depreciation",
    ]);

    const years = [
      ...new Set([
        ...revenue.keys(),
        ...operatingIncome.keys(),
        ...netIncome.keys(),
        ...operatingCashFlow.keys(),
      ]),
    ]
      .sort((a, b) => a - b)
      .slice(-5);

    const financials = years.map((year) => {
      const rev = getValue(revenue, year);
      const op = getValue(operatingIncome, year);
      const ni = getValue(netIncome, year);
      const ocf = getValue(operatingCashFlow, year);
      const cx = getValue(capex, year);
      const d = getValue(da, year);

      return {
        year,
        revenue: rev,
        operatingIncome: op,
        netIncome: ni,
        operatingCashFlow: ocf,
        capex: cx,
        depreciationAndAmortization: d,
        freeCashFlow:
          ocf !== null && cx !== null ? ocf - cx : null,
        operatingMargin:
          rev && op !== null ? op / rev : null,
      };
    });

    const cash = instantLatest(
      pickFact(gaap, [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      ]),
    );

    const debtCurrent = instantLatest(
      pickFact(gaap, [
        "LongTermDebtCurrent",
        "LongTermDebtAndFinanceLeaseObligationsCurrent",
        "ShortTermBorrowings",
      ]),
    );

    const debtLong = instantLatest(
      pickFact(gaap, [
        "LongTermDebtNoncurrent",
        "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
      ]),
    );

    const shares =
      instantLatest(
        pickFact(dei as Record<string, CompanyFact>, [
          "EntityCommonStockSharesOutstanding",
        ]),
        ["shares"],
      ) ||
      instantLatest(
        pickFact(gaap, ["CommonStockSharesOutstanding"]),
        ["shares"],
      );

    return Response.json(
      {
        ticker,
        cik,
        name: payload.entityName || company.title,
        financials,
        balanceSheet: {
          cash,
          debt: sumNullable(debtCurrent, debtLong),
          sharesOutstanding: shares,
        },
        source: "SEC Company Facts",
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, s-maxage=3600",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to load company data.";

    return Response.json({ error: message }, { status: 500 });
  }
};

export const config: Config = {
  path: "/api/company",
};
