'use client';

import { FormEvent, useMemo, useState } from 'react';
import { dcf, DEFAULT_ASSUMPTIONS } from '@/lib/model';
import type {
  AssumptionKey,
  AssumptionSource,
  AssumptionSources,
  Assumptions,
  CompanyData,
} from '@/types/finance';

type Tab = 'overview' | 'financials' | 'forecast' | 'valuation' | 'memo';

type MemoState = {
  thesis: string;
  catalysts: string;
  risks: string;
};

const ASSUMPTION_DEFS: Array<{
  key: AssumptionKey;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'growth', label: 'Revenue growth', min: -5, max: 25, step: 0.5 },
  { key: 'margin', label: 'EBIT margin', min: 0, max: 45, step: 0.5 },
  { key: 'tax', label: 'Tax rate', min: 0, max: 40, step: 0.5 },
  { key: 'da', label: 'D&A / revenue', min: 0, max: 20, step: 0.25 },
  { key: 'capex', label: 'CapEx / revenue', min: 0, max: 20, step: 0.25 },
  { key: 'nwc', label: 'ΔNWC / revenue', min: -5, max: 10, step: 0.25 },
  { key: 'wacc', label: 'WACC', min: 4, max: 18, step: 0.25 },
  { key: 'terminal', label: 'Terminal growth', min: 0, max: 6, step: 0.25 },
];

