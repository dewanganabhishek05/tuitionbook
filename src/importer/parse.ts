// Turns rows of cells (from Excel, CSV, Word tables, text lines or OCR) into students.
// Pure functions only, so it runs in the unit tests without React Native.
import { isValidISODate } from '../lib/dates';

export interface ParsedStudent {
  name: string;
  phone: string; // 10 digits, or ''
  class_name: string;
  fee: number | null; // null = not in the file, the default fee is used
  joining: string | null; // YYYY-MM-DD, or null = today
  notes: string;
  source: string; // the line it came from, shown when reviewing
}

export interface ParseResult {
  students: ParsedStudent[];
  /** Lines that had text but did not look like a student. Shown so nothing is silently lost. */
  skipped: string[];
}

export type Row = string[];

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/* ------------------------------------------------------------------ header detection */

type Col = 'name' | 'first' | 'last' | 'phone' | 'class' | 'fee' | 'joining' | 'notes' | 'serial';

const HEADERS: Record<Col, string[]> = {
  name: ['name', 'studentname', 'student', 'nameofstudent', 'nameofthestudent', 'fullname', 'childname', 'pupil', 'studentsname', 'names'],
  first: ['firstname', 'fname', 'givenname'],
  last: ['lastname', 'surname', 'lname', 'familyname'],
  phone: ['phone', 'mobile', 'contact', 'parentphone', 'parentmobile', 'parentcontact', 'phoneno', 'phonenumber', 'mobileno', 'mobilenumber', 'contactno', 'contactnumber', 'whatsapp', 'whatsappno', 'parentsnumber', 'parentnumber', 'parentsphone', 'parentsmobile', 'guardianphone', 'guardiancontact', 'telephone', 'tel', 'cell', 'number', 'mobilephone', 'parentsmobileno'],
  class: ['class', 'std', 'standard', 'grade', 'classname', 'classstd', 'classgrade', 'school', 'schoolname', 'classschool', 'level', 'course', 'section'],
  fee: ['fee', 'fees', 'monthlyfee', 'monthlyfees', 'feeamount', 'tuitionfee', 'tuitionfees', 'amount', 'feepermonth', 'feesmonthly', 'monthly'],
  joining: ['joiningdate', 'dateofjoining', 'doj', 'admissiondate', 'dateofadmission', 'joined', 'startdate', 'joiningon', 'admission', 'date'],
  notes: ['notes', 'note', 'remarks', 'remark', 'address', 'parentname', 'fathername', 'mothername', 'parent', 'father', 'mother', 'guardian', 'guardianname', 'email', 'comments', 'comment', 'dob', 'dateofbirth'],
  serial: ['sr', 'srno', 'sno', 'slno', 'sl', 'no', 'serial', 'serialno', 'rollno', 'roll', 'rollnumber', '#', 'id', 'regno', 'admissionno'],
};

function headerCol(cell: string): Col | null {
  const raw = cell.trim().toLowerCase();
  if (raw === '#') return 'serial';
  const k = letters(cell);
  if (!k || k.length > 22) return null;
  // Longer, more specific matches win over short generic ones ('date' vs 'dateofjoining').
  for (const col of Object.keys(HEADERS) as Col[]) if (HEADERS[col].includes(k)) return col;
  return null;
}

function headerScore(row: Row): number {
  return row.filter((c) => headerCol(c)).length;
}

/* ------------------------------------------------------------------ field extractors */

/** First 10-digit Indian mobile number in the text; returns it and the text without it. */
export function takePhones(text: string): { phones: string[]; rest: string } {
  const phones: string[] = [];
  let rest = text;
  // An Indian mobile (optionally +91 / 0 prefixed, split as 5+5), or any other 10 digits in a row.
  const re = /(?<!\d)(?:(?:\+\s?91[\s-]?|91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}|\d{5}[\s-]\d{5}|\d{10})(?!\d)/g;
  rest = rest.replace(re, (m) => {
    let d = m.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) {
      phones.push(d);
      return ' ';
    }
    return m;
  });
  return { phones, rest };
}

