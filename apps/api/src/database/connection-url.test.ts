import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from './connection-url';

describe('parseDatabaseUrl', () => {
  it('extracts the schema and keeps other params', () => {
    const r = parseDatabaseUrl('postgresql://u:p@localhost:5432/hr_db?schema=hr&sslmode=disable');
    expect(r.schema).toBe('hr');
    expect(r.connectionString).toBe('postgresql://u:p@localhost:5432/hr_db?sslmode=disable');
  });

  it('returns no schema when absent', () => {
    expect(parseDatabaseUrl('postgresql://u:p@localhost:5432/hr_db').schema).toBeUndefined();
  });
});
