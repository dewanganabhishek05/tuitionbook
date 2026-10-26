// Report -> printable HTML (turned into a PDF by expo-print).
import { rupees } from '../lib/format';
import type { Cell, Fmt, Report, Table } from './types';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function formatCell(v: Cell, f: Fmt = 'text'): string {
  if (v === null || v === undefined || v === '') return f === 'pct' || f === 'money' || f === 'int' ? '—' : '';
  if (typeof v === 'number') return f === 'money' ? rupees(v) : f === 'pct' ? `${v}%` : String(v);
  return String(v);
}

const alignOf = (f: Fmt = 'text') => (f === 'text' ? 'left' : f === 'center' ? 'center' : 'right');

function tableHtml(t: Table, dense: boolean): string {
  const fmt = (i: number) => t.fmt?.[i] ?? 'text';
  const th = (cols: string[], cls = '') =>
    `<tr>${cols.map((c, i) => `<th class="${cls}" style="text-align:${alignOf(fmt(i))}">${esc(c)}</th>`).join('')}</tr>`;
  const td = (r: Cell[], cls = '') =>
    `<tr class="${cls}">${r.map((c, i) => {
      const f = fmt(i);
      return `<td style="text-align:${alignOf(f)}">${esc(formatCell(c, f))}</td>`;
    }).join('')}</tr>`;
  const body = t.rows.length
    ? t.rows.map((r) => td(r)).join('') + (t.totals ? td(t.totals, 'total') : '')
    : `<tr><td colspan="${t.columns.length}" class="empty">${esc(t.emptyNote ?? 'Nothing to show.')}</td></tr>`;
  return `<h2>${esc(t.name)}</h2>
<table class="${dense ? 'dense' : ''}">
<thead>${th(t.columns)}${t.subHeaders ? th(t.subHeaders, 'sub') : ''}</thead>
<tbody>${body}</tbody>
</table>`;
}

export function reportToHtml(r: Report): string {
  const wide = r.tables.some((t) => t.columns.length > 12);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)} · ${esc(r.subtitle)}</title>
<style>
  @page { size: A4 ${r.landscape ? 'landscape' : 'portrait'}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif; color: #14142B; margin: 0; padding: 16px; font-size: 11px; }
  .brand { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #5B5CF0; padding-bottom: 8px; }
  .brand .owner { font-size: 11px; color: #62667E; }
  h1 { font-size: 22px; margin: 2px 0 0; letter-spacing: -0.3px; }
  .sub { color: #5B5CF0; font-weight: 600; font-size: 13px; }
  .meta { text-align: right; color: #62667E; font-size: 10px; }
  .summary { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 12px 0 4px; }
  .summary div { min-width: 120px; }
  .summary b { display: block; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; color: #62667E; }
  .summary span { font-size: 13px; font-weight: 600; }
  h2 { font-size: 14px; margin: 20px 0 6px; color: #14142B; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  th { background: #E8E9FE; color: #3A3BB0; font-weight: 600; padding: 5px 6px; border: 1px solid #D4D6F5; font-size: ${wide ? 9 : 10.5}px; }
  th.sub { background: #F4F5FC; color: #62667E; font-weight: 500; font-size: 8px; }
  td { padding: 4px 6px; border: 1px solid #E4E6F4; font-size: ${wide ? 9 : 11}px; }
  table.dense th, table.dense td { padding: 3px 2px; }
  tbody tr:nth-child(even) td { background: #FAFAFE; }
  tr.total td { font-weight: 700; background: #F0F1FD !important; }
  td.empty { text-align: center; color: #A3A7BD; padding: 14px; }
  .foot { margin-top: 18px; color: #A3A7BD; font-size: 9px; text-align: center; }
</style></head><body>
<div class="brand">
  <div><div class="owner">${esc(r.owner)}</div><h1>${esc(r.title)}</h1><div class="sub">${esc(r.subtitle)}</div></div>
  <div class="meta">Generated ${esc(r.generatedOn)}<br>TuitionBook</div>
</div>
<div class="summary">${r.summary.map(([k, v]) => `<div><b>${esc(k)}</b><span>${esc(v)}</span></div>`).join('')}</div>
${r.tables.map((t) => tableHtml(t, t.columns.length > 12)).join('\n')}
<div class="foot">Made with TuitionBook</div>
</body></html>`;
}