const SOURCE_LABEL: Record<AssumptionSource, string> = {
  derived: 'Derived from history',
  default: 'Default',
  analyst: 'Analyst-entered',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function fmtMoney(value: number | null | undefined, compact = true) {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (compact) {
    if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  }
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPerShare(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function seedModel(company: CompanyData): { assumptions: Assumptions; sources: AssumptionSources } {
  const history = company.financials.filter((row) => Number.isFinite(row.revenue));
  const latest = history.at(-1);
  const previous = history.at(-2);

  const growth = latest?.revenue && previous?.revenue
    ? ((latest.revenue / previous.revenue) - 1) * 100
    : DEFAULT_ASSUMPTIONS.growth;
  const margin = latest?.operatingMargin != null
    ? latest.operatingMargin * 100
    : DEFAULT_ASSUMPTIONS.margin;
  const da = latest?.depreciationAndAmortization && latest.revenue
    ? (latest.depreciationAndAmortization / latest.revenue) * 100
    : DEFAULT_ASSUMPTIONS.da;
  const capex = latest?.capex && latest.revenue
    ? (latest.capex / latest.revenue) * 100
    : DEFAULT_ASSUMPTIONS.capex;

  return {
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      growth: clamp(growth, -5, 25),
      margin: clamp(margin, 0, 45),
      da: clamp(da, 0, 20),
      capex: clamp(capex, 0, 20),
    },
    sources: {
      growth: latest?.revenue && previous?.revenue ? 'derived' : 'default',
      margin: latest?.operatingMargin != null ? 'derived' : 'default',
      da: latest?.depreciationAndAmortization && latest.revenue ? 'derived' : 'default',
      capex: latest?.capex && latest.revenue ? 'derived' : 'default',
      tax: 'default',
      nwc: 'default',
      wacc: 'default',
      terminal: 'default',
    },
  };
}

export function CaldunWorkspace() {
  const [ticker, setTicker] = useState('');
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [assumptions, setAssumptions] = useState<Assumptions>({ ...DEFAULT_ASSUMPTIONS });
  const [sources, setSources] = useState<AssumptionSources>({
    growth: 'default', margin: 'default', tax: 'default', da: 'default',
    capex: 'default', nwc: 'default', wacc: 'default', terminal: 'default',
  });
  const [memo, setMemo] = useState<MemoState>({ thesis: '', catalysts: '', risks: '' });
  const [copied, setCopied] = useState(false);

  const result = useMemo(
    () => company ? dcf({ financials: company.financials, balanceSheet: company.balanceSheet, assumptions }) : null,
    [company, assumptions],
  );

  async function loadCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = ticker.trim().toUpperCase();
    if (!normalized) return;

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/company?ticker=${encodeURIComponent(normalized)}`);
      const data = await response.json() as CompanyData & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to load company.');
      if (!data.financials?.length) {
        throw new Error('CALDUN found this filer, but usable annual fundamentals were not available in SEC Company Facts.');
      }
      const seeded = seedModel(data);
      setCompany(data);
      setAssumptions(seeded.assumptions);
      setSources(seeded.sources);
      setMemo({ thesis: '', catalysts: '', risks: '' });
      setActiveTab('overview');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load company.');
    } finally {
      setLoading(false);
    }
  }

  function updateAssumption(key: AssumptionKey, value: number) {
    setAssumptions((current) => ({ ...current, [key]: value }));
    setSources((current) => ({ ...current, [key]: 'analyst' }));
  }

  async function copyMemo() {
    if (!company || !result) return;
    const text = buildMemoText(company, assumptions, result, memo);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <>
      <header className="topbar">
        <button className="brand brand-button" onClick={() => setCompany(null)} aria-label="CALDUN home">
          CALDUN<span className="brand-dot">.</span>
        </button>
        <div className="topbar-right">
          <span className="source-pill">SEC fundamentals</span>
          <span className="version">NEXT · TS</span>
        </div>
      </header>

      <main className="shell">
        {!company ? (
          <section className="hero">
            <div className="eyebrow">INVESTMENT RESEARCH WORKSPACE</div>
            <h1>Understand the business<br /><span>behind the numbers.</span></h1>
            <p>
              Start with a ticker. CALDUN turns public filings into a structured path from historical
              performance to forecast, valuation, and memo.
            </p>
            <form className="ticker-form" onSubmit={loadCompany}>
              <div className="ticker-box">
                <span className="search-icon">⌕</span>
                <input
                  value={ticker}
                  onChange={(event) => setTicker(event.target.value)}
                  autoComplete="off"
                  maxLength={12}
                  placeholder="Enter ticker, e.g. AAPL"
                  aria-label="Ticker symbol"
                />
                <button type="submit" disabled={loading}>
                  {loading ? 'Loading…' : <>Analyze <span>→</span></>}
                </button>
              </div>
              <div className="helper">US SEC filers supported. Annual fundamentals are normalized from SEC Company Facts.</div>
            </form>
            {error ? <div className="error">{error}</div> : null}
          </section>
        ) : (
          <section className="workspace">
            <div className="company-header">
              <div>
                <div className="company-kicker"><span>{company.ticker}</span><span>•</span><span>SEC FILER</span></div>
                <h2>{company.name}</h2>
              </div>
              <button className="ghost-button" onClick={() => { setCompany(null); setError(''); }}>
                Analyze another company
              </button>
            </div>

            <nav className="tabs" aria-label="CALDUN workflow">
              {(['overview', 'financials', 'forecast', 'valuation', 'memo'] as Tab[]).map((tab) => (
                <button
                  key={tab}
                  className={`tab ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </nav>

            {activeTab === 'overview' && <Overview company={company} />}
            {activeTab === 'financials' && <Financials company={company} />}
            {activeTab === 'forecast' && (
              <Forecast company={company} assumptions={assumptions} sources={sources} onChange={updateAssumption} result={result} />
            )}
            {activeTab === 'valuation' && (
              <Valuation company={company} assumptions={assumptions} result={result} />
            )}
            {activeTab === 'memo' && (
              <Memo company={company} assumptions={assumptions} result={result} memo={memo} setMemo={setMemo} onCopy={copyMemo} copied={copied} />
            )}
          </section>
        )}
      </main>

      <footer>CALDUN · Filing-derived fundamentals for research workflows · Not investment advice</footer>
    </>
  );
}

