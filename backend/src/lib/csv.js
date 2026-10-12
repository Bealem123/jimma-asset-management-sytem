// RFC 4180 CSV with a UTF-8 BOM (so Excel reads Amharic / Afaan Oromo text correctly).
// Cells that start with = + - @ are prefixed with ' to prevent spreadsheet formula injection.
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.key])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