export function normDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; // day first, as in India
    return isValidISODate(iso) ? iso : null;
  }
  m = t.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]*(\d{2}|\d{4})$/);
  if (m) {
    const mi = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      const iso = `${y}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      return isValidISODate(iso) ? iso : null;
    }
  }
  return null;
}

const DATE_IN_TEXT = /\b(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2}))\b/;

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };

/** "8", "8th", "VIII", "Class 8", "Std-8" → "Class 8". Anything else is returned as written. */
export function normClass(s: string): string {
  const t = squash(s);
  if (!t) return '';
  const m = t.match(/^(?:class|std|standard|grade|cls)\.?\s*[:-]?\s*(\d{1,2}|[ivx]{1,4})(?:st|nd|rd|th)?(?:\s*[-–]?\s*([A-Da-d]))?$/i)
    ?? t.match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–]?\s*([A-Da-d]))?$/i)
    ?? t.match(/^([ivx]{1,4})$/i);
  if (m) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : ROMAN[m[1].toLowerCase()];
    if (n && n >= 1 && n <= 12) return `Class ${n}${m[2] ? ' ' + m[2].toUpperCase() : ''}`;
  }
  return t;
}

const CLASS_IN_TEXT = new RegExp(
  '\\b(?:(?:class|std|standard|grade|cls)\\.?\\s*[:\\-]?\\s*(\\d{1,2}|[ivx]{1,4})(?:st|nd|rd|th)?' +
  '|(\\d{1,2})(?:st|nd|rd|th)\\s*(?:class|std|standard|grade)?|(lkg|ukg|nursery|kg))\\b',
  'i',
);

function takeClass(text: string): { cls: string; rest: string } {
  const m = text.match(CLASS_IN_TEXT);
  if (!m) return { cls: '', rest: text };
  const token = m[1] ?? m[2];
  let cls = '';
  if (token) {
    const n = /^\d/.test(token) ? Number(token) : ROMAN[token.toLowerCase()];
    if (!n || n < 1 || n > 12) return { cls: '', rest: text };
    cls = `Class ${n}`;
  } else cls = m[3].toUpperCase() === 'NURSERY' ? 'Nursery' : m[3].toUpperCase();
  return { cls, rest: text.replace(m[0], ' ') };
}

function parseMoney(s: string): number | null {
  const m = s.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Math.round(Number(m[0]));
  return n >= 0 && n <= 1_000_000 ? n : null;
}

function takeFee(text: string): { fee: number | null; rest: string } {
  const m = text.match(/(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d+)?)\s*(?:\/-?)?|\b(?:monthly\s+)?fees?\s*[:=-]?\s*([\d,]+)|([\d,]{3,})\s*(?:\/-|rs\b|₹)/i);
  if (!m) return { fee: null, rest: text };
  const n = parseMoney(m[1] ?? m[2] ?? m[3] ?? '');
  return { fee: n, rest: text.replace(m[0], ' ') };
}

const STOP = new Set([
  'total', 'grand', 'signature', 'sign', 'page', 'sr', 'sno', 'name', 'names', 'student', 'students', 'list', 'roll', 'no', 'fee', 'fees',
  'phone', 'mobile', 'contact', 'class', 'date', 'batch', 'school', 'tuition', 'tuitions', 'attendance', 'report', 'register', 'sheet',
  'address', 'parent', 'parents', 'remarks', 'amount', 'number', 'month', 'monthly', 'details', 'detail', 'data', 'of', 'the', 'and', 'classes',
  'teacher', 'principal', 'academy', 'institute', 'coaching', 'centre', 'center', 'email',
]);

function titleCase(s: string): string {
  return s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** Cleans what is left of a line into a person's name, or '' if it does not look like one. */
export function cleanName(s: string): string {
  let t = s.replace(/[^\p{L}\p{M}\s.'’-]/gu, ' ').replace(/\s[.'’-]+(?=\s|$)/g, ' ').replace(/(^|\s)[.'’-]+/g, '$1');
  t = squash(t).replace(/^[.\s-]+|[.\s-]+$/g, '');
  if (!t) return '';
  if (!/\p{L}.*\p{L}/u.test(t)) return ''; // at least two letters
  if (t.length > 60) return '';
  const hasLower = /\p{Ll}/u.test(t);
  const hasUpper = /\p{Lu}/u.test(t);
  if ((!hasLower || !hasUpper) && /[a-z]/i.test(t)) t = titleCase(t); // ALL CAPS or all lower → Title Case
  return t;
}

function looksLikeHeading(name: string): boolean {
  return name.toLowerCase().split(/\s+/).some((w) => STOP.has(w.replace(/[^a-z]/g, '')));
}

const RELATION = /\b(?:s\/o|d\/o|w\/o|c\/o|son of|daughter of|father|mother|parent|guardian)\b\.?\s*[:\-]?\s*/i;

/* ------------------------------------------------------------------ one line, no column info */

function fromLine(cells: Row, sheetClass = ''): ParsedStudent | 'skip' | null {
  const original = squash(cells.filter(Boolean).join('  '));
  if (!original || !/\p{L}/u.test(original)) return null; // blank or numbers only: nothing to report
  let t = ' ' + cells.filter(Boolean).join(' | ') + ' ';

  const ph = takePhones(t);
  t = ph.rest;
  let joining: string | null = null;
  const dm = t.match(DATE_IN_TEXT);
  if (dm) {
    joining = normDate(dm[1]);
    if (joining) t = t.replace(dm[0], ' ');
  }
  const fee = takeFee(t);
  t = fee.rest;
  let cls = takeClass(t);
  t = cls.rest;

  // Parent / relation text goes to notes instead of the name.
  let notes = '';
  const rel = t.match(RELATION);
  if (rel && rel.index !== undefined) {
    const after = t.slice(rel.index + rel[0].length).replace(/\|/g, ' ');
    const label = /s\/o|son of/i.test(rel[0]) ? 'S/o' : /d\/o|daughter of/i.test(rel[0]) ? 'D/o' : /w\/o/i.test(rel[0]) ? 'W/o' : 'Parent';
    const who = cleanName(after);
    if (who) notes = `${label} ${who}`;
    t = t.slice(0, rel.index);
  }

  // Leading serial / roll number: "12.", "3)", or a bare number cell before the name.
  t = t.replace(/^\s*(?:\|\s*)?\d{1,3}\s*[.):\-|]?\s+(?=[^\d\s|])/, ' ');

  // Whatever numbers remain: small ones are a class, three digits and up a fee.
  let remaining = t;
  let feeVal = fee.fee;
  remaining = remaining.replace(/(?<![\p{L}\d])(\d{1,6})(?![\p{L}\d])/gu, (m, n: string) => {
    const v = Number(n);
    if (feeVal === null && v >= 100) { feeVal = v; return ' '; }
    if (!cls.cls && v >= 1 && v <= 12) { cls = { cls: `Class ${v}`, rest: '' }; return ' '; }
    return ' ';
  });

  const name = cleanName(remaining.replace(/\|/g, ' '));
  if (!name || looksLikeHeading(name)) return 'skip';

  return {
    name,
    phone: ph.phones[0] ?? '',
    class_name: cls.cls || sheetClass,
    fee: feeVal,
    joining,
    notes: [notes, ph.phones[1] ? `Alt phone ${ph.phones[1]}` : ''].filter(Boolean).join(' · '),
    source: original,
  };
}

/* ------------------------------------------------------------------ rows with a header row */

interface Mapping { cols: Partial<Record<Col, number[]>>; headerAt: number }

function findHeader(rows: Row[]): Mapping | null {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const row = rows[i];
    if (headerScore(row) < 2) continue;
    const cols: Mapping['cols'] = {};
    row.forEach((cell, idx) => {
      const c = headerCol(cell);
      if (c) (cols[c] ??= []).push(idx);
    });
    if (cols.name || cols.first) return { cols, headerAt: i };
    // "Student" with no name word but a phone column is still enough
    if (cols.phone && cols.class) return { cols, headerAt: i };
  }
  return null;
}

function cell(row: Row, cols: number[] | undefined): string {
  if (!cols) return '';
  for (const i of cols) if (row[i] && squash(row[i])) return squash(row[i]);
  return '';
}

function fromMapped(row: Row, m: Mapping, headerRow: Row, sheetClass: string): ParsedStudent | 'skip' | null {
  const original = squash(row.filter(Boolean).join('  '));
  if (!original) return null;
  const c = m.cols;
  let name = cleanName(cell(row, c.name));
  if (!name && (c.first || c.last)) name = cleanName(`${cell(row, c.first)} ${cell(row, c.last)}`);
  else if (name && c.last && !c.name) name = cleanName(`${name} ${cell(row, c.last)}`);
  if (!name) {
    // A row without a name cell: maybe the name sits in another column. Fall back to reading the whole line.
    const guess = fromLine(row, sheetClass);
    return guess ?? null;
  }
  if (looksLikeHeading(name)) return 'skip';

  let phone = '';
  const phoneText = cell(row, c.phone);
  if (phoneText) {
    const p = takePhones(' ' + phoneText + ' ');
    phone = p.phones[0] ?? '';
    if (!phone) {
      // e.g. Excel stored 9.8765432e9 or dropped a leading digit: keep what digits there are only if plausible
      const d = phoneText.replace(/\D/g, '');
      if (d.length === 10) phone = d;
    }
  }
  let cls = cell(row, c.class) ? normClass(cell(row, c.class)) : sheetClass;
  const feeText = cell(row, c.fee);
  const fee = feeText ? parseMoney(feeText) : null;
  const joinText = cell(row, c.joining);
  const joining = joinText ? normDate(joinText) : null;

  const notes: string[] = [];
  for (const i of c.notes ?? []) {
    const v = squash(row[i] ?? '');
    if (!v) continue;
    const label = squash(headerRow[i] ?? '');
    notes.push(!label || /^(notes?|remarks?|comments?)$/i.test(label) ? v : `${label}: ${v}`);
  }
  // a second class-like column (e.g. both "Class" and "School") is kept as a note
  const extraClass = (c.class ?? []).slice(1).map((i) => squash(row[i] ?? '')).filter(Boolean);
  if (extraClass.length) { notes.push(extraClass.join(', ')); if (!cls) cls = ''; }

  return { name, phone, class_name: cls, fee, joining, notes: notes.join(' · '), source: original };
}

/* ------------------------------------------------------------------ public entry */

export interface ParseOptions {
  /** true when columns are real columns (Excel/CSV/Word tables), false for OCR and free text */
  reliable: boolean;
  /** class taken from the sheet name or file, used when a row has none */
  sheetClass?: string;
}

export function parseRows(rows: Row[], opts: ParseOptions): ParseResult {
  const students: ParsedStudent[] = [];
  const skipped: string[] = [];
  const clean = rows.map((r) => r.map((c) => squash(String(c ?? ''))));
  const map = opts.reliable ? findHeader(clean) : null;
  const sheetClass = opts.sheetClass ?? '';

  clean.forEach((row, i) => {
    if (!row.some(Boolean)) return;
    if (map && i <= map.headerAt) return;
    if (!map && headerScore(row.filter(Boolean)) >= 2) return; // a header line in OCR/text: not a student
    const res = map ? fromMapped(row, map, clean[map.headerAt], sheetClass) : fromLine(row, sheetClass);
    if (res === null) return;
    if (res === 'skip') {
      const text = squash(row.filter(Boolean).join(' '));
      if (skipped.length < 40) skipped.push(text);
      return;
    }
    students.push(res);
  });
  return { students, skipped };
}

/** Quote-aware split (RFC 4180 style): "1,800" stays one cell, "" is a quote, quoted cells may hold line breaks. */
export function splitDelimited(text: string, sep: string): Row[] {
  const rows: Row[] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Free text or CSV: picks tab, |, ; or , as the separator when most lines have it, else one cell per line. */
export function textToRows(text: string): { rows: Row[]; reliable: boolean } {
  for (const sep of ['\t', '|', ';', ',']) {
    const rows = splitDelimited(text, sep);
    const counts = rows.map((r) => r.length);
    const multi = counts.filter((n) => n > 1).length;
    if (rows.length >= 2 && multi >= Math.max(2, Math.floor(rows.length * 0.7))) {
      return { rows, reliable: sep !== ',' || new Set(counts).size <= 2 };
    }
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { rows: lines.map((l) => [l]), reliable: false };
}

/** vCard contacts (.vcf) → rows of [name, phone]. */
export function vcardRows(text: string): Row[] {
  const out: Row[] = [];
  for (const card of text.split(/BEGIN:VCARD/i).slice(1)) {
    const fn = card.match(/^FN[^:\r\n]*:(.+)$/im)?.[1]?.trim()
      ?? card.match(/^N[^:\r\n]*:(.+)$/im)?.[1]?.split(';').reverse().join(' ').trim() ?? '';
    const tel = card.match(/^TEL[^:\r\n]*:(.+)$/im)?.[1]?.trim() ?? '';
    if (fn) out.push([fn, tel]);
  }
  return out;
}

/** Merges results from several files/sheets/pages, dropping repeats of the same student. */
export function mergeResults(parts: ParseResult[]): ParseResult {
  const seen = new Set<string>();
  const students: ParsedStudent[] = [];
  const skipped: string[] = [];
  for (const p of parts) {
    for (const s of p.students) {
      const key = `${s.name.toLowerCase()}|${s.phone}`;
      if (seen.has(key)) continue;
      seen.add(key);
      students.push(s);
    }
    skipped.push(...p.skipped);
  }
  return { students, skipped: skipped.slice(0, 40) };
}

/** Same person already in the app? Compared by phone + name, or by name alone when a phone is missing. */
export function isDuplicate(s: { name: string; phone: string }, existing: { name: string; parent_phone: string }[]): boolean {
  const n = s.name.trim().toLowerCase();
  return existing.some((e) => {
    if (e.name.trim().toLowerCase() !== n) return false;
    const ep = (e.parent_phone ?? '').replace(/\D/g, '').slice(-10);
    return !s.phone || !ep || ep === s.phone;
  });
}
