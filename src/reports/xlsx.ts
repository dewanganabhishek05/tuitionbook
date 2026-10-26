// Report -> .xlsx bytes (one sheet per table, plus an Overview sheet with the summary).
import * as XLSX from 'xlsx';
import { formatCell } from './html';
import type { Cell, Fmt, Report, Table } from './types';

const NUM_FMT: Partial<Record<Fmt, string>> = { money: '"₹"#,##0', pct: '0"%"', int: '0' };

function sheetFor(t: Table): XLSX.WorkSheet {
  const aoa: Cell[][] = [t.columns];
  if (t.subHeaders) aoa.push(t.subHeaders);
  const headerRows = aoa.length;
  aoa.push(...t.rows);
  if (t.totals) aoa.push(t.totals);
  if (!t.rows.length) aoa.push([t.emptyNote ?? 'Nothing to show.']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const fmt = (i: number) => t.fmt?.[i] ?? 'text';
  // number formats, so the sheet shows ₹1,500 and 85% but keeps real numbers for sums
  for (let r = headerRows; r < aoa.length; r++) {
    aoa[r].forEach((v, c) => {
      const f = NUM_FMT[fmt(c)];
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && f && typeof v === 'number') cell.z = f;
    });
  }
  ws['!cols'] = t.columns.map((name, i) => {
    const longest = Math.max(name.length, ...t.rows.map((r) => formatCell(r[i] ?? null, fmt(i)).length), 3);
    return { wch: Math.min(40, longest + 2) };
  });
  ws['!freeze'] = { xSplit: 1, ySplit: headerRows } as never;
  return ws;
}

export function reportToXlsx(r: Report): Uint8Array {
  const wb = XLSX.utils.book_new();
  const overview: Cell[][] = [[r.owner], [r.title], [r.subtitle], [`Generated ${r.generatedOn}`], [], ...r.summary.map(([k, v]) => [k, v])];
  const ov = XLSX.utils.aoa_to_sheet(overview);
  ov['!cols'] = [{ wch: 26 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, ov, 'Overview');
  const used = new Set(['overview']);
  for (const t of r.tables) {
    let name = t.name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${name.slice(0, 28)} ${i}`;
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, sheetFor(t), name);
  }
  // XLSX returns an ArrayBuffer here; the native file writer wants a real Uint8Array
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
