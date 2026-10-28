/**
 * Real Estate reports — CSV export through the repo's established convention
 * (same BOM + blob + programmatic anchor download used by the billing
 * report-export module). Callers must gate on real_estate.export.
 */

function escapeCsvCell(value: string | number): string {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function datedFilename(prefix: string): string {
  return `rem_${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
}

export function downloadRemCsv(prefix: string, rows: (string | number)[][]): void {
  const lines = rows.map((row) => row.map(escapeCsvCell).join(","));
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = datedFilename(prefix);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
