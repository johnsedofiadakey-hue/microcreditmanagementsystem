/**
 * Parse a bank statement CSV in the browser for importBankStatement (API.md §2). Banks differ, so the
 * person maps columns; we guess the mapping from the header. Amounts become signed integer pesewas
 * (credits positive) and are never computed with floats.
 */

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export interface ColumnMapping {
  date: number;
  /** Either one signed amount column… */
  amount: number;
  /** …or separate credit and debit columns (both unsigned). */
  credit: number;
  debit: number;
  reference: number;
  description: number;
  balance: number;
}

export interface ParsedLine {
  date: string;
  amountPesewas: number;
  reference: string;
  description: string;
  balanceAfterPesewas?: number;
}

export interface ParseResult {
  lines: ParsedLine[];
  /** 1-based CSV row numbers (after the header) that could not be read, with the reason. */
  problems: { row: number; message: string }[];
}

/** RFC 4180-style parsing: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  const [headers = [], ...body] = rows;
  return { headers: headers.map((h) => h.trim()), rows: body };
}

const find = (headers: string[], ...patterns: RegExp[]) =>
  headers.findIndex((h) => patterns.some((p) => p.test(h.toLowerCase())));

/** Best-guess column mapping from header names. -1 means "not present". */
export function guessMapping(headers: string[]): ColumnMapping {
  const credit = find(headers, /credit/, /deposit/, /money in/, /paid in/);
  const debit = find(headers, /debit/, /withdrawal/, /money out/, /paid out/);
  return {
    date: find(headers, /^(transaction |trans\.? |value |posting )?date/, /date/),
    amount: credit >= 0 && debit >= 0 ? -1 : find(headers, /^amount/, /amount/),
    credit,
    debit,
    reference: find(headers, /ref/, /cheque/, /slip/),
    description: find(headers, /desc/, /narrat/, /details/, /particular/, /memo/),
    balance: find(headers, /balance/),
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function validDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Ghanaian banks print day first. Accepts 2026-10-19, 19/10/2026, 19-10-2026, 19.10.26,
 * 19-Oct-2026 and 19 Oct 2026. Returns yyyy-mm-dd or null.
 */
export function parseStatementDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validDate(year, Number(m[2]), Number(m[1]));
  }
  m = /^(\d{1,2})[\s/-]([A-Za-z]{3,4})[a-z]*[\s/-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()];
    if (!month) return null;
    const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return validDate(year, month, Number(m[1]));
  }
  return null;
}

/**
 * "1,234.50", "-20", "(20.00)", "20.00 CR", "GH₵ 5", "GHS 5.5" → signed pesewas. Empty → null.
 * More than two decimals is refused rather than rounded.
 */
export function parseStatementAmount(raw: string): number | null | 'invalid' {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\s*(DR|D)$/i.test(s)) {
    negative = true;
    s = s.replace(/\s*(DR|D)$/i, '');
  }
  s = s.replace(/\s*(CR|C)$/i, '').replace(/^(GH₵|GHS|GHC|₵)\s*/i, '').replace(/,/g, '').trim();
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return 'invalid';
  const pesewas = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(pesewas)) return 'invalid';
  return negative ? -pesewas : pesewas;
}

export function toStatementLines(table: CsvTable, mapping: ColumnMapping): ParseResult {
  const lines: ParsedLine[] = [];
  const problems: ParseResult['problems'] = [];
  const cell = (row: string[], index: number) => (index >= 0 ? (row[index] ?? '').trim() : '');

  table.rows.forEach((row, i) => {
    const rowNumber = i + 1;
    const date = parseStatementDate(cell(row, mapping.date));
    if (!date) {
      problems.push({ row: rowNumber, message: `Date “${cell(row, mapping.date)}” not recognised` });
      return;
    }

    let amount: number | null | 'invalid';
    if (mapping.amount >= 0) {
      amount = parseStatementAmount(cell(row, mapping.amount));
    } else {
      const credit = parseStatementAmount(cell(row, mapping.credit));
      const debit = parseStatementAmount(cell(row, mapping.debit));
      if (credit === 'invalid' || debit === 'invalid') amount = 'invalid';
      else if (credit && debit) amount = 'invalid';
      else amount = credit ? Math.abs(credit) : debit ? -Math.abs(debit) : null;
    }
    if (amount === 'invalid') {
      problems.push({ row: rowNumber, message: 'Amount not readable (more than two decimals, or both credit and debit filled)' });
      return;
    }
    if (!amount) {
      problems.push({ row: rowNumber, message: 'No amount (skipped)' });
      return;
    }

    const balance = mapping.balance >= 0 ? parseStatementAmount(cell(row, mapping.balance)) : null;
    lines.push({
      date,
      amountPesewas: amount,
      reference: cell(row, mapping.reference).slice(0, 120),
      description: cell(row, mapping.description).slice(0, 300),
      ...(typeof balance === 'number' ? { balanceAfterPesewas: balance } : {}),
    });
  });
  return { lines, problems };
}
