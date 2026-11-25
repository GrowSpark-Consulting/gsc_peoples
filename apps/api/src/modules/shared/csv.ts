/**
 * CSV for spreadsheet download (RFC 4180). A cell that a spreadsheet would execute as a formula (starting with
 * = + - @, tab or carriage return) is prefixed with an apostrophe, so a name typed into the HR system can never
 * run in the person's spreadsheet who opens the export.
 */
export type CsvValue = string | number | null | undefined;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Starts with a byte-order mark so spreadsheet programs read non-ASCII names correctly. */
export function toCsv(header: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return `\uFEFF${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
