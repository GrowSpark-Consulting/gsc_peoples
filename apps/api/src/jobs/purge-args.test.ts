import { describe, expect, it } from 'vitest';
import { parsePurgeArgs } from './purge-args';

const id = '11111111-2222-4333-8444-555555555555';

describe('retention job arguments', () => {
  it('is a dry run unless --execute is given', () => {
    expect(parsePurgeArgs(['--company', id], undefined)).toEqual({ companyIds: [id], execute: false, limit: 100 });
    expect(parsePurgeArgs(['--company', id, '--execute', '--limit', '5'], undefined)).toMatchObject({ execute: true, limit: 5 });
  });
  it('takes company ids from the environment when none is passed', () => {
    expect(parsePurgeArgs(['--execute'], ` ${id} ,${id}`).companyIds).toEqual([id]);
  });
  it('stops on anything unexpected, before touching data', () => {
    expect(() => parsePurgeArgs([], undefined)).toThrow(/company/);
    expect(() => parsePurgeArgs(['--company', 'acme'], undefined)).toThrow(/UUID/);
    expect(() => parsePurgeArgs(['--company', id, '--limit', '0'], undefined)).toThrow(/limit/);
    expect(() => parsePurgeArgs(['--company', id, '--all'], undefined)).toThrow(/Unknown/);
  });
});
