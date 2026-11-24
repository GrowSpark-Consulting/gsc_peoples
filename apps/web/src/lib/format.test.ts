import { describe, expect, it } from 'vitest';
import { formatINR, formatINRShort, getInitials } from './format';

describe('format', () => {
  it('groups rupees the Indian way', () => {
    expect(formatINR(482000)).toBe('₹ 4,82,000');
    expect(formatINR(120000)).toBe('₹ 1,20,000');
  });
  it('shortens to lakh and crore', () => {
    expect(formatINRShort(4820000)).toBe('₹ 48.2 L');
    expect(formatINRShort(12000000)).toBe('₹ 1.2 Cr');
    expect(formatINRShort(85000)).toBe('₹ 85,000');
  });
  it('derives initials', () => {
    expect(getInitials('Ananya Krishnan')).toBe('AK');
    expect(getInitials('Meena')).toBe('M');
    expect(getInitials('  ')).toBe('?');
  });
});
