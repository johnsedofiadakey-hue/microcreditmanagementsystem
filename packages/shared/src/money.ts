import { z } from 'zod';

/**
 * All money is integer pesewas (1 GH₵ = 100 pesewas). Never floats, never formatted strings.
 * The ceiling keeps every amount and every sum well inside Number.MAX_SAFE_INTEGER.
 */
export const MAX_PESEWAS = 100_000_000_000; // GH₵ 1,000,000,000.00

export const pesewasSchema = z.int().min(0).max(MAX_PESEWAS);
export const positivePesewasSchema = z.int().min(1).max(MAX_PESEWAS);

export function isPesewas(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_PESEWAS;
}

const cedisFormatter = new Intl.NumberFormat('en-GH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123450 -> "GH₵ 1,234.50". Negative amounts render as "-GH₵ 1,234.50". */
export function formatCedis(pesewas: number): string {
  if (!Number.isSafeInteger(pesewas)) {
    throw new RangeError(`formatCedis expects integer pesewas, got ${pesewas}`);
  }
  const sign = pesewas < 0 ? '-' : '';
  return `${sign}GH₵ ${cedisFormatter.format(Math.abs(pesewas) / 100)}`;
}

/**
 * Strict parser for user-typed cedi amounts: "12", "12.5", "12.50", "1,234.50".
 * Rejects more than two decimals, negatives and anything non-numeric. Returns pesewas.
 */
export function parseCedis(input: string): number {
  const cleaned = input.trim().replace(/^GH₵\s*/i, '').replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new RangeError(`"${input}" is not a valid cedi amount`);
  }
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const pesewas = whole * 100 + fraction;
  if (!isPesewas(pesewas)) {
    throw new RangeError(`"${input}" is outside the allowed range`);
  }
  return pesewas;
}
