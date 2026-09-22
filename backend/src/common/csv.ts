/**
 * CSV cell escaping, shared by every export/import in the app.
 *
 * The leading-character guard stops a value like `=cmd|'/c calc'!A1` from
 * running as a formula the moment someone opens the export in Excel or
 * Sheets — "formula injection," and the standard mitigation is exactly this:
 * prefix a lone `'` so the spreadsheet treats it as literal text.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values.map((v) => csvCell(v === null || v === undefined ? '' : String(v))).join(',');
}
