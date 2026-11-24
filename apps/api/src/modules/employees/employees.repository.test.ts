import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, escapeLike } from './employees.repository';

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character so they match literally', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c:\\dir')).toBe('c:\\\\dir');
    expect(escapeLike('%_\\')).toBe('\\%\\_\\\\');
  });
  it('leaves ordinary text, apostrophes and accents alone', () => {
    expect(escapeLike("O'Brien Édouard")).toBe("O'Brien Édouard");
  });
});

describe('cursor encoding', () => {
  it('round-trips names with punctuation and accents', () => {
    const row = { lastName: "O'Brien", firstName: 'Édith', id: 'id-1' };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
  });
  it('rejects garbage', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(/Invalid cursor/);
    expect(() => decodeCursor(Buffer.from('[1,2,3]').toString('base64url'))).toThrow(/Invalid cursor/);
  });
});
