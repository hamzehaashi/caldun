from pathlib import Path

path = Path('src/components/caldun-workspace.tsx')
s = path.read_text()

replacements = [
    (
        "  { key: 'growth', label: 'Revenue growth', min: -5, max: 25, step: 0.5 },",
        "  { key: 'growth', label: 'Revenue growth', min: -50, max: 100, step: 0.5 },",
    ),
    (
        "  { key: 'margin', label: 'EBIT margin', min: 0, max: 45, step: 0.5 },",
        "  { key: 'margin', label: 'EBIT margin', min: -50, max: 60, step: 0.5 },",
    ),
    (
        "  derived: 'Derived from history',\n  default: 'Default',\n  analyst: 'Analyst-entered',",
        "  derived: 'Derived from history',\n  'derived-adjusted': 'Derived · constrained',\n  default: 'Default',\n  analyst: 'Analyst-entered',",
    ),
    (
        """  const da = latest?.depreciationAndAmortization && latest.revenue
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
}""",
        """  const hasDaHistory = latest?.depreciationAndAmortization != null && Boolean(latest.revenue);
  const hasCapexHistory = latest?.capex != null && Boolean(latest.revenue);
  const da = hasDaHistory
    ? (latest!.depreciationAndAmortization! / latest!.revenue!) * 100
    : DEFAULT_ASSUMPTIONS.da;
  const capex = hasCapexHistory
    ? (latest!.capex! / latest!.revenue!) * 100
    : DEFAULT_ASSUMPTIONS.capex;

  const bounded = {
    growth: clamp(growth, -50, 100),
    margin: clamp(margin, -50, 60),
    da: clamp(da, 0, 20),
    capex: clamp(capex, 0, 20),
  };

  const derivedSource = (raw: number, adjusted: number, available: boolean): AssumptionSource =>
    !available ? 'default' : Math.abs(raw - adjusted) > 1e-9 ? 'derived-adjusted' : 'derived';

  return {
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...bounded },
    sources: {
      growth: derivedSource(growth, bounded.growth, Boolean(latest?.revenue && previous?.revenue)),
      margin: derivedSource(margin, bounded.margin, latest?.operatingMargin != null),
      da: derivedSource(da, bounded.da, hasDaHistory),
      capex: derivedSource(capex, bounded.capex, hasCapexHistory),
      tax: 'default',
      nwc: 'default',
      wacc: 'default',
      terminal: 'default',
    },
  };
}""",
    ),
    (
        """      const response = await fetch(`/api/company?ticker=${encodeURIComponent(normalized)}`);
      const data = await response.json() as CompanyData & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Unable to load company.');
      if (!data.financials?.length) {""",
        """      const response = await fetch(`/api/company?ticker=${encodeURIComponent(normalized)}`);
      const body = await response.text();
      let data: (CompanyData & { error?: string }) | null = null;

      if (body) {
        try {
          data = JSON.parse(body) as CompanyData & { error?: string };
        } catch {
          throw new Error(
            response.ok
              ? 'CALDUN received an unexpected response from the data service.'
              : `CALDUN data service returned HTTP ${response.status}.`,
          );
        }
      }

      if (!response.ok) throw new Error(data?.error || `Unable to load company (HTTP ${response.status}).`);
      if (!data) throw new Error('CALDUN received an empty response from the data service.');
      if (!data.financials?.length) {""",
    ),
    (
        'US SEC filers supported. Annual fundamentals are normalized from SEC Company Facts.',
        'US-GAAP SEC filers supported. Annual fundamentals are normalized from SEC Company Facts.',
    ),
    (
        "<thead><tr><th>WACC ↓ / g →</th>{gs.map((g) => <th key={g}>{g.toFixed(1)}%</th>)}</tr></thead>",
        "<thead><tr><th>WACC ↓ / g →</th>{gs.map((g, gi) => <th key={`${g}-${gi}`}>{g.toFixed(1)}%</th>)}</tr></thead>",
    ),
    (
        "return <td className={wi === 2 && gi === 2 ? 'center' : ''} key={g}>{fmtPerShare(sensitivity.perShare)}</td>;",
        "return <td className={wi === 2 && gi === 2 ? 'center' : ''} key={`${g}-${gi}`}>{fmtPerShare(sensitivity.perShare)}</td>;",
    ),
]

for old, new in replacements:
    if old not in s:
        raise SystemExit(f'Expected source block not found: {old[:120]!r}')
    s = s.replace(old, new, 1)

path.write_text(s)
print('Applied audited Caldun UI/model fixes.')
