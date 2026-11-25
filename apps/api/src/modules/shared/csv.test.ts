import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('quotes separators, quotes and newlines, and starts with a byte-order mark', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"\nnow']])).toBe('\uFEFFa,b\r\n"x,y","say ""hi""\nnow"\r\n');
  });
  it('neutralises cells a spreadsheet would run as a formula', () => {
    const out = toCsv(['name'], [['=HYPERLINK("http://x")'], ['+1'], ['-1'], ['@cmd']]);
    expect(out).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(out).toContain("'+1");
    expect(out).toContain("'-1");
    expect(out).toContain("'@cmd");
  });
  it('leaves numbers (including negative ones) and blanks as they are', () => {
    expect(toCsv(['n', 'e'], [[-2.5, null]])).toBe('\uFEFFn,e\r\n-2.5,\r\n');
  });
});