function SectionHeading({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return (
    <div className="section-heading">
      <div><span className="section-index">{index}</span><h3>{title}</h3></div>
      <p>{subtitle}</p>
    </div>
  );
}

function Overview({ company }: { company: CompanyData }) {
  const financials = company.financials;
  const latest = financials.at(-1);
  const previous = financials.at(-2);
  const growth = latest?.revenue && previous?.revenue ? latest.revenue / previous.revenue - 1 : null;
  const revenueRows = financials.filter((row) => row.revenue != null);
  const max = Math.max(...revenueRows.map((row) => Math.abs(row.revenue || 0)), 1);

  const cards = [
    ['Revenue', fmtMoney(latest?.revenue), latest?.periodEnd || 'Latest FY'],
    ['Revenue growth', fmtPct(growth), 'YoY'],
    ['Operating margin', fmtPct(latest?.operatingMargin), 'Latest FY'],
    ['Free cash flow', fmtMoney(latest?.freeCashFlow), latest?.periodEnd || 'Latest FY'],
  ];

  return (
    <section>
      <SectionHeading index="01" title="Historical snapshot" subtitle="Filing-derived fundamentals for the selected company." />
      <div className="metric-grid">
        {cards.map(([label, value, sub]) => (
          <div className="metric" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
            <div className="metric-sub">{sub}</div>
          </div>
        ))}
      </div>
      <div className="panel chart-panel">
        <div className="panel-title"><div><span>Revenue history</span><small>USD</small></div><span className="source-label">SEC Company Facts</span></div>
        <div className="bar-chart">
          {revenueRows.map((row) => (
            <div className="bar-column" key={row.periodEnd}>
              <div className="bar-value">{fmtMoney(row.revenue)}</div>
              <div className="bar" style={{ height: `${Math.max(5, Math.abs(row.revenue || 0) / max * 82)}%` }} />
              <div className="bar-year">{row.year}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Financials({ company }: { company: CompanyData }) {
  const rows: Array<[string, keyof CompanyData['financials'][number], (value: number | null) => string]> = [
    ['Revenue', 'revenue', (value) => fmtMoney(value)],
    ['Operating income', 'operatingIncome', (value) => fmtMoney(value)],
    ['Operating margin', 'operatingMargin', (value) => fmtPct(value)],
    ['Net income', 'netIncome', (value) => fmtMoney(value)],
    ['Operating cash flow', 'operatingCashFlow', (value) => fmtMoney(value)],
    ['Capital expenditures', 'capex', (value) => value == null ? '—' : fmtMoney(-Math.abs(value))],
    ['Free cash flow', 'freeCashFlow', (value) => fmtMoney(value)],
    ['D&A', 'depreciationAndAmortization', (value) => fmtMoney(value)],
  ];

  return (
    <section>
      <SectionHeading index="02" title="Historical financials" subtitle="Annual fundamentals normalized by actual filing periods." />
      <div className="panel table-wrap">
        <table>
          <thead><tr><th>USD</th>{company.financials.map((row) => <th key={row.periodEnd}>{row.year}<small className="table-date">{row.periodEnd}</small></th>)}</tr></thead>
          <tbody>
            {rows.map(([label, key, formatter]) => (
              <tr key={label}><td>{label}</td>{company.financials.map((row) => <td key={row.periodEnd}>{formatter(row[key] as number | null)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Forecast({
  company,
  assumptions,
  sources,
  onChange,
  result,
}: {
  company: CompanyData;
  assumptions: Assumptions;
  sources: AssumptionSources;
  onChange: (key: AssumptionKey, value: number) => void;
  result: ReturnType<typeof dcf> | null;
}) {
  return (
    <section>
      <SectionHeading index="03" title="Forecast engine" subtitle="Edit assumptions. CALDUN recalculates the model immediately." />
      <div className="forecast-layout">
        <div className="panel assumptions-panel">
          <div className="panel-title"><span>Model assumptions</span><small>Editable</small></div>
          {ASSUMPTION_DEFS.map((definition) => (
            <div className="assumption" key={definition.key}>
              <label htmlFor={`assumption-${definition.key}`}>
                <span>{definition.label}</span><strong>{pct(assumptions[definition.key])}</strong>
              </label>
              <div className={`source-badge source-${sources[definition.key]}`}>{SOURCE_LABEL[sources[definition.key]]}</div>
              <input
                id={`assumption-${definition.key}`}
                type="range"
                min={definition.min}
                max={definition.max}
                step={definition.step}
                value={assumptions[definition.key]}
                onChange={(event) => onChange(definition.key, Number(event.target.value))}
              />
            </div>
          ))}
        </div>
        <div className="panel table-wrap">
          {result?.error ? (
            <div className="model-error"><strong>Model validation</strong><span>{result.error.message}</span></div>
          ) : null}
          <table>
            <thead><tr><th>USD</th>{result?.fc.map((row) => <th key={row.year}>{row.year}E</th>)}</tr></thead>
            <tbody>
              {([
                ['Revenue', 'revenue', (v: number) => fmtMoney(v)],
                ['EBIT', 'ebit', (v: number) => fmtMoney(v)],
                ['NOPAT', 'nopat', (v: number) => fmtMoney(v)],
                ['D&A', 'da', (v: number) => fmtMoney(v)],
                ['CapEx', 'capex', (v: number) => fmtMoney(-Math.abs(v))],
                ['ΔNWC', 'nwc', (v: number) => fmtMoney(-v)],
                ['UFCF', 'ufcf', (v: number) => fmtMoney(v)],
              ] as const).map(([label, key, formatter]) => (
                <tr key={label}><td>{label}</td>{result?.fc.map((row) => <td key={row.year}>{formatter(row[key])}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="data-note">Balance-sheet bridge date: {company.balanceSheet.asOf || 'unavailable'} · Shares date: {company.balanceSheet.sharesAsOf || 'unavailable'}</div>
    </section>
  );
}

function Valuation({
  company,
  assumptions,
  result,
}: {
  company: CompanyData;
  assumptions: Assumptions;
  result: ReturnType<typeof dcf> | null;
}) {
  if (!result) return null;
  const ws = [-1, -0.5, 0, 0.5, 1].map((delta) => assumptions.wacc + delta);
  const gs = [-1, -0.5, 0, 0.5, 1].map((delta) => Math.max(0, assumptions.terminal + delta));

  return (
    <section>
      <SectionHeading index="04" title="DCF valuation" subtitle="Translate operating assumptions into an implied equity value." />
      {result.error ? <div className="model-error standalone"><strong>Cannot calculate base-case DCF</strong><span>{result.error.message}</span></div> : null}
      <div className="valuation-grid">
        <div className="panel valuation-card">
          <div className="valuation-hero"><div className="eyebrow-small">IMPLIED VALUE / SHARE</div><strong>{fmtPerShare(result.perShare)}</strong></div>
          {result.missingEquityBridge?.length ? (
            <div className="bridge-warning">Per-share value is withheld because {result.missingEquityBridge.join(' and ')} data is missing.</div>
          ) : null}
          <div className="valuation-lines">
            <ValueLine label="Enterprise value" value={fmtMoney(result.ev)} />
            <ValueLine label="PV forecast FCF" value={fmtMoney(result.pv)} />
            <ValueLine label="PV terminal value" value={fmtMoney(result.pvTv)} />
            <ValueLine label={`Cash${company.balanceSheet.asOf ? ` · ${company.balanceSheet.asOf}` : ''}`} value={fmtMoney(company.balanceSheet.cash)} />
            <ValueLine label={`Debt${company.balanceSheet.asOf ? ` · ${company.balanceSheet.asOf}` : ''}`} value={fmtMoney(company.balanceSheet.debt)} />
            <ValueLine label="Equity value" value={fmtMoney(result.equity)} />
            <ValueLine label="Shares outstanding" value={company.balanceSheet.sharesOutstanding ? `${(company.balanceSheet.sharesOutstanding / 1e6).toFixed(1)}M` : 'Unavailable'} />
          </div>
        </div>
        <div className="panel sensitivity-panel">
          <div className="panel-title"><span>WACC × terminal growth</span><small>Implied share value</small></div>
          <div className="sensitivity-wrap">
            <table className="sensitivity">
              <thead><tr><th>WACC ↓ / g →</th>{gs.map((g) => <th key={g}>{g.toFixed(1)}%</th>)}</tr></thead>
              <tbody>
                {ws.map((w, wi) => (
                  <tr key={w}><th>{w.toFixed(1)}%</th>{gs.map((g, gi) => {
                    const sensitivity = dcf({ financials: company.financials, balanceSheet: company.balanceSheet, assumptions }, { wacc: w, terminal: g });
                    return <td className={wi === 2 && gi === 2 ? 'center' : ''} key={g}>{fmtPerShare(sensitivity.perShare)}</td>;
                  })}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

function ValueLine({ label, value }: { label: string; value: string }) {
  return <div className="valuation-line"><span>{label}</span><span>{value}</span></div>;
}

function Memo({
  company,
  assumptions,
  result,
  memo,
  setMemo,
  onCopy,
  copied,
}: {
  company: CompanyData;
  assumptions: Assumptions;
  result: ReturnType<typeof dcf> | null;
  memo: MemoState;
  setMemo: React.Dispatch<React.SetStateAction<MemoState>>;
  onCopy: () => void;
  copied: boolean;
}) {
  const history = company.financials.filter((row) => row.revenue != null);
  const first = history[0];
  const last = history.at(-1);
  const historyYears = first && last ? Math.max(1, last.year - first.year) : 1;
  const historicalGrowth = first?.revenue && last?.revenue
    ? Math.pow(last.revenue / first.revenue, 1 / historyYears) - 1
    : null;

  return (
    <section>
      <SectionHeading index="05" title="Investment memo" subtitle="Model-aware draft. Your analyst writing is preserved while assumptions change." />
      <div className="panel memo-panel">
        <div className="memo-toolbar"><span>DRAFT — ANALYST REVIEW REQUIRED</span><button className="ghost-button" onClick={onCopy}>{copied ? 'Copied' : 'Copy memo'}</button></div>
        <div className="memo">
          <h4>{company.name}</h4>
          <div className="memo-meta">{company.ticker} · CALDUN MODEL DRAFT · {new Date().toLocaleDateString()}</div>
          <h5>Executive summary</h5>
          <p>
            CALDUN&apos;s current base case uses {pct(assumptions.growth)} annual revenue growth, a {pct(assumptions.margin)} EBIT margin,
            a {pct(assumptions.wacc)} WACC, and {pct(assumptions.terminal)} terminal growth. The model implies {result?.perShare != null
              ? <><strong>{fmtPerShare(result.perShare)}</strong> per share.</>
              : <>no per-share value until the model validation and equity bridge are complete.</>}
          </p>
          <h5>Historical performance</h5>
          <p>
            {company.name} reported {fmtMoney(last?.revenue)} of revenue for the annual period ending {last?.periodEnd || '—'}.
            {historicalGrowth != null ? ` Across the available history, revenue compounded at roughly ${fmtPct(historicalGrowth)} per year.` : ''}
            {' '}Latest operating margin was {fmtPct(last?.operatingMargin)} and filing-derived free cash flow was {fmtMoney(last?.freeCashFlow)}.
          </p>
          <h5>Investment thesis</h5>
          <textarea value={memo.thesis} onChange={(event) => setMemo((current) => ({ ...current, thesis: event.target.value }))} placeholder="Write the analyst's thesis here. CALDUN should structure the work; the investment judgment remains yours." />
          <h5>Catalysts</h5>
          <textarea value={memo.catalysts} onChange={(event) => setMemo((current) => ({ ...current, catalysts: event.target.value }))} placeholder="Add catalysts supported by filings, earnings materials, or your research." />
          <h5>Risks</h5>
          <textarea value={memo.risks} onChange={(event) => setMemo((current) => ({ ...current, risks: event.target.value }))} placeholder="Add risks that could invalidate the thesis or forecast assumptions." />
          <h5>Valuation</h5>
          <p>
            The base-case DCF produces enterprise value of {fmtMoney(result?.ev)} and equity value of {fmtMoney(result?.equity)}.
            Review the WACC/terminal-growth sensitivity before using the output in an investment conclusion.
          </p>
        </div>
      </div>
    </section>
  );
}

function buildMemoText(
  company: CompanyData,
  assumptions: Assumptions,
  result: ReturnType<typeof dcf>,
  memo: MemoState,
) {
  const latest = company.financials.at(-1);
  return `${company.name} (${company.ticker})\n\nExecutive summary\nBase case: ${pct(assumptions.growth)} revenue growth, ${pct(assumptions.margin)} EBIT margin, ${pct(assumptions.wacc)} WACC, ${pct(assumptions.terminal)} terminal growth. Implied value/share: ${fmtPerShare(result.perShare)}.\n\nHistorical performance\nLatest annual revenue: ${fmtMoney(latest?.revenue)}. Operating margin: ${fmtPct(latest?.operatingMargin)}. Free cash flow: ${fmtMoney(latest?.freeCashFlow)}.\n\nInvestment thesis\n${memo.thesis || '[Not yet written]'}\n\nCatalysts\n${memo.catalysts || '[Not yet written]'}\n\nRisks\n${memo.risks || '[Not yet written]'}\n\nValuation\nEnterprise value: ${fmtMoney(result.ev)}. Equity value: ${fmtMoney(result.equity)}.\n`;
}
