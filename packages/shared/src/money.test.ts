import { describe, expect, it } from 'vitest';
import { formatCedis, parseCedis } from './money.js';

describe('formatCedis', () => {
  it('formats pesewas as cedis', () => {
    expect(formatCedis(123450)).toBe('GH₵ 1,234.50');
    expect(formatCedis(5)).toBe('GH₵ 0.05');
    expect(formatCedis(-100)).toBe('-GH₵ 1.00');
  });

  it('rejects non-integers', () => {
    expect(() => formatCedis(1.5)).toThrow(RangeError);
  });
});

describe('parseCedis', () => {
  it('parses typed amounts into pesewas', () => {
    expect(parseCedis('12')).toBe(1200);
    expect(parseCedis('12.5')).toBe(1250);
    expect(parseCedis('1,234.50')).toBe(123450);
    expect(parseCedis('GH₵ 0.05')).toBe(5);
  });

  it('rejects ambiguous or invalid input', () => {
    for (const bad of ['', '-1', '1.234', 'abc', '1e3', '0.0.1']) {
      expect(() => parseCedis(bad)).toThrow(RangeError);
    }
  });
});
