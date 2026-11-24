import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  filtersFromSearchParams,
  filtersToSearchParams,
  hasActiveFilters,
  toListQuery,
} from './filters';

const params = (s: string) => new URLSearchParams(s);
const UUID = '00000000-0000-4000-8000-00000000000d';

describe('directory filters <-> URL', () => {
  it('reads comma-separated lists, in canonical order, without duplicates or unknown values', () => {
    const f = filtersFromSearchParams(params('status=ON_LEAVE,ACTIVE,ACTIVE,NOPE&type=INTERN,CONTRACT'));
    expect(f.status).toEqual(['ACTIVE', 'ON_LEAVE']);
    expect(f.employmentType).toEqual(['CONTRACT', 'INTERN']);
  });

  it('a single legacy value still works, and garbage becomes "no filter"', () => {
    expect(filtersFromSearchParams(params('status=ACTIVE')).status).toEqual(['ACTIVE']);
    expect(filtersFromSearchParams(params('status=%00&type=')).status).toEqual([]);
    expect(filtersFromSearchParams(params('type=')).employmentType).toEqual([]);
  });

  it('ignores ids that are not UUIDs (never sent to the API)', () => {
    const f = filtersFromSearchParams(params(`dept=not-a-uuid&manager=also-bad&managerName=X`));
    expect(f.departmentId).toBe('');
    expect(f.manager).toBeNull();
    expect(filtersFromSearchParams(params(`dept=${UUID}&manager=${UUID}&managerName=Neha`)).manager).toEqual({ id: UUID, label: 'Neha' });
  });

  it('round-trips every filter', () => {
    const f = { ...EMPTY_FILTERS, q: ' neha ', status: ['ACTIVE', 'ON_LEAVE'] as const, employmentType: ['INTERN'] as const, departmentId: UUID, manager: { id: UUID, label: 'Neha Gupta · GS-0013' } };
    const url = filtersToSearchParams({ ...f, status: [...f.status], employmentType: [...f.employmentType] });
    expect(url.get('q')).toBe('neha');
    expect(url.get('status')).toBe('ACTIVE,ON_LEAVE');
    expect(url.get('type')).toBe('INTERN');
    expect(filtersFromSearchParams(url)).toEqual({ ...f, q: 'neha', status: ['ACTIVE', 'ON_LEAVE'], employmentType: ['INTERN'] });
  });

  it('empty filters produce an empty URL and an unfiltered query', () => {
    expect(filtersToSearchParams(EMPTY_FILTERS).toString()).toBe('');
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(toListQuery(EMPTY_FILTERS, { limit: 25 })).toEqual({ limit: 25 });
  });

  it('builds list queries with arrays only when something is selected', () => {
    const q = toListQuery({ ...EMPTY_FILTERS, status: ['ACTIVE', 'ON_LEAVE'], employmentType: [] }, { limit: 25, cursor: 'c1' });
    expect(q).toEqual({ limit: 25, cursor: 'c1', status: ['ACTIVE', 'ON_LEAVE'] });
    expect(hasActiveFilters({ ...EMPTY_FILTERS, employmentType: ['INTERN'] })).toBe(true);
  });
});
