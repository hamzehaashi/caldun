import type { CompanyFact, SecUnit } from '@/types/finance';

const ANNUAL_MIN_DAYS = 300;
const ANNUAL_MAX_DAYS = 430;

function unitSource(fact: CompanyFact | undefined, preferredUnits: string[] = ['USD']): SecUnit[] {
  if (!fact?.units) return [];
  const preferred = preferredUnits.flatMap((unit) => fact.units?.[unit] || []);
  return preferred.length ? preferred : Object.values(fact.units).flat();
}

export function daysBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 86_400_000);
}

export function isAnnualDurationFact(item?: SecUnit): boolean {
  const duration = daysBetween(item?.start, item?.end);
  return Boolean(
    item &&
      Number.isFinite(item.val) &&
      (item.form === '10-K' || item.form === '10-K/A') &&
      duration !== null &&
      duration >= ANNUAL_MIN_DAYS &&
      duration <= ANNUAL_MAX_DAYS,
  );
}

function isLaterFiling(candidate: SecUnit, existing: SecUnit): boolean {
  const candidateFiled = candidate.filed || '';
  const existingFiled = existing.filed || '';
  if (candidateFiled !== existingFiled) return candidateFiled > existingFiled;
  return (candidate.accn || '') > (existing.accn || '');
}

export function annualSeries(
  fact: CompanyFact | undefined,
  preferredUnits: string[] = ['USD'],
): SecUnit[] {
  const byPeriod = new Map<string, SecUnit>();

  for (const item of unitSource(fact, preferredUnits)) {
    if (!isAnnualDurationFact(item) || !item.start || !item.end) continue;
    const key = `${item.start}|${item.end}`;
    const existing = byPeriod.get(key);
    if (!existing || isLaterFiling(item, existing)) byPeriod.set(key, item);
  }

  return [...byPeriod.values()]
    .sort(
      (a, b) =>
        (a.end || '').localeCompare(b.end || '') ||
        (a.start || '').localeCompare(b.start || ''),
    )
    .slice(-6);
}

export function seriesForTags(
  facts: Record<string, CompanyFact>,
  tags: string[],
  preferredUnits: string[] = ['USD'],
): Map<string, SecUnit> {
  for (const tag of tags) {
    const series = annualSeries(facts?.[tag], preferredUnits);
    if (series.length) {
      return new Map(series.map((item) => [item.end!, { ...item, tag }]));
    }
  }
  return new Map();
}

function instantCandidatesAtDate(
  fact: CompanyFact | undefined,
  date: string,
  preferredUnits: string[] = ['USD'],
): SecUnit[] {
  return unitSource(fact, preferredUnits).filter(
    (item) => item.end === date && Number.isFinite(item.val),
  );
}

export function instantForTagsAtDate(
  facts: Record<string, CompanyFact>,
  tags: string[],
  date: string,
  preferredUnits: string[] = ['USD'],
): SecUnit | null {
  for (const tag of tags) {
    const candidates = instantCandidatesAtDate(facts?.[tag], date, preferredUnits);
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      if ((a.filed || '') !== (b.filed || '')) {
        return (b.filed || '').localeCompare(a.filed || '');
      }
      return (b.accn || '').localeCompare(a.accn || '');
    });
    return { ...candidates[0], tag };
  }
  return null;
}

export function latestInstantForTags(
  facts: Record<string, CompanyFact>,
  tags: string[],
  preferredUnits: string[] = ['USD'],
): SecUnit | null {
  for (const tag of tags) {
    const source = unitSource(facts?.[tag], preferredUnits).filter(
      (item) => item.end && Number.isFinite(item.val),
    );
    if (!source.length) continue;
    source.sort((a, b) => {
      if ((a.end || '') !== (b.end || '')) return (b.end || '').localeCompare(a.end || '');
      if ((a.filed || '') !== (b.filed || '')) {
        return (b.filed || '').localeCompare(a.filed || '');
      }
      return (b.accn || '').localeCompare(a.accn || '');
    });
    return { ...source[0], tag };
  }
  return null;
}

export function sumShareClassesAtDate(fact: CompanyFact | undefined, date: string): number | null {
  const candidates = instantCandidatesAtDate(fact, date, ['shares']);
  if (!candidates.length) return null;

  const latestFiled = candidates.reduce(
    (latest, item) => ((item.filed || '') > latest ? item.filed || '' : latest),
    '',
  );
  const sameFiling = candidates.filter((item) => (item.filed || '') === latestFiled);

  const seen = new Set<string>();
  let total = 0;
  let count = 0;
  for (const item of sameFiling) {
    const key = `${item.accn || ''}|${item.val}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += item.val;
    count += 1;
  }
  return count ? total : null;
}

export function sumNullable(...values: Array<number | null | undefined>): number | null {
  const present = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

export function getPeriodValue(map: Map<string, SecUnit>, endDate: string): number | null {
  const item = map.get(endDate);
  return item && Number.isFinite(item.val) ? item.val : null;
}
